const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const storageKey = 'orbit-developer-cockpit-v1';
const today = new Date();
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const timeLabel = () => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
const taskProfiles = {
  2: { label: 'Küçük', codex: 'GPT-5.6 Luna · düşük', claude: 'Claude Haiku' },
  3: { label: 'Orta', codex: 'GPT-5.6 Terra · orta', claude: 'Claude Sonnet' },
  5: { label: 'Kapsamlı', codex: 'GPT-5.6 Sol · yüksek', claude: 'Claude Opus' }
};
const taskPoints = value => [2, 3, 5].includes(Number(value)) ? Number(value) : 3;
const taskAttachmentUrl = (task, attachment) => `/api/workflow/tasks/${encodeURIComponent(task.id)}/assets/${encodeURIComponent(attachment.id)}`;

const defaults = {
  reviews: 0,
  reviewProvider: 'auto',
  tasks: [
    { id: crypto.randomUUID(), title: 'Developer portal iskeletini tamamla', description: 'Ana modüller ve proje odaklı navigasyon.', project: 'Developer Portal', points: 5, status: 'doing', createdAt: Date.now() },
    { id: crypto.randomUUID(), title: 'Workflow görevlerine proje bağlamı ekle', description: 'Her görev kendi projesini bağımsız olarak taşısın.', project: 'Developer Portal', points: 3, status: 'todo', createdAt: Date.now() - 1000 },
    { id: crypto.randomUUID(), title: 'Proje seçim deneyimini tasarla', description: 'Kayıtlı repository’ler arasında hızlı geçiş.', project: 'Developer Portal', points: 3, status: 'todo', createdAt: Date.now() - 2000 },
    { id: crypto.randomUUID(), title: 'Local state kalıcılığını doğrula', description: 'Workflow durumunun tarayıcıda korunduğunu doğrula.', project: 'Developer Portal', points: 2, status: 'done', createdAt: Date.now() - 3000 }
  ],
  activities: [
    { icon: '⌂', title: 'Developer portal çalışma alanı açıldı', detail: 'Bağımsız araçlar kullanıma hazır', at: 'şimdi' },
    { icon: '✓', title: 'Diff kapsam testleri geçti', detail: '5 kontrol başarıyla tamamlandı', at: 'bugün' },
    { icon: '◇', title: 'Developer portal fikri eklendi', detail: 'Workflow ve journal modülleri', at: 'bugün' }
  ],
  journal: {
    [dateKey(today)]: [
      { time: '09:30', title: 'Developer cockpit başlangıcı', text: 'Review, workflow ve günlük hafıza modüllerinin bağımsız çalışacağı ürün yapısı netleştirildi.', tags: ['ürün', 'mimari'] },
      { time: '11:10', title: 'Review güven sınırları', text: 'AI bulgularının sadece diff içindeki eklenen satırlara bağlanması ana kalite kuralı olarak korundu.', tags: ['review', 'karar'] }
    ]
  }
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Array.isArray(saved.tasks)) return structuredClone(defaults);
    const legacyTaskUpdates = {
      'Review sonuçlarını journal akışına bağla': { title: 'Workflow görevlerine proje bağlamı ekle', description: 'Her görev kendi projesini bağımsız olarak taşısın.' },
      'Diff kapsam filtresi': { title: 'Local state kalıcılığını doğrula', description: 'Workflow durumunun tarayıcıda korunduğunu doğrula.' }
    };
    const seedTitles = new Set(['Developer portal iskeletini tamamla', 'Review sonuçlarını journal akışına bağla', 'Proje seçim deneyimini tasarla', 'Diff kapsam filtresi']);
    const seedPoints = {
      'Developer portal iskeletini tamamla': 5,
      'Review sonuçlarını journal akışına bağla': 3,
      'Workflow görevlerine proje bağlamı ekle': 3,
      'Proje seçim deneyimini tasarla': 3,
      'Diff kapsam filtresi': 2,
      'Local state kalıcılığını doğrula': 2
    };
    return {
      ...defaults,
      reviews: Number.isFinite(saved.reviews) ? saved.reviews : defaults.reviews,
      reviewProvider: typeof saved.reviewProvider === 'string' ? saved.reviewProvider : typeof saved.provider === 'string' ? saved.provider : defaults.reviewProvider,
      tasks: saved.tasks.map(task => {
        const legacyUpdate = legacyTaskUpdates[task.title];
        const legacyProject = task.project === 'AI Reviewer';
        return {
          ...task,
          ...(legacyUpdate || {}),
          project: legacyProject ? (seedTitles.has(task.title) ? 'Developer Portal' : 'Genel') : typeof task.project === 'string' && task.project.trim() ? task.project : task.azureBoards ? '' : 'Genel',
          points: seedPoints[task.title] || ([2, 3, 5].includes(Number(task.points)) ? Number(task.points) : task.priority === 'high' ? 5 : task.priority === 'low' ? 2 : 3),
          attachments: Array.isArray(task.attachments) ? task.attachments.filter(attachment => attachment && typeof attachment.id === 'string') : [],
          workflowStarting: false
        };
      }),
      activities: Array.isArray(saved.activities) ? saved.activities : defaults.activities,
      journal: saved.journal && typeof saved.journal === 'object' ? saved.journal : defaults.journal
    };
  } catch { return structuredClone(defaults); }
}

let state = loadState();
let savedProjects = [];
let workflowRuns = new Map();
let workflowRunSignature = '';
let automaticWorkflowProvider = 'auto';
let calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedJournalDate = dateKey(today);

function saveState() { localStorage.setItem(storageKey, JSON.stringify(state)); }

function setProjectFeedback(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('success', Boolean(message) && !isError);
}

function syncSavedProjectUI() {
  $('#project-options').innerHTML = savedProjects.map(project => `<option value="${escape(project.name)}">${escape(project.path)}</option>`).join('');
  $('#project-hint').textContent = savedProjects.length ? `${savedProjects.length} proje bu bilgisayarda kayıtlı.` : 'Yerel Git repository kökünü seç.';
  $$('[data-project-list]').forEach(list => {
    list.innerHTML = savedProjects.length
      ? savedProjects.map(project => `<button type="button" data-saved-project="${escape(project.name)}" title="${escape(project.path)}"><b>${escape(project.name)}</b><small>${escape(project.path)}</small></button>`).join('')
      : '<span class="saved-project-empty">Henüz kayıtlı proje yok.</span>';
    [...list.querySelectorAll('[data-saved-project]')].forEach(projectButton => projectButton.addEventListener('click', () => {
      const project = savedProjects.find(item => item.name === projectButton.dataset.savedProject);
      const input = document.getElementById(list.dataset.target);
      if (!project || !input) return;
      input.value = project.name;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      setProjectFeedback(document.getElementById(list.dataset.feedback), `${project.name} seçildi.`);
    }));
  });
}

async function rememberProject(selection, feedback) {
  const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: selection }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Proje kaydedilemedi.');
  savedProjects = data.projects;
  syncSavedProjectUI();
  setProjectFeedback(feedback, `${data.project.name} yerel proje listesine kaydedildi.`);
  return data.project;
}

function showView(name, updateHash = true) {
  const target = $(`[data-view-panel="${name}"]`) ? name : 'dashboard';
  $$('.view').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === target));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === target));
  $('.sidebar').classList.remove('open');
  if (updateHash) history.replaceState(null, '', `#${target}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
$$('[data-view-target]').forEach(item => item.addEventListener('click', () => showView(item.dataset.viewTarget)));
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('.brand').addEventListener('click', event => { event.preventDefault(); showView('dashboard'); });

$$('[data-pick-folder]').forEach(button => button.addEventListener('click', async () => {
  const input = document.getElementById(button.dataset.target);
  const feedback = document.getElementById(button.dataset.feedback);
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Finder açılıyor…';
  setProjectFeedback(feedback, '');
  try {
    const response = await fetch('/api/folder/select', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Klasör seçici açılamadı.');
    if (data.cancelled) return;
    input.value = data.path;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    const project = await rememberProject(data.path, feedback);
    input.value = project.name;
  } catch (error) {
    setProjectFeedback(feedback, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}));

$$('[data-save-project]').forEach(button => button.addEventListener('click', async () => {
  const input = document.getElementById(button.dataset.target);
  const feedback = document.getElementById(button.dataset.feedback);
  const originalLabel = button.textContent;
  if (!input?.value.trim()) {
    setProjectFeedback(feedback, 'Önce bir repository yolu seç veya yaz.', true);
    return;
  }
  button.disabled = true;
  button.textContent = 'Kaydediliyor…';
  setProjectFeedback(feedback, '');
  try {
    const project = await rememberProject(input.value.trim(), feedback);
    input.value = project.name;
  } catch (error) {
    setProjectFeedback(feedback, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}));

const columns = [
  { id: 'todo', label: 'TO DO' },
  { id: 'doing', label: 'IN PROGRESS' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' }
];

const workflowProviderLabel = provider => provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Yerel agent';

function workflowRunCard(task, run) {
  if (task.workflowStarting) return '<div class="run-state running"><i></i><span><b>Agent başlatılıyor</b><small>Provider ve model hazırlandıktan sonra çalışma başlayacak.</small></span></div>';
  if (!run && task.status === 'doing') return '<div class="run-state idle">Hazır · yeniden tetiklemek için başka bir kolona, ardından In Progress’e taşı.</div>';
  if (!run) return '';
  const provider = workflowProviderLabel(run.provider);
  if (run.status === 'running') return `<div class="run-state running"><i></i><span><b>${escape(provider)} çalışıyor</b><small>${escape(run.model || 'varsayılan model')} · ${run.attempt || 1}. tur</small></span></div>`;
  if (run.status === 'finalizing') return '<div class="run-state running"><i></i><span><b>Görev tamamlanıyor</b><small>Commit ve branch işlemleri yürütülüyor.</small></span></div>';
  if (run.status === 'failed') return `<div class="run-state failed"><b>Çalışma tamamlanamadı</b><span>${escape(run.error || 'Bilinmeyen agent hatası')}</span></div>`;
  if (task.status === 'done' && run.completion?.commitHash) return `<div class="completion-state"><b>${run.completion.pushed ? 'Commit oluşturuldu ve push edildi' : 'Yerel commit oluşturuldu'}</b><code>${escape(run.completion.commitHash.slice(0, 8))} · ${escape(run.completion.branchName)}</code></div>`;
  if (task.status !== 'review') return '';
  return `<div class="review-ready"><div><b>Review’a hazır</b><small>${escape(provider)} · ${escape(run.model || '')} · ${run.changedFiles?.length || 0} değişen dosya</small></div><button type="button" draggable="false" data-open-workflow-details="${escape(task.id)}">Detayları gör <span>→</span></button></div>`;
}

function openWorkflowTaskDetails(taskId) {
  const task = state.tasks.find(item => item.id === taskId);
  const run = workflowRuns.get(taskId);
  if (!task || !run || run.status !== 'review') return;
  const provider = workflowProviderLabel(run.provider);
  const dialog = $('#workflow-task-dialog');
  dialog.dataset.taskId = taskId;
  $('#workflow-task-title').textContent = task.title;
  $('#workflow-task-meta').innerHTML = `<span>${escape(task.project || 'Projesiz')}</span><span>${taskPoints(task.points)} puan</span><span>${escape(provider)}</span><span>${escape(run.model || 'varsayılan model')}</span><span>${run.attempt || 1}. tur</span>${run.branchName ? `<span>${escape(run.branchName)}</span>` : ''}`;
  $('#workflow-task-description').textContent = task.description || 'Ek görev açıklaması bulunmuyor.';
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  $('#workflow-task-images-section').hidden = !attachments.length;
  $('#workflow-task-image-count').textContent = `${attachments.length} görsel`;
  $('#workflow-task-images').innerHTML = attachments.map(attachment => {
    const url = taskAttachmentUrl(task, attachment);
    return `<a href="${escape(url)}" target="_blank" rel="noreferrer" title="${escape(attachment.name)}"><img src="${escape(url)}" alt="${escape(attachment.name)}" loading="lazy" /><span>${escape(attachment.name)}</span></a>`;
  }).join('');
  $('#workflow-task-summary').textContent = run.summary || 'Agent özeti bulunmuyor.';
  $('#workflow-task-files').innerHTML = (run.changedFiles || []).map(file => `<span>${escape(file)}</span>`).join('');
  $('#workflow-task-change-count').textContent = `${run.changedFiles?.length || 0} dosya`;
  $('#workflow-task-files-empty').hidden = Boolean(run.changedFiles?.length);
  $('#workflow-task-chat').innerHTML = (run.messages || []).map(message => `<article class="chat-message ${message.role}"><span>${message.role === 'user' ? 'Sen' : escape(provider)}</span><p>${escape(message.content)}</p></article>`).join('');
  const feedbackForm = $('#workflow-task-feedback');
  feedbackForm.dataset.taskId = taskId;
  feedbackForm.reset();
  feedbackForm.querySelector('small').textContent = '';
  $('#workflow-complete-open').dataset.taskId = taskId;
  if (!dialog.open) dialog.showModal();
}

const workflowCompleteDialog = $('#workflow-complete-dialog');
const workflowCompleteForm = $('#workflow-complete-form');

function openWorkflowCompletion(taskId) {
  const task = state.tasks.find(item => item.id === taskId);
  const run = workflowRuns.get(taskId);
  if (!task || !run || run.status !== 'review') return;
  workflowCompleteForm.dataset.taskId = taskId;
  workflowCompleteForm.reset();
  $('#completion-task-title').textContent = task.title;
  $('#completion-branch').textContent = run.branchName || 'İzole branch bilgisi bulunamadı';
  $('#completion-file-count').textContent = `${run.changedFiles?.length || 0} değişen dosya · önce Git diff kontrolü çalıştırılır`;
  const messageInput = $('#completion-commit-message');
  messageInput.value = run.completion?.commitMessage || run.suggestedCommitMessage || '';
  messageInput.disabled = Boolean(run.completion?.commitHash);
  workflowCompleteForm.elements.namedItem('push').checked = false;
  $('#completion-error').textContent = run.completionError || (run.worktreePath ? '' : 'Bu görev eski çalışma düzeninde başlatılmış. Güvenli commit için yeniden başlatılması gerekir.');
  $('#workflow-complete-submit').textContent = run.completion?.commitHash ? 'Tamamla' : 'Commit oluştur ve tamamla';
  if ($('#workflow-task-dialog').open) $('#workflow-task-dialog').close();
  if (!workflowCompleteDialog.open) workflowCompleteDialog.showModal();
}

async function startWorkflowTask(task, { failureStatus } = {}) {
  delete task.workflowError;
  task.workflowStarting = true;
  saveState();
  renderTasks();
  try {
    const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(task.id)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...task, provider: 'auto' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Workflow görevi başlatılamadı.');
    delete task.workflowStarting;
    saveState();
    await syncWorkflowRuns();
    return true;
  } catch (error) {
    delete task.workflowStarting;
    if (failureStatus) task.status = failureStatus;
    task.workflowError = error.message;
    addActivity('!', `${task.title} başlatılamadı`, error.message);
    persistAndRender();
    return false;
  }
}

async function moveWorkflowTask(task, status) {
  const run = workflowRuns.get(task.id);
  if (['running', 'finalizing'].includes(run?.status)) return;
  if (status === 'done' && task.status === 'review' && run?.status === 'review') {
    openWorkflowCompletion(task.id);
    return;
  }
  task.status = status;
  addActivity('◇', `${task.title} taşındı`, columns.find(item => item.id === status).label.toLocaleLowerCase('tr-TR'));
  if (status === 'done') addJournalEntry(`Görev tamamlandı: ${task.title}`, task.description || 'Workflow görevi tamamlandı.', ['workflow', 'tamamlandı']);
  persistAndRender();
  if (status === 'doing') await startWorkflowTask(task);
}

function applyWorkflowCompletion(task, run) {
  task.status = 'done';
  const commitHash = run.completion?.commitHash;
  if (!commitHash || task.lastCompletionCommit === commitHash) return;
  task.lastCompletionCommit = commitHash;
  delete task.workflowError;
  addActivity('✓', `${task.title} tamamlandı`, `${commitHash.slice(0, 8)} · ${run.completion.pushed ? 'branch push edildi' : 'yerel commit'}`);
  addJournalEntry(`Görev tamamlandı: ${task.title}`, run.completion.commitMessage || task.description || 'Workflow görevi tamamlandı.', ['workflow', 'tamamlandı', 'commit']);
}

function renderTasks() {
  $('#kanban').innerHTML = columns.map(column => {
    const tasks = state.tasks.filter(task => task.status === column.id);
    const cards = tasks.map(task => {
      const points = taskPoints(task.points);
      const profile = taskProfiles[points];
      const run = workflowRuns.get(task.id);
      const running = ['running', 'finalizing'].includes(run?.status);
      const localError = task.workflowError && !['running', 'review'].includes(run?.status) ? `<div class="run-state failed"><b>Başlatılamadı</b><span>${escape(task.workflowError)}</span></div>` : '';
      const azureLink = task.azureBoards?.url ? `<a class="azure-work-item" href="${escape(task.azureBoards.url)}" target="_blank" rel="noreferrer" title="Azure Boards #${escape(task.azureBoards.id)} işini aç">AB#${escape(task.azureBoards.id)}${task.azureBoards.storyPoints !== null && task.azureBoards.storyPoints !== undefined ? ` · SP ${escape(task.azureBoards.storyPoints)}` : ''} ↗</a>` : '';
      const externalIdBadge = !task.azureBoards && task.externalId ? `<span class="task-reference">${escape(task.externalId)}</span>` : '';
      const attachmentBadge = task.attachments?.length ? `<span class="task-attachment-badge">▧ ${task.attachments.length} görsel</span>` : '';
      const projectControl = task.azureBoards && !task.project
        ? `<select class="task-project-select" data-task-project-select="${escape(task.id)}" aria-label="Repository seç"><option value="">Repository seç…</option>${savedProjects.map(project => `<option value="${escape(project.name)}">${escape(project.name)}</option>`).join('')}</select>`
        : `<span class="task-tag">${escape(task.project || 'Projesiz')}</span>`;
      const editAction = task.status === 'todo' ? `<button class="task-edit" type="button" data-edit-task="${escape(task.id)}" aria-label="Görevi düzenle" title="Görevi düzenle">Düzenle</button>` : '';
      return `<article class="task-card${running ? ' is-running' : ''}${task.status === 'review' ? ' is-review' : ''}" draggable="${running ? 'false' : 'true'}" data-task-id="${escape(task.id)}"><div class="task-card-actions">${editAction}<button class="task-menu" type="button" data-delete-task="${escape(task.id)}" aria-label="Görevi sil" ${running ? 'disabled' : ''}>×</button></div><h3>${escape(task.title)}</h3>${task.description ? `<p>${escape(task.description)}</p>` : ''}<div class="task-footer">${projectControl}<span class="task-points points-${points}" title="${escape(profile.codex)} · ${escape(profile.claude)}">${points} puan · ${escape(profile.label)}</span></div>${azureLink}${externalIdBadge}${attachmentBadge}${localError || workflowRunCard(task, run)}</article>`;
    }).join('');
    return `<section class="kanban-column" data-status="${column.id}"><header class="column-head"><span>${column.label}</span><span class="column-count">${tasks.length}</span></header><div class="task-list">${cards}</div></section>`;
  }).join('');

  $$('.task-card').forEach(card => {
    card.addEventListener('dragstart', event => {
      if (card.draggable === false || event.target.closest('button, a, textarea, input, select, form')) return event.preventDefault();
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    const task = state.tasks.find(item => item.id === card.dataset.taskId);
    if (task?.status === 'review' && workflowRuns.get(task.id)?.status === 'review') {
      card.addEventListener('click', event => {
        if (!event.target.closest('button, a, textarea, input, form')) openWorkflowTaskDetails(task.id);
      });
    }
  });
  $$('.kanban-column').forEach(column => {
    column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('dragover'); });
    column.addEventListener('dragleave', () => column.classList.remove('dragover'));
    column.addEventListener('drop', async event => {
      event.preventDefault();
      column.classList.remove('dragover');
      const card = $('.task-card.dragging');
      const task = state.tasks.find(item => item.id === card?.dataset.taskId);
      if (!task || task.status === column.dataset.status) return;
      await moveWorkflowTask(task, column.dataset.status);
    });
  });
  $$('[data-delete-task]').forEach(button => button.addEventListener('click', async () => {
    await fetch(`/api/workflow/tasks/${encodeURIComponent(button.dataset.deleteTask)}`, { method: 'DELETE' }).catch(() => null);
    state.tasks = state.tasks.filter(task => task.id !== button.dataset.deleteTask);
    persistAndRender();
  }));
  $$('[data-edit-task]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const task = state.tasks.find(item => item.id === button.dataset.editTask && item.status === 'todo');
    if (task) openTaskDialog(task);
  }));
  $$('[data-task-project-select]').forEach(select => select.addEventListener('change', event => {
    const task = state.tasks.find(item => item.id === event.currentTarget.dataset.taskProjectSelect);
    if (!task || !event.currentTarget.value) return;
    task.project = event.currentTarget.value;
    addActivity('⌁', `${task.title} için repository seçildi`, task.project);
    persistAndRender();
  }));
  $$('[data-open-workflow-details]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openWorkflowTaskDetails(button.dataset.openWorkflowDetails);
  }));
}

$('#workflow-task-close').addEventListener('click', () => $('#workflow-task-dialog').close());
$('#workflow-complete-open').addEventListener('click', event => openWorkflowCompletion(event.currentTarget.dataset.taskId));
workflowCompleteForm.elements.namedItem('push').addEventListener('change', event => {
  const run = workflowRuns.get(workflowCompleteForm.dataset.taskId);
  $('#workflow-complete-submit').textContent = event.currentTarget.checked
    ? (run?.completion?.commitHash ? 'Push et ve tamamla' : 'Commit oluştur ve push et')
    : (run?.completion?.commitHash ? 'Tamamla' : 'Commit oluştur ve tamamla');
});
workflowCompleteForm.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const taskId = workflowCompleteForm.dataset.taskId;
  const task = state.tasks.find(item => item.id === taskId);
  const button = $('#workflow-complete-submit');
  const errorBox = $('#completion-error');
  if (!task) return;
  button.disabled = true;
  errorBox.textContent = '';
  button.textContent = workflowCompleteForm.elements.namedItem('push').checked ? 'Commit ve push hazırlanıyor…' : 'Commit hazırlanıyor…';
  try {
    const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(taskId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitMessage: $('#completion-commit-message').value,
        push: workflowCompleteForm.elements.namedItem('push').checked
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Görev tamamlanamadı.');
    workflowRuns.set(taskId, data.run);
    applyWorkflowCompletion(task, data.run);
    persistAndRender();
    workflowCompleteDialog.close();
  } catch (error) {
    errorBox.textContent = error.message;
    await syncWorkflowRuns();
  } finally {
    button.disabled = false;
    const run = workflowRuns.get(taskId);
    if (run?.completion?.commitHash) {
      $('#completion-commit-message').value = run.completion.commitMessage;
      $('#completion-commit-message').disabled = true;
    }
    button.textContent = run?.completion?.commitHash ? 'Tamamla' : 'Commit oluştur ve tamamla';
  }
});
$('#workflow-task-feedback').addEventListener('submit', async event => {
  event.preventDefault();
  const feedbackForm = event.currentTarget;
  const button = feedbackForm.querySelector('button');
  const status = feedbackForm.querySelector('small');
  const feedback = feedbackForm.elements.feedback.value.trim();
  button.disabled = true;
  status.textContent = 'Gönderiliyor…';
  try {
    const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(feedbackForm.dataset.taskId)}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Feedback gönderilemedi.');
    const task = state.tasks.find(item => item.id === feedbackForm.dataset.taskId);
    if (!task) throw new Error('Workflow görevi bulunamadı.');
    $('#workflow-task-dialog').close();
    task.status = 'doing';
    addActivity('↻', `${task.title} feedback ile yeniden başlatıldı`, 'Agent aynı çalışma oturumunda devam ediyor');
    persistAndRender();
    await startWorkflowTask(task, { failureStatus: 'review' });
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

function addActivity(icon, title, detail) {
  state.activities.unshift({ icon, title, detail, at: timeLabel() });
  state.activities = state.activities.slice(0, 12);
}

function addJournalEntry(title, text, tags = ['not']) {
  const key = dateKey(new Date());
  state.journal[key] ||= [];
  state.journal[key].unshift({ time: timeLabel(), title, text, tags });
}

function renderDashboard() {
  $('#today-label').textContent = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(today).toLocaleUpperCase('tr-TR');
  const open = state.tasks.filter(task => task.status !== 'done');
  const completed = state.tasks.filter(task => task.status === 'done').length;
  const progress = state.tasks.length ? Math.round((completed / state.tasks.length) * 100) : 0;
  const focus = state.tasks.find(task => task.status === 'doing') || open[0];
  $('#task-count').textContent = open.length;
  $('#review-count').textContent = state.reviews;
  $('#completion-bar').style.width = `${progress}%`;
  $('#completion-label').textContent = `%${progress} tamamlandı`;
  $('#focus-title').textContent = focus?.title || 'Bugünün görevleri tamamlandı';
  $('#focus-kicker').textContent = focus ? `${(focus.project || 'PROJESİZ').toLocaleUpperCase('tr-TR')} · ${columns.find(column => column.id === focus.status)?.label}` : 'WORKFLOW · CLEAR';
  $('#focus-complexity').textContent = focus ? `${taskPoints(focus.points)} puan` : '0 puan';
  $('#focus-agent').textContent = focus ? 'Otomatik agent' : 'Görev yok';
  $('#complete-focus').disabled = !focus || workflowRuns.get(focus?.id)?.status === 'running';
  $('#complete-focus').dataset.taskId = focus?.id || '';
  $('#activity-list').innerHTML = state.activities.slice(0, 4).map(item => `<article class="activity-item"><span class="activity-dot">${escape(item.icon)}</span><div><b>${escape(item.title)}</b><p>${escape(item.detail)}</p></div><time>${escape(item.at)}</time></article>`).join('');
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $('#calendar-month').textContent = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(calendarDate);
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);
  $('#calendar-grid').innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    const classes = ['calendar-day'];
    if (day.getMonth() !== month) classes.push('muted');
    if (key === selectedJournalDate) classes.push('selected');
    if (key === dateKey(today)) classes.push('today');
    if (state.journal[key]?.length) classes.push('has-entry');
    const label = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(day);
    const current = key === dateKey(today) ? ' aria-current="date"' : '';
    return `<button class="${classes.join(' ')}" data-journal-date="${key}" type="button" aria-label="${escape(label)}" aria-pressed="${key === selectedJournalDate}"${current}>${day.getDate()}</button>`;
  }).join('');
  $$('[data-journal-date]').forEach(button => button.addEventListener('click', () => {
    selectedJournalDate = button.dataset.journalDate;
    const selected = new Date(`${selectedJournalDate}T12:00:00`);
    if (selected.getMonth() !== month || selected.getFullYear() !== year) calendarDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderJournal();
  }));
}

function renderJournal() {
  const selected = new Date(`${selectedJournalDate}T12:00:00`);
  const isToday = selectedJournalDate === dateKey(today);
  $('#journal-date-title').textContent = isToday ? 'Bugün' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(selected);
  const entries = state.journal[selectedJournalDate] || [];
  $('#journal-entries').innerHTML = entries.length ? entries.map(entry => `<article class="journal-entry"><time>${escape(entry.time)}</time><h3>${escape(entry.title)}</h3></article>`).join('') : '<div class="journal-empty">Bu gün için henüz bir çalışma notu yok.</div>';
  renderCalendar();
}

function persistAndRender() {
  saveState();
  renderTasks();
  renderDashboard();
  renderJournal();
}

async function syncWorkflowRuns() {
  try {
    const response = await fetch('/api/workflow/runs');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Workflow çalışmaları okunamadı.');
    const signature = JSON.stringify((data.runs || []).map(run => [run.id, run.status, run.updatedAt, run.attempt]));
    if (signature === workflowRunSignature) return;
    workflowRunSignature = signature;
    workflowRuns = new Map((data.runs || []).map(run => [run.id, run]));
    let stateChanged = false;
    for (const task of state.tasks) {
      const run = workflowRuns.get(task.id);
      if (!run) continue;
      if (task.workflowStarting) {
        if (run.status === 'running' || run.status === 'failed') {
          delete task.workflowStarting;
          stateChanged = true;
        } else continue;
      }
      if (run.status === 'review' && task.status === 'doing') {
        task.status = 'review';
        delete task.workflowError;
        if (task.lastReviewAttempt !== run.attempt) {
          task.lastReviewAttempt = run.attempt;
          addActivity('✓', `${task.title} review’a hazır`, `${run.provider === 'claude' ? 'Claude Code' : 'Codex'} · ${run.changedFiles?.length || 0} değişen dosya`);
          addJournalEntry(`Agent çalışması review’a hazır: ${task.title}`, run.summary || 'Workflow agent çalışması tamamlandı.', ['workflow', 'review']);
        }
        stateChanged = true;
      }
      if (run.status === 'done' && task.status !== 'done') {
        applyWorkflowCompletion(task, run);
        stateChanged = true;
      }
      if (run.status === 'failed' && task.lastFailureAttempt !== run.attempt) {
        task.lastFailureAttempt = run.attempt;
        addActivity('!', `${task.title} tamamlanamadı`, run.error || 'Yerel agent hatası');
        stateChanged = true;
      }
    }
    if (stateChanged) saveState();
    renderTasks();
    renderDashboard();
    if (stateChanged) renderJournal();
  } catch (error) {
    console.warn(error.message);
  }
}

$('#complete-focus').addEventListener('click', async event => {
  const task = state.tasks.find(item => item.id === event.currentTarget.dataset.taskId);
  if (!task || ['running', 'finalizing'].includes(workflowRuns.get(task.id)?.status)) return;
  await moveWorkflowTask(task, 'done');
});

const taskDialog = $('#task-dialog');
const taskForm = $('#task-form');
const azureBoardsDialog = $('#azure-boards-dialog');
const azureBoardsForm = $('#azure-boards-form');
const taskImagesInput = $('#task-images');
const taskImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
let selectedTaskImages = [];
let retainedTaskAttachments = [];
let taskImagePreviewUrls = [];
let editingTaskId = null;

function renderTaskImagePreviews() {
  taskImagePreviewUrls.forEach(URL.revokeObjectURL);
  taskImagePreviewUrls = selectedTaskImages.map(file => URL.createObjectURL(file));
  const task = editingTaskId ? { id: editingTaskId } : null;
  const retainedItems = retainedTaskAttachments.map(attachment => `<div class="task-image-item"><img src="${escape(taskAttachmentUrl(task, attachment))}" alt="${escape(attachment.name)}" /><span>${escape(attachment.name)}</span><button type="button" data-remove-retained-image="${escape(attachment.id)}" aria-label="${escape(attachment.name)} görselini kaldır">×</button></div>`).join('');
  const newItems = selectedTaskImages.map((file, index) => `<div class="task-image-item is-new"><img src="${taskImagePreviewUrls[index]}" alt="${escape(file.name)}" /><span>${escape(file.name)}</span><button type="button" data-remove-task-image="${index}" aria-label="${escape(file.name)} görselini kaldır">×</button></div>`).join('');
  $('#task-image-preview').innerHTML = retainedItems + newItems;
  $$('[data-remove-retained-image]').forEach(button => button.addEventListener('click', () => {
    retainedTaskAttachments = retainedTaskAttachments.filter(attachment => attachment.id !== button.dataset.removeRetainedImage);
    renderTaskImagePreviews();
  }));
  $$('[data-remove-task-image]').forEach(button => button.addEventListener('click', () => {
    selectedTaskImages.splice(Number(button.dataset.removeTaskImage), 1);
    renderTaskImagePreviews();
  }));
}

function resetTaskImages() {
  selectedTaskImages = [];
  retainedTaskAttachments = [];
  taskImagesInput.value = '';
  renderTaskImagePreviews();
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`${file.name} okunamadı.`));
    reader.readAsDataURL(file);
  });
}

async function persistTaskImages(taskId, isEditing) {
  if (!isEditing && !selectedTaskImages.length) return [];
  const images = await Promise.all(selectedTaskImages.map(async file => ({ name: file.name, type: file.type, data: await fileDataUrl(file) })));
  const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(taskId)}/assets`, {
    method: isEditing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isEditing ? { keepIds: retainedTaskAttachments.map(attachment => attachment.id), images } : { images })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Görev görselleri ${isEditing ? 'güncellenemedi' : 'kaydedilemedi'}.`);
  return data.attachments || [];
}

function updateTaskModelHint() {
  const points = taskPoints(taskForm.elements.points.value);
  const profile = taskProfiles[points];
  const route = automaticWorkflowProvider === 'codex' ? profile.codex : automaticWorkflowProvider === 'claude' ? profile.claude : `${profile.codex} / ${profile.claude}`;
  $('#task-model-hint').textContent = `Otomatik agent · ${route}`;
}

function openTaskDialog(task = null) {
  taskForm.reset();
  editingTaskId = task?.id || null;
  resetTaskImages();
  retainedTaskAttachments = task?.attachments ? [...task.attachments] : [];
  if (task) {
    taskForm.elements.title.value = task.title;
    taskForm.elements.externalId.value = task.azureBoards?.id ? `AB#${task.azureBoards.id}` : task.externalId || '';
    taskForm.elements.externalId.disabled = Boolean(task.azureBoards);
    taskForm.elements.project.value = task.project || '';
    taskForm.elements.points.value = String(taskPoints(task.points));
    taskForm.elements.description.value = task.description || '';
  }
  taskForm.elements.project.required = !task?.azureBoards;
  if (!task) taskForm.elements.externalId.disabled = false;
  $('#task-dialog-kicker').textContent = task ? 'GÖREVİ DÜZENLE' : 'YENİ GÖREV';
  $('#task-dialog-title').textContent = task ? 'Detayları güncelle' : 'Odağı tanımla';
  $('#task-submit').textContent = task ? 'Değişiklikleri kaydet' : 'Görevi ekle';
  $('#task-error').textContent = '';
  updateTaskModelHint();
  renderTaskImagePreviews();
  taskDialog.showModal();
}

$$('[data-open-task]').forEach(button => button.addEventListener('click', () => openTaskDialog()));
taskForm.elements.points.addEventListener('change', updateTaskModelHint);
taskImagesInput.addEventListener('change', event => {
  const files = [...event.currentTarget.files];
  event.currentTarget.value = '';
  const invalidType = files.find(file => !taskImageTypes.has(file.type));
  const oversized = files.find(file => file.size > 5 * 1024 * 1024);
  if (invalidType) return void ($('#task-error').textContent = 'Yalnızca PNG, JPEG veya WEBP görselleri eklenebilir.');
  if (oversized) return void ($('#task-error').textContent = `${oversized.name} 5 MB sınırını aşıyor.`);
  if (retainedTaskAttachments.length + selectedTaskImages.length + files.length > 5) return void ($('#task-error').textContent = 'Bir göreve en fazla 5 görsel eklenebilir.');
  const retainedBytes = retainedTaskAttachments.reduce((total, attachment) => total + Number(attachment.size || 0), 0);
  if (retainedBytes + [...selectedTaskImages, ...files].reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) return void ($('#task-error').textContent = 'Görev görsellerinin toplam boyutu en fazla 20 MB olabilir.');
  selectedTaskImages.push(...files);
  $('#task-error').textContent = '';
  renderTaskImagePreviews();
});
taskDialog.addEventListener('close', () => {
  taskForm.reset();
  editingTaskId = null;
  resetTaskImages();
  taskForm.elements.project.required = true;
  taskForm.elements.externalId.disabled = false;
  updateTaskModelHint();
});
taskForm.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const button = event.submitter || taskForm.querySelector('.primary-button');
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const points = taskPoints(values.points);
  const editingTask = editingTaskId ? state.tasks.find(task => task.id === editingTaskId && task.status === 'todo') : null;
  if (editingTaskId && !editingTask) return void ($('#task-error').textContent = 'Yalnızca To Do görevleri düzenlenebilir.');
  const id = editingTask?.id || crypto.randomUUID();
  button.disabled = true;
  button.textContent = selectedTaskImages.length ? 'Görseller kaydediliyor…' : editingTask ? 'Güncelleniyor…' : 'Görev ekleniyor…';
  $('#task-error').textContent = '';
  try {
    const attachments = await persistTaskImages(id, Boolean(editingTask));
    if (editingTask) {
      Object.assign(editingTask, { title: values.title.trim(), externalId: editingTask.azureBoards ? editingTask.externalId || '' : String(values.externalId || '').trim(), description: values.description.trim(), project: values.project.trim(), points, attachments });
      delete editingTask.workflowError;
      addActivity('✎', `${editingTask.title} güncellendi`, `${editingTask.project || 'Repository bekliyor'} · ${points} puan`);
    } else {
      const task = { id, title: values.title.trim(), externalId: String(values.externalId || '').trim(), description: values.description.trim(), project: values.project.trim(), points, attachments, status: 'todo', createdAt: Date.now() };
      state.tasks.unshift(task);
      addActivity('＋', values.title.trim(), `${values.project.trim()} · ${points} puanlık workflow görevi`);
    }
    taskDialog.close();
    persistAndRender();
    showView('workflow');
  } catch (error) {
    $('#task-error').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = editingTask ? 'Değişiklikleri kaydet' : 'Görevi ekle';
  }
});

$('#azure-boards-import').addEventListener('click', () => {
  $('#azure-boards-error').textContent = '';
  azureBoardsDialog.showModal();
});

azureBoardsForm.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const button = event.submitter;
  const errorBox = $('#azure-boards-error');
  const values = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  button.textContent = 'İşler alınıyor…';
  errorBox.textContent = '';
  try {
    const response = await fetch('/api/azure-boards/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization: values.organization, project: values.azureProject, assignee: values.assignee })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Azure Boards işleri okunamadı.');
    const imported = [];
    let skipped = 0;
    for (const item of data.workItems) {
      const alreadyImported = state.tasks.some(task => task.azureBoards?.organization === data.organization
        && task.azureBoards?.project === data.project && task.azureBoards?.id === item.id);
      if (alreadyImported) { skipped += 1; continue; }
      state.tasks.unshift({
        id: crypto.randomUUID(), title: item.title, description: item.description,
        project: '', points: item.workflowPoints, status: 'todo', createdAt: Date.now(),
        azureBoards: { organization: data.organization, project: data.project, id: item.id, state: item.state, assignedTo: item.assignedTo, storyPoints: item.storyPoints, url: item.url }
      });
      imported.push(item);
    }
    addActivity('↓', 'Azure Boards işleri içe aktarıldı', `${imported.length} yeni iş${skipped ? ` · ${skipped} zaten panoda` : ''}`);
    if (imported.length) addJournalEntry('Azure Boards senkronizasyonu', `${data.project} projesinden ${imported.length} iş To Do kolonuna eklendi.`, ['azure-boards', 'workflow']);
    persistAndRender();
    azureBoardsDialog.close();
  } catch (error) { errorBox.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'İşleri al <span>↓</span>'; }
});

$('#add-journal').addEventListener('click', () => {
  const note = window.prompt('Bugünün çalışma notu:');
  if (!note?.trim()) return;
  addJournalEntry('Manuel çalışma notu', note.trim(), ['not']);
  addActivity('□', 'Journal notu eklendi', note.trim().slice(0, 70));
  selectedJournalDate = dateKey(today);
  persistAndRender();
});

const calendarButtons = $$('.calendar-head button');
calendarButtons[0].addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1); renderCalendar(); });
calendarButtons[1].addEventListener('click', () => { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); renderCalendar(); });

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('.sidebar').classList.remove('open');
    agentUsagePanel.hidden = true;
    agentUsage.setAttribute('aria-expanded', 'false');
  }
});

const form = $('#review-form');
const result = $('#result');
const status = $('#status');
const repository = $('#repository');
const agentUsage = $('#agent-usage');
const agentUsageLabel = $('#agent-usage-label');
const agentUsageValue = $('#agent-usage-value');
const agentUsageReset = $('#agent-usage-reset');
const agentUsagePanel = $('#agent-usage-panel');
const agentUsageWindows = $('#agent-usage-windows');
const contextError = $('#context-error');
const commitOverview = $('#commit-overview');
const diffInput = $('#diff-input');
const diffPreview = $('#diff-preview');
const providerInput = $('#provider-select');
const modelInput = form.elements.model;
const effortInput = form.elements.reasoningEffort;
const reviewProjectButton = $('#review-project-switcher');
let reviewContextReady = false;

function setReviewEnabled(enabled) {
  reviewContextReady = enabled;
  form.classList.toggle('is-disabled', !enabled);
  form.setAttribute('aria-disabled', String(!enabled));
  form.querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = !enabled; });
  result.classList.toggle('is-disabled', !enabled);
}

function renderReview(data) {
  const findings = data.findings || [];
  const verdict = data.summary?.verdict || 'approve';
  result.className = `result panel ${verdict}`;
  const cards = findings.length ? findings.map(finding => `<article class="finding ${escape(finding.severity)}"><div class="finding-head"><span class="badge">${escape(finding.severity)}</span><code>${escape(finding.file)}:${escape(finding.line)}</code></div><h3>${escape(finding.title)}</h3><p>${escape(finding.reason)}</p><div class="suggestion"><b>Öneri</b>${escape(finding.suggestion)}</div></article>`).join('') : '<div class="all-clear"><div class="check">✓</div><h3>Sorun bulunmadı</h3><p>İncelenen değişikliklerde kanıtlanabilir bir sorun bulunmadı.</p></div>';
  result.innerHTML = `<header class="review-summary"><div><span><i class="verdict-dot"></i>${verdict === 'approve' ? 'Onaylanabilir' : 'Değişiklik gerekli'}</span><h2>${escape(data.summary?.one_line || '')}</h2></div><span class="count">${findings.length} bulgu</span></header>${cards}`;
}

function renderCommit(commit, reviewType) {
  const isPullRequest = reviewType === 'pull_request';
  $('#change-kind').textContent = isPullRequest ? 'Pull request' : 'Commit';
  $('#change-hash-label').textContent = isPullRequest ? 'Merge commit' : 'Commit';
  form.elements.commit.value = commit.context;
  $('#commit-subject').textContent = commit.subject;
  $('#commit-hash').textContent = commit.hash;
  $('#commit-author').textContent = commit.author;
  $('#commit-date').textContent = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(commit.authoredAt));
  commitOverview.hidden = false;
}

function renderDiff() {
  const diff = diffInput.value;
  diffPreview.classList.toggle('is-empty', !diff);
  if (!diff) { diffPreview.innerHTML = '<code class="diff-empty">Repository bağlamı yüklendiğinde diff burada görünür.</code>'; return; }
  diffPreview.innerHTML = diff.split('\n').map(line => {
    const type = line.startsWith('diff --git') || line.startsWith('index ') ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+++') ? 'file-add' : line.startsWith('---') ? 'file-remove' : line.startsWith('+') ? 'addition' : line.startsWith('-') ? 'deletion' : 'context';
    return `<span class="diff-line ${type}">${escape(line) || ' '}</span>`;
  }).join('');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!reviewContextReady) return;
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  const providerName = providerInput.selectedOptions[0].textContent;
  button.disabled = true;
  status.textContent = `${providerName} ile inceleniyor…`;
  result.className = 'result panel loading';
  result.innerHTML = `<div class="loader"><i></i><i></i><i></i><p>${escape(providerName)} değişiklikleri inceliyor…</p></div>`;
  try {
    const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'İnceleme tamamlanamadı.');
    renderReview(data);
    state.reviews += 1;
    const detail = data.findings.length ? `${data.findings.length} bulgu raporlandı` : 'Değişiklikler onaylanabilir';
    addActivity('↳', 'AI code review tamamlandı', detail);
    addJournalEntry('AI code review tamamlandı', `${data.summary.one_line} ${detail}.`, ['review', data.summary.verdict]);
    persistAndRender();
  } catch (error) {
    result.className = 'result panel error';
    result.innerHTML = `<div class="all-clear"><div class="check">!</div><h3>İnceleme başlatılamadı</h3><p>${escape(error.message)}</p></div>`;
  } finally { button.disabled = !reviewContextReady; status.textContent = ''; }
});

const projectDialog = $('#project-dialog');
const projectForm = $('#project-form');

function updateTargetField() {
  const isPullRequest = projectForm.elements.reviewType.value === 'pr';
  $('#target-label').textContent = isPullRequest ? 'PR URL’si veya numarası' : 'Commit';
  projectForm.elements.target.placeholder = isPullRequest ? 'https://github.com/.../pull/123 veya 123' : 'HEAD';
  projectForm.elements.target.required = isPullRequest;
}

function applyRepositoryContext(data) {
  if (!data.enabled) {
    repository.textContent = 'Proje seçilmedi';
    reviewProjectButton.innerHTML = '<span>＋</span> Proje seç';
    commitOverview.hidden = true;
    diffInput.hidden = true;
    diffInput.value = '';
    form.elements.commit.value = '';
    form.elements.readme.value = '';
    form.elements.agents.value = '';
    renderDiff();
    result.className = 'result panel empty is-disabled';
    result.innerHTML = '<div class="result-empty"><div class="empty-orbit">⌁</div><h3>Önce bir proje seç</h3><p>Review alanı repository bağlamı yüklendiğinde kullanıma açılır.</p></div>';
    setReviewEnabled(false);
    return;
  }
  renderCommit(data.commit, data.reviewType);
  diffInput.hidden = true;
  diffInput.value = data.diff;
  renderDiff();
  form.elements.readme.value = data.readme;
  form.elements.agents.value = data.agents;
  repository.textContent = `${data.repository} · ${data.commit.hash.slice(0, 7)}`;
  reviewProjectButton.textContent = 'Projeyi değiştir';
  if (data.selection) {
    projectForm.elements.repository.value = data.selection.repository;
    projectForm.elements.reviewType.value = data.selection.reviewType;
    projectForm.elements.target.value = data.selection.target;
    updateTargetField();
  }
  contextError.hidden = true;
  result.className = 'result panel empty';
  result.innerHTML = '<div class="result-empty"><div class="empty-orbit">⌁</div><h3>Review için hazır</h3><p>Seçilen değişikliği incelemek için ayarları kontrol edip incelemeyi başlat.</p></div>';
  setReviewEnabled(true);
}

async function loadProjectOptions() {
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    savedProjects = data.projects;
    syncSavedProjectUI();
    if (data.active) {
      projectForm.elements.repository.value = data.active.repository;
      projectForm.elements.reviewType.value = data.active.reviewType;
      projectForm.elements.target.value = data.active.target;
      updateTargetField();
    }
  } catch (error) {
    syncSavedProjectUI();
    $('#project-hint').textContent = `Kayıtlı projeler okunamadı: ${error.message}`;
  }
}

async function loadRepositoryContext() {
  try {
    const response = await fetch('/api/context');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    applyRepositoryContext(data);
  } catch (error) {
    repository.textContent = 'Repository yüklenemedi';
    commitOverview.hidden = true;
    setReviewEnabled(false);
    contextError.hidden = false;
    contextError.innerHTML = `<b>Repository bağlamı yüklenemedi.</b><p>Başka bir repository veya hedef seçebilirsin.</p><code>${escape(error.message)}</code>`;
  }
}

reviewProjectButton.addEventListener('click', () => projectDialog.showModal());
projectForm.elements.reviewType.addEventListener('change', updateTargetField);
diffInput.addEventListener('input', renderDiff);
projectForm.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const button = event.submitter;
  const errorBox = $('#project-error');
  button.disabled = true;
  button.textContent = 'Yükleniyor…';
  errorBox.textContent = '';
  try {
    const input = Object.fromEntries(new FormData(projectForm));
    const response = await fetch('/api/context/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Repository yüklenemedi.');
    applyRepositoryContext(data);
    projectDialog.close();
    addActivity('⌁', `${data.repository} projesi açıldı`, data.reviewType === 'pull_request' ? 'Pull request bağlamı yüklendi' : `${data.commit.hash.slice(0, 7)} commit bağlamı yüklendi`);
    persistAndRender();
    showView('review');
  } catch (error) { errorBox.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Projeyi yükle <span>→</span>'; }
});

async function checkProviders() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (!response.ok) throw new Error();
    const options = '<option value="auto">Otomatik seçim</option>' + data.providers.map(provider => `<option value="${escape(provider.id)}" ${provider.available ? '' : 'disabled'}>${escape(provider.name)} · ${provider.available ? 'hazır' : provider.detail}</option>`).join('');
    providerInput.innerHTML = options;
    providerInput.value = data.providers.some(provider => provider.id === state.reviewProvider && provider.available) ? state.reviewProvider : 'auto';
    automaticWorkflowProvider = data.providers.find(provider => provider.available)?.id || 'auto';
    updateTaskModelHint();
    renderAgentUsage(data);
  } catch { renderAgentUsage({ connected: false, providers: [], usage: null }); }
}

function usageWindowLabel(minutes) {
  if (!Number.isFinite(minutes)) return 'Kullanım limiti';
  if (minutes === 10_080) return 'Haftalık limit';
  if (minutes % 10_080 === 0) return `${minutes / 10_080} haftalık limit`;
  if (minutes === 1_440) return 'Günlük limit';
  if (minutes % 1_440 === 0) return `${minutes / 1_440} günlük limit`;
  if (minutes % 60 === 0) return `${minutes / 60} saatlik limit`;
  return `${minutes} dakikalık limit`;
}

function usageResetLabel(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000));
}

function usageTimeRemaining(timestamp) {
  if (!timestamp) return 'Yenilenme zamanı bilinmiyor';
  const minutes = Math.max(0, Math.ceil((timestamp * 1000 - Date.now()) / 60_000));
  if (minutes === 0) return 'Şimdi yenileniyor';
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days) return `${days} gün${hours ? ` ${hours} sa` : ''} sonra`;
  if (hours) return `${hours} sa${rest ? ` ${rest} dk` : ''} sonra`;
  return `${rest} dk sonra`;
}

function usageWindowMarkup(window) {
  const remaining = Math.max(0, Math.min(100, Math.round(window.remainingPercent)));
  const tone = remaining <= 20 ? 'is-low' : remaining <= 40 ? 'is-medium' : '';
  const exactReset = usageResetLabel(window.resetsAt);
  return `<div class="usage-window ${tone}">
    <div class="usage-window-head"><strong>${usageWindowLabel(window.windowDurationMins)}</strong><span>%${remaining} kaldı</span></div>
    <div class="usage-window-bar" aria-hidden="true"><i style="width:${remaining}%"></i></div>
    <div class="usage-window-meta"><span>${usageTimeRemaining(window.resetsAt)}</span><span>${exactReset ? `${exactReset} yenilenir` : ''}</span></div>
  </div>`;
}

function renderAgentUsage(data) {
  const activeProvider = data.providers?.find(provider => provider.available);
  const usage = data.usage?.available && data.usage.provider === activeProvider?.id ? data.usage : null;
  agentUsage.classList.remove('is-loading', 'is-unavailable', 'is-low', 'is-medium');

  if (!activeProvider) {
    agentUsage.classList.add('is-unavailable');
    agentUsage.style.setProperty('--usage', 0);
    agentUsageLabel.textContent = 'YEREL AGENT';
    agentUsageValue.textContent = 'Oturum gerekli';
    agentUsageReset.textContent = '';
    agentUsageWindows.innerHTML = '<p>Kullanılabilir bir yerel LLM oturumu bulunamadı.</p>';
    agentUsage.title = 'Kullanılabilir bir yerel LLM oturumu bulunamadı.';
    return;
  }

  agentUsageLabel.textContent = `${activeProvider.name.toLocaleUpperCase('tr-TR')} KULLANIMI`;
  if (!usage) {
    agentUsage.classList.add('is-unavailable');
    agentUsage.style.setProperty('--usage', 0);
    agentUsageValue.textContent = 'Kullanım verisi yok';
    agentUsageReset.textContent = '';
    agentUsageWindows.innerHTML = `<p>${escape(activeProvider.name)} hazır; ancak kullanım yüzdesini yerel olarak paylaşmıyor.</p>`;
    agentUsage.title = `${activeProvider.name} hazır; kullanım yüzdesi bu araç tarafından paylaşılmıyor.`;
    return;
  }

  const remaining = Math.max(0, Math.min(100, Math.round(usage.remainingPercent)));
  agentUsage.style.setProperty('--usage', remaining);
  if (remaining <= 20) agentUsage.classList.add('is-low');
  else if (remaining <= 40) agentUsage.classList.add('is-medium');
  agentUsageValue.textContent = `%${remaining} kaldı`;
  const limitingWindow = usage.windows.reduce((lowest, window) => window.remainingPercent < lowest.remainingPercent ? window : lowest);
  agentUsageLabel.textContent = `${activeProvider.name.toLocaleUpperCase('tr-TR')} · ${usageWindowLabel(limitingWindow.windowDurationMins).toLocaleUpperCase('tr-TR')}`;
  agentUsageReset.textContent = usageTimeRemaining(limitingWindow.resetsAt);
  agentUsageWindows.innerHTML = usage.windows.map(usageWindowMarkup).join('');
  agentUsage.title = 'Kullanım detaylarını aç';
}

agentUsage.addEventListener('click', () => {
  const willOpen = agentUsagePanel.hidden;
  agentUsagePanel.hidden = !willOpen;
  agentUsage.setAttribute('aria-expanded', String(willOpen));
});
document.addEventListener('click', event => {
  if (!agentUsagePanel.hidden && !event.target.closest('.top-actions')) {
    agentUsagePanel.hidden = true;
    agentUsage.setAttribute('aria-expanded', 'false');
  }
});

modelInput.addEventListener('change', () => {
  const maxOption = effortInput.querySelector('option[value="max"]');
  maxOption.disabled = Boolean(modelInput.value) && !modelInput.value.startsWith('gpt-5.6');
  if (maxOption.disabled && effortInput.value === 'max') effortInput.value = 'xhigh';
});
providerInput.addEventListener('change', () => { state.reviewProvider = providerInput.value; saveState(); });

setReviewEnabled(false);
updateTaskModelHint();
showView(location.hash.slice(1) || 'dashboard', false);
persistAndRender();
checkProviders();
setInterval(checkProviders, 60_000);
loadProjectOptions().then(loadRepositoryContext);
syncWorkflowRuns();
setInterval(syncWorkflowRuns, 2000);
