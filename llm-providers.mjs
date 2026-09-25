import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const codexCandidates = [process.env.CODEX_BIN, '/Applications/ChatGPT.app/Contents/Resources/codex', 'codex'].filter(Boolean);
const claudeCandidates = [process.env.CLAUDE_BIN, 'claude'].filter(Boolean);

function preferredBinary(candidates) {
  return candidates.find(candidate => candidate.includes('/') && existsSync(candidate)) || candidates.find(candidate => !candidate.includes('/')) || candidates[0];
}

const binaries = {
  codex: preferredBinary(codexCandidates),
  claude: preferredBinary(claudeCandidates)
};

function execute(binary, args, { cwd, input, maxBuffer = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { cwd, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        error.detail = stderr?.trim() || stdout?.trim() || error.message;
        reject(error);
      } else resolve({ stdout, stderr });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function inspectCodex() {
  try {
    const version = (await execute(binaries.codex, ['--version'])).stdout.trim();
    try {
      await execute(binaries.codex, ['login', 'status'], { maxBuffer: 20_000 });
      return { id: 'codex', name: 'Codex', installed: true, available: true, version, detail: 'Yerel oturum bağlı' };
    } catch {
      return { id: 'codex', name: 'Codex', installed: true, available: false, version, detail: 'codex login gerekli' };
    }
  } catch { return { id: 'codex', name: 'Codex', installed: false, available: false, detail: 'Kurulu değil' }; }
}

async function inspectClaude() {
  try {
    const version = (await execute(binaries.claude, ['--version'])).stdout.trim();
    return { id: 'claude', name: 'Claude Code', installed: true, available: true, version, detail: 'Yerel CLI hazır; oturum çalıştırmada doğrulanır' };
  } catch { return { id: 'claude', name: 'Claude Code', installed: false, available: false, detail: 'Kurulu değil' }; }
}

export async function providerStatuses() {
  return Promise.all([inspectCodex(), inspectClaude()]);
}

async function selectProvider(requested = 'auto') {
  const statuses = await providerStatuses();
  if (requested === 'auto') {
    const provider = statuses.find(status => status.available);
    if (!provider) throw new Error('Kullanılabilir ve oturumu açık bir yerel LLM aracı bulunamadı.');
    return provider.id;
  }
  const provider = statuses.find(status => status.id === requested);
  if (!provider) throw new Error(`Bilinmeyen LLM sağlayıcısı: ${requested}`);
  if (!provider.available) throw new Error(`${provider.name} kullanılamıyor: ${provider.detail}`);
  return provider.id;
}

function parseJsonText(value) {
  const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

function codexSessionId(stdout) {
  for (const line of String(stdout).split('\n')) {
    try {
      const event = JSON.parse(line);
      const id = event.thread_id || event.threadId || event.session_id || event.sessionId;
      if (id && (event.type === 'thread.started' || event.type === 'session.started')) return id;
    } catch { /* Codex may mix non-JSON diagnostics into stdout. */ }
  }
  return null;
}

export function codexExecArgs({ mode = 'plan', sessionId, model, effort, schemaPath, outputPath }) {
  const args = sessionId
    ? ['exec', 'resume', '--json']
    : ['exec', '--sandbox', mode === 'execute' ? 'workspace-write' : 'read-only', '--json'];
  if (mode === 'execute') {
    if (sessionId) args.push('-c', 'sandbox_mode="workspace-write"');
    args.push('-c', 'approval_policy="never"');
  }
  if (!sessionId && mode !== 'execute') args.push('--ephemeral');
  if (model) args.push('--model', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (schemaPath) args.push('--output-schema', schemaPath);
  args.push('-o', outputPath);
  if (sessionId) args.push(sessionId);
  args.push('-');
  return args;
}

async function runCodex({ prompt, cwd, model, effort, schemaPath, structured, mode = 'plan', sessionId }) {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-codex-'));
  try {
    const outputPath = join(directory, structured ? 'result.json' : 'result.md');
    const args = codexExecArgs({ mode, sessionId, model, effort, schemaPath, outputPath });
    const { stdout } = await execute(binaries.codex, args, { cwd, input: prompt, maxBuffer: 8_000_000 });
    const output = (await readFile(outputPath, 'utf8')).trim();
    return { provider: 'codex', output: structured ? parseJsonText(output) : output, sessionId: sessionId || codexSessionId(stdout) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runClaude({ prompt, cwd, model, structured, mode = 'plan', sessionId }) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', mode === 'execute' ? 'acceptEdits' : 'plan', '--max-turns', mode === 'execute' ? '24' : '8'];
  if (sessionId) args.push('--resume', sessionId);
  if (model && (model.startsWith('claude-') || ['sonnet', 'opus', 'haiku'].includes(model))) args.push('--model', model);
  const { stdout } = await execute(binaries.claude, args, { cwd, input: prompt });
  const envelope = JSON.parse(stdout);
  if (envelope.is_error) throw new Error(envelope.result || 'Claude Code görevi tamamlayamadı.');
  return { provider: 'claude', output: structured ? parseJsonText(envelope.result) : envelope.result.trim(), sessionId: envelope.session_id };
}

export async function runLocalAgent(options) {
  const provider = await selectProvider(options.provider);
  const resolvedOptions = { ...options, model: options.models?.[provider] || options.model };
  const result = provider === 'codex' ? await runCodex(resolvedOptions) : await runClaude(resolvedOptions);
  return { ...result, model: resolvedOptions.model || 'varsayılan', effort: provider === 'codex' ? resolvedOptions.effort || 'medium' : null };
}
