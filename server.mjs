import { createServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { limitReviewToChangedCode } from './review-scope.mjs';
import { azurePullRequestUrl } from './pr-url.mjs';
import { isDirectory, loadProjects, saveProjects } from './project-config.mjs';
import { providerStatuses, resolveLocalAgent, runLocalAgent } from './llm-providers.mjs';
import { taskProfile } from './task-routing.mjs';
import { loadWorkflowRuns, recoverInterruptedRuns, saveWorkflowRuns } from './workflow-runs.mjs';

const root = new URL('.', import.meta.url).pathname;
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const run = promisify(execFile);
const repoIndex = process.argv.indexOf('--repo');
let repoPath = repoIndex >= 0 ? process.argv[repoIndex + 1] : null;
const commitIndex = process.argv.indexOf('--commit');
let selectedCommit = commitIndex >= 0 ? process.argv[commitIndex + 1] : 'HEAD';
const pullRequestIndex = process.argv.indexOf('--pull-request');
let selectedPullRequest = pullRequestIndex >= 0 ? process.argv[pullRequestIndex + 1] : null;
const schemaPath = join(root, 'review-schema.json');
const supportedModels = new Set(['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']);
const supportedEfforts = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const supportedProviders = new Set(['auto', 'codex', 'claude']);

const agentRules = new Map();
const storedWorkflowRuns = await loadWorkflowRuns();
const recoveredWorkflowRuns = recoverInterruptedRuns(storedWorkflowRuns);
const workflowRuns = new Map(recoveredWorkflowRuns.map(item => [item.id, item]));
let workflowSaveQueue = Promise.resolve();

if (recoveredWorkflowRuns.some((run, index) => run.status !== storedWorkflowRuns[index]?.status)) {
  await saveWorkflowRuns(recoveredWorkflowRuns);
}

async function agentRule(name) {
  if (!agentRules.has(name)) agentRules.set(name, await readFile(join(root, 'agents', `${name}.md`), 'utf8'));
  return agentRules.get(name);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function persistWorkflowRuns() {
  const snapshot = [...workflowRuns.values()];
  workflowSaveQueue = workflowSaveQueue.then(() => saveWorkflowRuns(snapshot));
  return workflowSaveQueue;
}

function readJson(req, maxLength = 50_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > maxLength) {
        reject(new Error('İstek gövdesi izin verilen boyutu aşıyor.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Geçersiz JSON isteği.')); }
    });
    req.on('error', reject);
  });
}

function expandHome(path) {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

async function resolveRepository(selection) {
  const projects = await loadProjects();
  const value = typeof selection === 'string' ? selection.trim() : '';
  const selectedPath = projects[value.toLowerCase()] || expandHome(value);
  if (!selectedPath || !(await isDirectory(selectedPath))) throw new Error('Okunabilir bir repository klasörü seçin.');
  return selectedPath;
}

function projectEntries(projects) {
  return Object.entries(projects).sort(([a], [b]) => a.localeCompare(b)).map(([name, path]) => ({ name, path }));
}

function projectSlug(value) {
  const turkish = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  const normalized = String(value).trim().toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, character => turkish[character]);
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

async function rememberRepository(selection) {
  const projects = await loadProjects();
  const selectedPath = await resolveRepository(selection);
  const { stdout } = await run('git', ['-C', selectedPath, 'rev-parse', '--show-toplevel']);
  const repositoryPath = stdout.trim();
  const existing = Object.entries(projects).find(([, path]) => path === repositoryPath);
  if (existing) return { project: { name: existing[0], path: existing[1] }, projects: projectEntries(projects) };
  const baseName = projectSlug(basename(repositoryPath));
  let name = baseName;
  let suffix = 2;
  while (projects[name] && projects[name] !== repositoryPath) name = `${baseName}-${suffix++}`;
  projects[name] = repositoryPath;
  await saveProjects(projects);
  return { project: { name, path: repositoryPath }, projects: projectEntries(projects) };
}

async function git(args) { return (await run('git', ['-C', repoPath, ...args], { maxBuffer: 8_000_000 })).stdout; }

async function azurePullRequestRefs(url) {
  const azure = azurePullRequestUrl(url);
  if (!azure) return null;
  try {
    const { stdout } = await run('az', [
      'repos', 'pr', 'show', '--id', azure.id, '--repository', azure.repository,
      '--organization', `https://dev.azure.com/${azure.organization}/${azure.project}`,
      '--output', 'json'
    ], { cwd: repoPath, maxBuffer: 1_000_000 });
    const pullRequest = JSON.parse(stdout);
    if (!pullRequest.sourceRefName || !pullRequest.targetRefName) throw new Error('PR kaynak veya hedef ref bilgisi dönmedi.');
    return { ...azure, source: pullRequest.sourceRefName, target: pullRequest.targetRefName, title: pullRequest.title || '' };
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Azure DevOps PR bilgisi okunamadı. Azure CLI ile oturum açtığınızdan ve Azure DevOps eklentisinin kurulu olduğundan emin olun. ${detail}`);
  }
}

async function nearestReadmes(files) {
  const found = new Set();
  for (const file of files) {
    let folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    while (true) {
      const candidate = join(repoPath, folder, 'README.md');
      if (existsSync(candidate)) { found.add(candidate); break; }
      if (!folder) break;
      folder = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
    }
  }
  const documents = await Promise.all([...found].map(async file => `--- ${file.slice(repoPath.length + 1)} ---\n${await readFile(file, 'utf8')}`));
  return documents.join('\n\n');
}

async function relevantAgents(files) {
  const found = new Set();
  for (const file of files) {
    let folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    while (true) {
      const candidate = join(repoPath, folder, 'AGENTS.md');
      if (existsSync(candidate)) found.add(candidate);
      if (!folder) break;
      folder = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
    }
  }
  const ordered = [...found].sort((a, b) => a.split('/').length - b.split('/').length);
  const documents = await Promise.all(ordered.map(async file => `--- ${file.slice(repoPath.length + 1)} ---\n${await readFile(file, 'utf8')}`));
  return documents.join('\n\n');
}

function pullRequestNumber(value) {
  const match = String(value).trim().match(/(?:pull|pullrequest)\/(\d+)(?:[/?#]|$)/i) || String(value).trim().match(/^\d+$/);
  if (!match) throw new Error('Pull request için GitHub/Azure DevOps URL’si veya sayısal PR numarası girin.');
  return match[1] || match[0];
}

async function pullRequestContext() {
  const id = pullRequestNumber(selectedPullRequest);
  try {
    await git(['fetch', '--no-tags', 'origin', `refs/pull/${id}/merge`]);
  } catch (error) {
    const azureRefs = await azurePullRequestRefs(selectedPullRequest);
    if (!azureRefs) {
      throw new Error(`PR #${id} yerel repository’den alınamadı. GitHub uzak bağlantısında bu PR’ın merge ref’i erişilebilir olmalıdır. ${error.stderr?.trim() || error.message}`);
    }
    try {
      await git(['fetch', '--no-tags', 'origin', azureRefs.target]);
      const base = (await git(['rev-parse', 'FETCH_HEAD'])).trim();
      await git(['fetch', '--no-tags', 'origin', azureRefs.source]);
      const head = (await git(['rev-parse', 'FETCH_HEAD'])).trim();
      return pullRequestDiffContext({ id, base, head, subject: azureRefs.title, comparison: `${azureRefs.target}...${azureRefs.source}` });
    } catch (fetchError) {
      throw new Error(`Azure DevOps PR #${id} için kaynak/hedef dallar alınamadı. ${fetchError.stderr?.trim() || fetchError.message}`);
    }
  }
  const parents = (await git(['show', '--no-patch', '--format=%P', 'FETCH_HEAD'])).trim().split(' ').filter(Boolean);
  if (parents.length < 2) throw new Error(`PR #${id} için merge ref’i iki ebeveynli bir merge commit döndürmedi; doğru repository ve PR numarasını kontrol edin.`);
  const [base, head] = parents;
  return pullRequestDiffContext({ id, base, head, comparison: `${base}...${head}`, mergeRef: 'FETCH_HEAD' });
}

async function pullRequestDiffContext({ id, base, head, subject = '', comparison, mergeRef }) {
  const [name, commitRaw, diff, files] = await Promise.all([
    git(['rev-parse', '--show-toplevel']),
    git(['show', '--no-patch', '--format=%H%x00%an%x00%aI%x00%s', mergeRef || head]),
    git(['diff', '--no-ext-diff', '--no-renames', base, head]),
    git(['diff', '--name-only', base, head])
  ]);
  const [hash, author, authoredAt, mergeSubject] = commitRaw.trim().split('\0');
  const commit = { hash, author, authoredAt, subject: subject || mergeSubject, context: `Pull request: #${id}\nReferans commit: ${hash}\nYazar: ${author}\nTarih: ${authoredAt}\nBaşlık: ${subject || mergeSubject}\nKarşılaştırma: ${comparison}` };
  const changedFiles = files.trim().split('\n').filter(Boolean);
  return { enabled: true, reviewType: 'pull_request', repository: name.trim().split('/').pop(), commit, diff: diff.trim(), readme: await nearestReadmes(changedFiles), agents: await relevantAgents(changedFiles) };
}

async function repositoryContext() {
  if (!repoPath) return { enabled: false };
  await git(['rev-parse', '--is-inside-work-tree']);
  if (selectedPullRequest) return pullRequestContext();
  const [name, commitRaw, diff, files] = await Promise.all([
    git(['rev-parse', '--show-toplevel']),
    git(['show', '--no-patch', '--format=%H%x00%an%x00%aI%x00%s', selectedCommit]),
    git(['show', '--no-ext-diff', '--no-renames', '--format=', selectedCommit]),
    git(['diff-tree', '--no-commit-id', '--name-only', '-r', selectedCommit])
  ]);
  const [hash, author, authoredAt, subject] = commitRaw.trim().split('\0');
  const commit = { hash, author, authoredAt, subject, context: `Commit: ${hash}\nYazar: ${author}\nTarih: ${authoredAt}\nBaşlık: ${subject}` };
  const changedFiles = files.trim().split('\n').filter(Boolean);
  return { enabled: true, reviewType: 'commit', repository: name.trim().split('/').pop(), commit, diff: diff.trim(), readme: await nearestReadmes(changedFiles), agents: await relevantAgents(changedFiles) };
}

async function runReviewAgent(prompt, provider, model, reasoningEffort) {
  console.info(`Review agent başlatılıyor: provider=${provider}, model=${model}, çaba=${reasoningEffort}`);
  const result = await runLocalAgent({ provider, prompt, cwd: root, model, effort: reasoningEffort, schemaPath, structured: true });
  return { review: result.output, provider: result.provider };
}

async function gitAt(repositoryPath, args) {
  return (await run('git', ['-C', repositoryPath, ...args], { maxBuffer: 12_000_000 })).stdout;
}

async function workflowDiff(repositoryPath) {
  const [trackedDiff, statusText, untrackedText] = await Promise.all([
    gitAt(repositoryPath, ['diff', '--no-ext-diff', '--no-renames', '--']),
    gitAt(repositoryPath, ['status', '--short']),
    gitAt(repositoryPath, ['ls-files', '--others', '--exclude-standard'])
  ]);
  const untrackedFiles = untrackedText.trim().split('\n').filter(Boolean);
  const untrackedDiffs = [];
  for (const file of untrackedFiles) {
    try {
      const absoluteFile = join(repositoryPath, file);
      const fileStat = await lstat(absoluteFile);
      if (!fileStat.isFile()) {
        untrackedDiffs.push(`diff --git a/${file} b/${file}\nnew non-regular file\n`);
        continue;
      }
      if (fileStat.size > 600_000) {
        untrackedDiffs.push(`diff --git a/${file} b/${file}\nnew file (${fileStat.size} bytes; içerik önizlenmedi)\n`);
        continue;
      }
      const content = await readFile(absoluteFile);
      const rendered = content.includes(0)
        ? `diff --git a/${file} b/${file}\nnew file (binary)\n`
        : `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${content.toString('utf8').split('\n').length} @@\n${content.toString('utf8').split('\n').map(line => `+${line}`).join('\n')}\n`;
      untrackedDiffs.push(rendered);
    } catch { /* File may have disappeared after status was read. */ }
  }
  const fullDiff = [trackedDiff.trim(), ...untrackedDiffs].filter(Boolean).join('\n\n');
  const limit = 600_000;
  return {
    diff: fullDiff.length > limit ? `${fullDiff.slice(0, limit)}\n\n... diff önizlemesi 600 KB ile sınırlandı ...` : fullDiff,
    diffTruncated: fullDiff.length > limit,
    changedFiles: statusText.trim().split('\n').filter(Boolean).map(line => line.slice(3).replace(/^"|"$/g, ''))
  };
}

function workflowTaskPrompt(task, profile) {
  return `## İş profili\n\nPuan: ${profile.points}/5 (${profile.label})\n\n## Görev\n\nBaşlık: ${task.title}\n\nAçıklama ve kabul kriterleri:\n${task.description || '(ek açıklama yok)'}\n\nGörevi şimdi repository üzerinde uygula. Uygun doğrulamaları çalıştır ve sonucu çıktı sözleşmesine göre özetle.`;
}

function workflowFeedbackPrompt(existing) {
  const messages = existing.messages || [];
  const lastAssistantIndex = messages.reduce((found, message, index) => message.role === 'assistant' ? index : found, -1);
  const feedback = messages.slice(lastAssistantIndex + 1).reverse().find(message => message.role === 'user' && message.kind === 'feedback');
  return `## Developer feedback turu\n\n${feedback?.content || 'Mevcut değişiklikleri yeniden incele, eksik kalan noktaları tamamla ve doğrulamaları çalıştır.'}\n\nMevcut çalışma ağacını koruyarak feedback'i uygula. Sonucu çıktı sözleşmesine göre özetle.`;
}

async function executeWorkflowTask(runState, profile, isResume) {
  try {
    const prompt = `${await agentRule('executor')}\n\n${isResume ? workflowFeedbackPrompt(runState) : workflowTaskPrompt(runState.task, profile)}`;
    const result = await runLocalAgent({
      resolvedProvider: runState.provider,
      prompt,
      cwd: runState.repositoryPath,
      model: runState.model,
      effort: runState.effort,
      structured: false,
      mode: 'execute',
      sessionId: isResume ? runState.sessionId : null
    });
    const changes = await workflowDiff(runState.repositoryPath);
    Object.assign(runState, changes, {
      status: 'review',
      provider: result.provider,
      model: result.model,
      effort: result.effort,
      sessionId: result.sessionId || runState.sessionId || null,
      summary: result.output,
      updatedAt: new Date().toISOString()
    });
    runState.messages.push({ role: 'assistant', kind: 'result', content: result.output, at: runState.updatedAt });
  } catch (error) {
    runState.status = 'failed';
    runState.error = error.detail || error.message || 'Yerel agent görevi tamamlayamadı.';
    runState.updatedAt = new Date().toISOString();
  }
  workflowRuns.set(runState.id, runState);
  await persistWorkflowRuns();
}

async function startWorkflowTask(id, input) {
  if (!id || typeof input.title !== 'string' || !input.title.trim()) throw new Error('Geçerli bir workflow görevi gerekli.');
  if (typeof input.project !== 'string' || !input.project.trim()) throw new Error('Göreve bağlı repository seçilmedi.');
  if (!supportedProviders.has(input.provider || 'auto')) throw new Error('Geçersiz yerel LLM sağlayıcısı.');
  const profile = taskProfile(input.points);
  const repositoryPath = await resolveRepository(input.project);
  await gitAt(repositoryPath, ['rev-parse', '--is-inside-work-tree']);
  const existing = workflowRuns.get(id);
  if (existing?.status === 'running') throw new Error('Bu görev zaten çalışıyor.');
  if (existing?.sessionId && existing.repositoryPath !== repositoryPath) throw new Error('Devam eden agent oturumunun repository’si değiştirilemez.');
  const competingRun = [...workflowRuns.values()].find(item => item.id !== id && item.status === 'running' && item.repositoryPath === repositoryPath);
  if (competingRun) throw new Error('Bu repository üzerinde başka bir workflow görevi çalışıyor.');
  if (!existing?.sessionId) {
    const dirty = (await gitAt(repositoryPath, ['status', '--porcelain'])).trim();
    if (dirty) throw new Error('Repository’de kaydedilmemiş değişiklikler var. Mevcut çalışmanı commit/stash yaptıktan sonra görevi yeniden Yapılıyor’a taşı; böylece agent yalnızca kendi değişiklikleri üzerinde çalışır.');
  }
  const isResume = Boolean(existing?.sessionId);
  const agentSelection = await resolveLocalAgent(isResume
    ? { provider: existing.provider, model: existing.model, effort: existing.effort }
    : { provider: input.provider || 'auto', models: { codex: profile.codex.model, claude: profile.claude.model }, effort: profile.codex.effort });
  const now = new Date().toISOString();
  const task = { title: input.title.trim(), description: String(input.description || '').trim(), project: input.project.trim(), points: profile.points };
  const runState = {
    ...(existing || {}),
    id,
    task,
    repositoryPath,
    baseCommit: existing?.baseCommit || (await gitAt(repositoryPath, ['rev-parse', 'HEAD'])).trim(),
    status: 'running',
    error: null,
    provider: agentSelection.provider,
    model: agentSelection.model,
    effort: agentSelection.effort,
    attempt: (existing?.attempt || 0) + 1,
    startedAt: existing?.startedAt || now,
    updatedAt: now,
    messages: existing?.messages || [{ role: 'user', kind: 'task', content: [input.title, input.description].filter(Boolean).join('\n\n'), at: now }]
  };
  workflowRuns.set(id, runState);
  await persistWorkflowRuns();
  void executeWorkflowTask(runState, profile, isResume).catch(error => console.error('Workflow arka plan hatası:', error));
  return { accepted: true, id, status: 'running' };
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/folder/select') {
    if (process.platform !== 'darwin') return send(res, 501, { error: 'Finder klasör seçimi yalnızca macOS üzerinde kullanılabilir.' });
    try {
      const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Repository klasörünü seç")']);
      return send(res, 200, { path: stdout.trim().replace(/\/$/, '') });
    } catch (error) {
      const detail = error.stderr?.trim() || error.message || '';
      if (/user canceled|-128/i.test(detail)) return send(res, 200, { cancelled: true });
      return send(res, 500, { error: `Klasör seçici açılamadı: ${detail}` });
    }
  }
  if (req.method === 'GET' && req.url === '/api/projects') {
    try {
      const projects = await loadProjects();
      return send(res, 200, {
        projects: projectEntries(projects),
        active: repoPath ? { repository: repoPath, reviewType: selectedPullRequest ? 'pr' : 'commit', target: selectedPullRequest || selectedCommit } : null
      });
    } catch (error) { return send(res, 500, { error: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/projects') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const input = JSON.parse(raw);
        if (typeof input.repository !== 'string' || !input.repository.trim()) return send(res, 400, { error: 'Kaydedilecek repository yolunu seçin.' });
        return send(res, 200, await rememberRepository(input.repository));
      } catch (error) {
        const detail = error.stderr?.trim() || error.message || 'Bilinmeyen repository hatası.';
        return send(res, 400, { error: `Proje kaydedilemedi: ${detail}` });
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/context/select') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      const previous = { repoPath, selectedCommit, selectedPullRequest };
      try {
        const input = JSON.parse(raw);
        const selection = typeof input.repository === 'string' ? input.repository.trim() : '';
        const reviewType = input.reviewType === 'pr' ? 'pr' : 'commit';
        const target = typeof input.target === 'string' ? input.target.trim() : '';
        const selectedPath = await resolveRepository(selection);
        if (reviewType === 'pr' && !target) return send(res, 400, { error: 'Pull request URL’si veya numarası gerekli.' });
        repoPath = selectedPath;
        selectedCommit = reviewType === 'commit' ? target || 'HEAD' : 'HEAD';
        selectedPullRequest = reviewType === 'pr' ? target : null;
        const context = await repositoryContext();
        send(res, 200, { ...context, selection: { repository: repoPath, reviewType, target: selectedPullRequest || selectedCommit } });
      } catch (error) {
        ({ repoPath, selectedCommit, selectedPullRequest } = previous);
        const detail = error.stderr?.trim() || error.message || 'Bilinmeyen Git hatası.';
        send(res, 400, { error: `Repository veya hedef yüklenemedi: ${detail}` });
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/api/context') {
    try {
      const context = await repositoryContext();
      return send(res, 200, { ...context, selection: repoPath ? { repository: repoPath, reviewType: selectedPullRequest ? 'pr' : 'commit', target: selectedPullRequest || selectedCommit } : null });
    }
    catch (error) {
      const detail = error.stderr?.trim() || error.message || 'Bilinmeyen Git hatası.';
      return send(res, 400, { error: `Repository veya commit okunamadı: ${detail}`, repository: repoPath });
    }
  }
  if (req.method === 'GET' && req.url === '/api/workflow/runs') {
    return send(res, 200, { runs: [...workflowRuns.values()] });
  }
  const workflowStartMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)\/start$/);
  if (req.method === 'POST' && workflowStartMatch) {
    try {
      const id = decodeURIComponent(workflowStartMatch[1]);
      const input = await readJson(req);
      return send(res, 202, await startWorkflowTask(id, input));
    } catch (error) {
      return send(res, 400, { error: error.message || 'Workflow görevi başlatılamadı.' });
    }
  }
  const workflowFeedbackMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)\/feedback$/);
  if (req.method === 'POST' && workflowFeedbackMatch) {
    try {
      const id = decodeURIComponent(workflowFeedbackMatch[1]);
      const input = await readJson(req, 20_000);
      const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
      if (!feedback) return send(res, 400, { error: 'Feedback mesajı boş olamaz.' });
      if (feedback.length > 4_000) return send(res, 400, { error: 'Feedback en fazla 4000 karakter olabilir.' });
      const workflowRun = workflowRuns.get(id);
      if (!workflowRun) return send(res, 404, { error: 'Bu göreve ait agent çalışması bulunamadı.' });
      if (workflowRun.status === 'running') return send(res, 409, { error: 'Agent çalışırken feedback eklenemez.' });
      workflowRun.messages ||= [];
      workflowRun.messages.push({ role: 'user', kind: 'feedback', content: feedback, at: new Date().toISOString() });
      workflowRun.updatedAt = new Date().toISOString();
      workflowRuns.set(id, workflowRun);
      await persistWorkflowRuns();
      return send(res, 200, { run: workflowRun });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Feedback gönderilemedi.' });
    }
  }
  const workflowDeleteMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)$/);
  if (req.method === 'DELETE' && workflowDeleteMatch) {
    const id = decodeURIComponent(workflowDeleteMatch[1]);
    const workflowRun = workflowRuns.get(id);
    if (workflowRun?.status === 'running') return send(res, 409, { error: 'Çalışan görev silinemez.' });
    workflowRuns.delete(id);
    await persistWorkflowRuns();
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    const providers = await providerStatuses();
    return send(res, 200, { connected: providers.some(provider => provider.available), providers });
  }
  if (req.method === 'POST' && req.url === '/api/review') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2_000_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const input = JSON.parse(raw);
        if (!repoPath) return send(res, 400, { error: 'İnceleme için önce bir proje seçin.' });
        if (!input.diff?.trim()) return send(res, 400, { error: 'İnceleme için bir diff gerekli.' });
        if (!supportedProviders.has(input.provider || 'auto')) return send(res, 400, { error: 'Geçersiz yerel LLM sağlayıcısı.' });
        if (!supportedModels.has(input.model)) return send(res, 400, { error: 'Geçersiz veya desteklenmeyen model seçimi.' });
        if (!supportedEfforts.has(input.reasoningEffort)) return send(res, 400, { error: 'Geçersiz çaba seviyesi.' });
        if (input.reasoningEffort === 'max' && !input.model.startsWith('gpt-5.6-')) return send(res, 400, { error: 'Maksimum çaba yalnızca GPT-5.6 modellerinde kullanılabilir.' });
        const context = `${await agentRule('reviewer')}\n\n## İnceleme bağlamı\n\nDEĞİŞİKLİK BİLGİSİ:\n${input.commit || '(sağlanmadı)'}\n\nKULLANICI NOTU:\n${input.note || '(yok)'}\n\nAGENTS.md BAĞLAMI:\n${input.agents || '(yok)'}\n\nREADME BAĞLAMI:\n${input.readme || '(yok)'}\n\nDIFF:\n${input.diff}`;
        const { review, provider } = await runReviewAgent(context, input.provider || 'auto', input.model, input.reasoningEffort);
        if (!review.summary || !Array.isArray(review.findings)) throw new Error('Codex beklenen inceleme şemasını döndürmedi.');
        const scopedReview = limitReviewToChangedCode(review, input.diff);
        if (scopedReview.findings.length !== review.findings.length) {
          console.info(`İnceleme kapsamı dışında kalan ${review.findings.length - scopedReview.findings.length} bulgu elendi.`);
        }
        send(res, 200, { ...scopedReview, meta: { provider } });
      } catch (error) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        const message = error.message || 'Codex CLI incelemeyi tamamlayamadı.';
        console.error(`İnceleme hatası (${status}):`, message, error.cause || '');
        send(res, status, { error: message });
      }
    });
    return;
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const path = req.url === '/' ? '/index.html' : req.url;
  if (path.includes('..')) return send(res, 403, { error: 'Forbidden' });
  try { const file = await readFile(join(root, path)); send(res, 200, file.toString(), mime[extname(path)] || 'application/octet-stream'); }
  catch { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); }
}).listen(port, () => console.log(`Developer Cockpit http://localhost:${port}`));
