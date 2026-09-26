import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { limitReviewToChangedCode } from './review-scope.mjs';
import { azurePullRequestUrl } from './pr-url.mjs';
import { isDirectory, loadProjects, saveProjects } from './project-config.mjs';
import { agentUsage, providerStatuses, resolveLocalAgent, runLocalAgent } from './llm-providers.mjs';
import { taskProfile } from './task-routing.mjs';
import { loadWorkflowRuns, recoverInterruptedRuns, saveWorkflowRuns, workflowWorktreesDirectory } from './workflow-runs.mjs';
import { suggestedCommitMessage, validateCommitMessage, workflowBranchName } from './workflow-git.mjs';
import { azureBoardsWiql, azureOrganizationUrl, normalizeAzureBoardItems } from './azure-boards.mjs';
import { deleteTaskImages, readTaskImage, resolveTaskImages, saveTaskImages, updateTaskImages } from './task-assets.mjs';

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
const recoveredWorkflowRuns = recoverInterruptedRuns(storedWorkflowRuns).map(publicWorkflowRun);
const workflowRuns = new Map(recoveredWorkflowRuns.map(item => [item.id, item]));
let workflowSaveQueue = Promise.resolve();

if (storedWorkflowRuns.some(run => Object.hasOwn(run, 'diff') || Object.hasOwn(run, 'diffTruncated')) || recoveredWorkflowRuns.some((run, index) => run.status !== storedWorkflowRuns[index]?.status)) {
  await saveWorkflowRuns(recoveredWorkflowRuns);
}

async function agentRule(name) {
  if (!agentRules.has(name)) agentRules.set(name, await readFile(join(root, 'agents', `${name}.md`), 'utf8'));
  return agentRules.get(name);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}

function persistWorkflowRuns() {
  const snapshot = [...workflowRuns.values()];
  workflowSaveQueue = workflowSaveQueue.then(() => saveWorkflowRuns(snapshot));
  return workflowSaveQueue;
}

function publicWorkflowRun(runState) {
  const { diff, diffTruncated, ...publicState } = runState;
  return publicState;
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
  return (await run('git', ['-C', repositoryPath, ...args], {
    maxBuffer: 12_000_000,
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })).stdout;
}

async function azureBoardItems(input) {
  const organization = azureOrganizationUrl(input.organization);
  const project = typeof input.project === 'string' ? input.project.trim() : '';
  if (!project) throw new Error('Azure Boards projesi gerekli.');
  const assignee = typeof input.assignee === 'string' ? input.assignee.trim() : '@Me';
  try {
    const { stdout } = await run('az', [
      'boards', 'query', '--org', organization, '--project', project,
      '--wiql', azureBoardsWiql(assignee), '--output', 'json', '--only-show-errors'
    ], { maxBuffer: 2_000_000 });
    const workItems = normalizeAzureBoardItems(JSON.parse(stdout), organization, project);
    return { organization, project, assignee: assignee || '@Me', workItems };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Azure CLI bulunamadı. Azure CLI ve azure-devops eklentisini kurup Azure DevOps oturumunu açın.');
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Azure Boards işleri okunamadı. Azure CLI oturumunu ve proje erişimini kontrol edin. ${detail}`);
  }
}

async function workflowChanges(repositoryPath) {
  const statusText = await gitAt(repositoryPath, ['status', '--short']);
  return {
    changedFiles: statusText.trim().split('\n').filter(Boolean).map(line => line.slice(3).replace(/^"|"$/g, ''))
  };
}

function workflowWorktreePath(sourceRepositoryPath, taskId) {
  const repositoryKey = `${basename(sourceRepositoryPath)}-${createHash('sha256').update(sourceRepositoryPath).digest('hex').slice(0, 8)}`;
  const taskKey = String(taskId).replace(/[^a-z0-9_-]/gi, '-').slice(0, 64);
  return join(workflowWorktreesDirectory, repositoryKey, taskKey);
}

async function prepareWorkflowWorktree(sourceRepositoryPath, taskId, task) {
  const branchName = workflowBranchName(taskId, task);
  const worktreePath = workflowWorktreePath(sourceRepositoryPath, taskId);
  await mkdir(dirname(worktreePath), { recursive: true });
  try {
    await gitAt(sourceRepositoryPath, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Görev için izole çalışma alanı oluşturulamadı. Branch veya worktree daha önce oluşturulmuş olabilir: ${detail}`);
  }
  return { branchName, worktreePath };
}

function workflowImageContext(images) {
  if (!images.length) return '';
  return `\n\n## Görev görselleri\n\n${images.map((image, index) => `${index + 1}. ${image.name} — ${image.path}`).join('\n')}\n\nBu görseller görev girdisinin parçasıdır. Uygulamaya başlamadan önce her birini incele; arayüz, hata durumu ve kabul kriterleriyle ilgili görsel ayrıntıları uygulama kararlarına dahil et.`;
}

function workflowTaskPrompt(task, profile, images = []) {
  return `## İş profili\n\nPuan: ${profile.points}/5 (${profile.label})\n\n## Görev\n\nBaşlık: ${task.title}\n\nAçıklama ve kabul kriterleri:\n${task.description || '(ek açıklama yok)'}${workflowImageContext(images)}\n\nGörevi şimdi repository üzerinde uygula. Uygun doğrulamaları çalıştır ve sonucu çıktı sözleşmesine göre özetle.`;
}

function workflowFeedbackPrompt(existing, images = []) {
  const messages = existing.messages || [];
  const lastAssistantIndex = messages.reduce((found, message, index) => message.role === 'assistant' ? index : found, -1);
  const feedback = messages.slice(lastAssistantIndex + 1).reverse().find(message => message.role === 'user' && message.kind === 'feedback');
  return `## Developer feedback turu\n\n${feedback?.content || 'Mevcut değişiklikleri yeniden incele, eksik kalan noktaları tamamla ve doğrulamaları çalıştır.'}${workflowImageContext(images)}\n\nMevcut çalışma ağacını koruyarak feedback'i uygula. Sonucu çıktı sözleşmesine göre özetle.`;
}

async function executeWorkflowTask(runState, profile, isResume) {
  try {
    const images = await resolveTaskImages(runState.id, runState.task.attachments);
    const prompt = `${await agentRule('executor')}\n\n${isResume ? workflowFeedbackPrompt(runState, images) : workflowTaskPrompt(runState.task, profile, images)}`;
    const result = await runLocalAgent({
      resolvedProvider: runState.provider,
      prompt,
      cwd: runState.repositoryPath,
      model: runState.model,
      effort: runState.effort,
      structured: false,
      mode: 'execute',
      sessionId: isResume ? runState.sessionId : null,
      images: images.map(image => image.path)
    });
    const changes = await workflowChanges(runState.repositoryPath);
    delete runState.diff;
    delete runState.diffTruncated;
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
  const sourceRepositoryPath = await resolveRepository(input.project);
  await gitAt(sourceRepositoryPath, ['rev-parse', '--is-inside-work-tree']);
  const existing = workflowRuns.get(id);
  if (existing?.status === 'running') throw new Error('Bu görev zaten çalışıyor.');
  if (existing?.sourceRepositoryPath && existing.sourceRepositoryPath !== sourceRepositoryPath) throw new Error('Devam eden agent oturumunun repository’si değiştirilemez.');
  const legacySession = Boolean(existing?.sessionId && !existing?.worktreePath);
  if (!existing?.worktreePath && !legacySession) {
    const dirty = (await gitAt(sourceRepositoryPath, ['status', '--porcelain'])).trim();
    if (dirty) throw new Error('Repository’de kaydedilmemiş değişiklikler var. Mevcut çalışmanı commit/stash yaptıktan sonra görevi yeniden In Progress’e taşı; böylece agent yalnızca kendi değişiklikleri üzerinde çalışır.');
  }
  const isResume = Boolean(existing?.sessionId);
  const agentSelection = await resolveLocalAgent(isResume
    ? { provider: existing.provider, model: existing.model, effort: existing.effort }
    : { provider: input.provider || 'auto', models: { codex: profile.codex.model, claude: profile.claude.model }, effort: profile.codex.effort });
  const now = new Date().toISOString();
  const images = await resolveTaskImages(id, input.attachments);
  const task = {
    title: input.title.trim(),
    description: String(input.description || '').trim(),
    project: input.project.trim(),
    points: profile.points,
    attachments: images.map(({ path, ...image }) => image),
    azureBoards: input.azureBoards && Number.isInteger(Number(input.azureBoards.id)) ? {
      id: Number(input.azureBoards.id),
      organization: String(input.azureBoards.organization || ''),
      project: String(input.azureBoards.project || ''),
      url: String(input.azureBoards.url || '')
    } : null,
    externalId: typeof input.externalId === 'string' ? input.externalId.trim() : ''
  };
  let worktreePath = existing?.worktreePath;
  let branchName = existing?.branchName;
  if (worktreePath && !(await isDirectory(worktreePath))) throw new Error('Görevin izole çalışma klasörü bulunamadı. Branch’i koruyarak görevi yeniden oluşturman gerekiyor.');
  if (!worktreePath && !legacySession) ({ worktreePath, branchName } = await prepareWorkflowWorktree(sourceRepositoryPath, id, task));
  const repositoryPath = legacySession ? existing.repositoryPath : worktreePath;
  const runState = {
    ...(existing || {}),
    id,
    task,
    repositoryPath,
    sourceRepositoryPath,
    worktreePath,
    branchName,
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
  runState.suggestedCommitMessage = suggestedCommitMessage(task);
  workflowRuns.set(id, runState);
  await persistWorkflowRuns();
  void executeWorkflowTask(runState, profile, isResume).catch(error => console.error('Workflow arka plan hatası:', error));
  return { accepted: true, id, status: 'running' };
}

async function completeWorkflowTask(id, input) {
  const workflowRun = workflowRuns.get(id);
  if (!workflowRun) throw new Error('Bu göreve ait agent çalışması bulunamadı.');
  if (workflowRun.status !== 'review') throw new Error(workflowRun.status === 'finalizing' ? 'Bu görev için tamamlama işlemi zaten sürüyor.' : 'Yalnızca review aşamasındaki görev tamamlanabilir.');
  if (!workflowRun.worktreePath || !workflowRun.branchName) throw new Error('Bu görev izole branch desteğinden önce başlatılmış. Güvenli commit için görevi yeni bir workflow çalışması olarak yeniden başlat.');
  if (!(await isDirectory(workflowRun.worktreePath))) throw new Error('Görevin izole çalışma klasörü bulunamadı.');

  const push = input.push === true;
  const message = validateCommitMessage(input.commitMessage || workflowRun.suggestedCommitMessage, workflowRun.task);
  workflowRun.status = 'finalizing';
  workflowRun.completionError = null;
  workflowRun.updatedAt = new Date().toISOString();
  workflowRuns.set(id, workflowRun);
  await persistWorkflowRuns();

  try {
    const currentBranch = (await gitAt(workflowRun.worktreePath, ['branch', '--show-current'])).trim();
    if (currentBranch !== workflowRun.branchName) throw new Error(`Beklenen görev branch’i aktif değil (${workflowRun.branchName}).`);

    if (!workflowRun.completion?.commitHash) {
      const head = (await gitAt(workflowRun.worktreePath, ['rev-parse', 'HEAD'])).trim();
      if (head !== workflowRun.baseCommit) throw new Error('Agent çalışma sırasında beklenmeyen bir commit oluşturmuş. Otomatik commit güvenlik nedeniyle durduruldu.');
      const changes = await workflowChanges(workflowRun.worktreePath);
      if (!changes.changedFiles.length) throw new Error('Commit oluşturulacak bir dosya değişikliği bulunamadı.');
      await gitAt(workflowRun.worktreePath, ['diff', '--check']);
      await gitAt(workflowRun.worktreePath, ['diff', '--cached', '--check']);
      await gitAt(workflowRun.worktreePath, ['add', '--all']);
      await gitAt(workflowRun.worktreePath, ['diff', '--cached', '--check']);
      await gitAt(workflowRun.worktreePath, ['commit', '-m', message]);
      const commitHash = (await gitAt(workflowRun.worktreePath, ['rev-parse', 'HEAD'])).trim();
      workflowRun.completion = { commitHash, commitMessage: message, branchName: workflowRun.branchName, pushed: false, committedAt: new Date().toISOString() };
      workflowRun.updatedAt = workflowRun.completion.committedAt;
      await persistWorkflowRuns();
    }

    if (push && !workflowRun.completion.pushed) {
      await gitAt(workflowRun.worktreePath, ['push', '--set-upstream', 'origin', workflowRun.branchName]);
      workflowRun.completion.pushed = true;
      workflowRun.completion.pushedAt = new Date().toISOString();
    }

    workflowRun.status = 'done';
    workflowRun.updatedAt = new Date().toISOString();
    workflowRuns.set(id, workflowRun);
    await persistWorkflowRuns();
    return { run: publicWorkflowRun(workflowRun) };
  } catch (error) {
    workflowRun.status = 'review';
    workflowRun.completionError = error.stderr?.trim() || error.detail || error.message || 'Görev tamamlanamadı.';
    workflowRun.updatedAt = new Date().toISOString();
    workflowRuns.set(id, workflowRun);
    await persistWorkflowRuns();
    throw new Error(workflowRun.completionError);
  }
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
    return send(res, 200, { runs: [...workflowRuns.values()].map(publicWorkflowRun) });
  }
  if (req.method === 'POST' && req.url === '/api/azure-boards/import') {
    try {
      const input = await readJson(req, 20_000);
      return send(res, 200, await azureBoardItems(input));
    } catch (error) {
      return send(res, 400, { error: error.message || 'Azure Boards işleri okunamadı.' });
    }
  }
  const workflowAssetsMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)\/assets$/);
  if (req.method === 'POST' && workflowAssetsMatch) {
    try {
      const id = decodeURIComponent(workflowAssetsMatch[1]);
      const input = await readJson(req, 30_000_000);
      const attachments = await saveTaskImages(id, input.images);
      return send(res, 201, { attachments });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Görev görselleri kaydedilemedi.' });
    }
  }
  if (req.method === 'PUT' && workflowAssetsMatch) {
    try {
      const id = decodeURIComponent(workflowAssetsMatch[1]);
      const input = await readJson(req, 30_000_000);
      const attachments = await updateTaskImages(id, { keepIds: input.keepIds, images: input.images });
      return send(res, 200, { attachments });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Görev görselleri güncellenemedi.' });
    }
  }
  const workflowAssetMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)\/assets\/([^/]+)$/);
  if (req.method === 'GET' && workflowAssetMatch) {
    try {
      const image = await readTaskImage(decodeURIComponent(workflowAssetMatch[1]), decodeURIComponent(workflowAssetMatch[2]));
      return send(res, 200, image.data, image.type);
    } catch {
      return send(res, 404, 'Görsel bulunamadı.', 'text/plain; charset=utf-8');
    }
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
  const workflowCompleteMatch = req.url?.match(/^\/api\/workflow\/tasks\/([^/]+)\/complete$/);
  if (req.method === 'POST' && workflowCompleteMatch) {
    try {
      const id = decodeURIComponent(workflowCompleteMatch[1]);
      const input = await readJson(req, 10_000);
      return send(res, 200, await completeWorkflowTask(id, input));
    } catch (error) {
      return send(res, 400, { error: error.message || 'Görev tamamlanamadı.' });
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
    await deleteTaskImages(id);
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    const [providers, usage] = await Promise.all([providerStatuses(), agentUsage()]);
    return send(res, 200, { connected: providers.some(provider => provider.available), providers, usage });
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
