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

const defaults = {
  reviews: 0,
  reviewProvider: 'auto',
  workflowProvider: 'auto',
  tasks: [
    { id: crypto.randomUUID(), title: 'Developer portal iskeletini tamamla', description: 'Ana modüller ve proje odaklı navigasyon.', project: 'Developer Portal', provider: 'auto', points: 5, status: 'doing', priority: 'high', createdAt: Date.now() },
    { id: crypto.randomUUID(), title: 'Workflow görevlerine proje bağlamı ekle', description: 'Her görev kendi projesini bağımsız olarak taşısın.', project: 'Developer Portal', provider: 'auto', points: 3, status: 'todo', priority: 'medium', createdAt: Date.now() - 1000 },
    { id: crypto.randomUUID(), title: 'Proje seçim deneyimini tasarla', description: 'Kayıtlı repository’ler arasında hızlı geçiş.', project: 'Developer Portal', provider: 'auto', points: 3, status: 'todo', priority: 'low', createdAt: Date.now() - 2000 },
    { id: crypto.randomUUID(), title: 'Local state kalıcılığını doğrula', description: 'Workflow durumunun tarayıcıda korunduğunu doğrula.', project: 'Developer Portal', provider: 'auto', points: 2, status: 'done', priority: 'high', createdAt: Date.now() - 3000 }
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
      workflowProvider: typeof saved.workflowProvider === 'string' ? saved.workflowProvider : typeof saved.coderProvider === 'string' ? saved.coderProvider : defaults.workflowProvider,
      tasks: saved.tasks.map(task => {
        const legacyUpdate = legacyTaskUpdates[task.title];
        const legacyProject = task.project === 'AI Reviewer';
        return {
          ...task,
          ...(legacyUpdate || {}),
          project: legacyProject ? (seedTitles.has(task.title) ? 'Developer Portal' : 'Genel') : typeof task.project === 'string' && task.project.trim() ? task.project : 'Genel',
          points: seedPoints[task.title] || ([2, 3, 5].includes(Number(task.points)) ? Number(task.points) : task.priority === 'high' ? 5 : task.priority === 'low' ? 2 : 3),
          provider: typeof task.provider === 'string' ? task.provider : 'auto',
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
  { id: 'todo', label: 'YAPILACAK' },
  { id: 'doing', label: 'YAPILIYOR' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'TAMAMLANDI' }
];

function workflowRunCard(task, run) {
  if (task.workflowStarting) return '<div class="run-state running"><i></i><span><b>Agent başlatılıyor</b><small>Provider ve model hazırlandıktan sonra çalışma başlayacak.</small></span></div>';
  if (!run && task.status === 'doing') return '<div class="run-state idle">Hazır · yeniden tetiklemek için başka bir kolona, ardından Yapılıyor’a taşı.</div>';
  if (!run) return '';
  const provider = run.provider === 'claude' ? 'Claude Code' : run.provider === 'codex' ? 'Codex' : 'Yerel agent';
  if (run.status === 'running') return `<div class="run-state running"><i></i><span><b>${escape(provider)} çalışıyor</b><small>${escape(run.model || 'varsayılan model')} · ${run.attempt || 1}. tur</small></span></div>`;
  if (run.status === 'failed') return `<div class="run-state failed"><b>Çalışma tamamlanamadı</b><span>${escape(run.error || 'Bilinmeyen agent hatası')}</span></div>`;
  if (task.status !== 'review') return '';
  const messages = (run.messages || []).map(message => `<article class="chat-message ${message.role}"><span>${message.role === 'user' ? 'Sen' : provider}</span><p>${escape(message.content)}</p></article>`).join('');
  return `<section class="run-review"><header><span>AGENT REVIEW</span><b>${escape(provider)} · ${escape(run.model || '')} · ${run.attempt || 1}. tur</b></header><div class="run-summary">${escape(run.summary || '')}</div><button class="review-diff-button" type="button" draggable="false" data-open-workflow-diff="${escape(task.id)}"><span>Değişiklikleri gör</span><small>${run.changedFiles?.length || 0} dosya${run.diffTruncated ? ' · önizleme sınırlandı' : ''} →</small></button><div class="agent-chat"><div class="agent-chat-head"><b>Agent sohbeti</b><span>Feedback gönderildiğinde aynı oturum otomatik olarak yeniden çalışır.</span></div>${messages}<form data-feedback-form="${escape(task.id)}"><textarea name="feedback" rows="3" maxlength="4000" required placeholder="Değişikliklerle ilgili feedback’ini yaz…"></textarea><button type="submit">Feedback’i gönder</button><small aria-live="polite"></small></form></div></section>`;
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
      body: JSON.stringify({ ...task, provider: task.provider || state.workflowProvider || 'auto' })
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
  if (workflowRuns.get(task.id)?.status === 'running') return;
  task.status = status;
  addActivity('◇', `${task.title} taşındı`, columns.find(item => item.id === status).label.toLocaleLowerCase('tr-TR'));
  if (status === 'done') addJournalEntry(`Görev tamamlandı: ${task.title}`, task.description || 'Workflow görevi tamamlandı.', ['workflow', 'tamamlandı']);
  persistAndRender();
  if (status === 'doing') await startWorkflowTask(task);
}

function renderTasks() {
  $('#kanban').innerHTML = columns.map(column => {
    const tasks = state.tasks.filter(task => task.status === column.id);
    const cards = tasks.map(task => {
      const points = taskPoints(task.points);
      const profile = taskProfiles[points];
      const run = workflowRuns.get(task.id);
      const running = run?.status === 'running';
      const localError = task.workflowError && !['running', 'review'].includes(run?.status) ? `<div class="run-state failed"><b>Başlatılamadı</b><span>${escape(task.workflowError)}</span></div>` : '';
      return `<article class="task-card${running ? ' is-running' : ''}${task.status === 'review' ? ' is-review' : ''}" draggable="${running ? 'false' : 'true'}" data-task-id="${escape(task.id)}"><div class="task-priority"><i class="priority-dot ${task.priority}"></i><button class="task-menu" type="button" data-delete-task="${escape(task.id)}" aria-label="Görevi sil" ${running ? 'disabled' : ''}>×</button></div><h3>${escape(task.title)}</h3>${task.description ? `<p>${escape(task.description)}</p>` : ''}<div class="task-footer"><span class="task-tag">${escape(task.project || 'Projesiz')}</span><span class="task-points points-${points}" title="${escape(profile.codex)} · ${escape(profile.claude)}">${points} puan · ${escape(profile.label)}</span></div>${localError || workflowRunCard(task, run)}</article>`;
    }).join('');
    return `<section class="kanban-column" data-status="${column.id}"><header class="column-head"><span>${column.label}</span><span class="column-count">${tasks.length}</span></header><div class="task-list">${cards}</div></section>`;
  }).join('');

  $$('.task-card').forEach(card => {
    card.addEventListener('dragstart', event => {
      if (card.draggable === false || event.target.closest('button, textarea, input, form')) return event.preventDefault();
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
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
  $$('[data-open-workflow-diff]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const task = state.tasks.find(item => item.id === button.dataset.openWorkflowDiff);
    const run = workflowRuns.get(button.dataset.openWorkflowDiff);
    if (!task || !run) return;
    $('#workflow-diff-title').textContent = task.title;
    $('#workflow-diff-files').innerHTML = (run.changedFiles || []).map(file => `<span>${escape(file)}</span>`).join('');
    const preview = $('#workflow-diff-preview');
    const empty = $('#workflow-diff-empty');
    preview.hidden = !run.diff;
    empty.hidden = Boolean(run.diff);
    preview.querySelector('code').textContent = run.diff || '';
    $('#workflow-diff-dialog').showModal();
  }));
  $$('[data-feedback-form]').forEach(feedbackForm => feedbackForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = feedbackForm.querySelector('button');
    const status = feedbackForm.querySelector('small');
    const feedback = feedbackForm.elements.feedback.value.trim();
    button.disabled = true;
    status.textContent = 'Gönderiliyor…';
    try {
      const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(feedbackForm.dataset.feedbackForm)}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Feedback gönderilemedi.');
      const task = state.tasks.find(item => item.id === feedbackForm.dataset.feedbackForm);
      if (!task) throw new Error('Workflow görevi bulunamadı.');
      task.status = 'doing';
      addActivity('↻', `${task.title} feedback ile yeniden başlatıldı`, 'Agent aynı çalışma oturumunda devam ediyor');
      persistAndRender();
      await startWorkflowTask(task, { failureStatus: 'review' });
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }));
}

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
  $('#focus-priority').textContent = focus ? `${({ high: 'Yüksek', medium: 'Orta', low: 'Düşük' })[focus.priority] || 'Orta'} öncelik` : 'Görev yok';
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
    const day = new Date(year, month, start.getDate() + index);
    const key = dateKey(day);
    const classes = ['calendar-day'];
    if (day.getMonth() !== month) classes.push('muted');
    if (key === dateKey(today)) classes.push('today');
    if (state.journal[key]?.length) classes.push('has-entry');
    return `<button class="${classes.join(' ')}" data-journal-date="${key}" type="button">${day.getDate()}</button>`;
  }).join('');
  $$('[data-journal-date]').forEach(button => button.addEventListener('click', () => { selectedJournalDate = button.dataset.journalDate; renderJournal(); }));
}

function renderJournal() {
  const selected = new Date(`${selectedJournalDate}T12:00:00`);
  const isToday = selectedJournalDate === dateKey(today);
  $('#journal-date-title').textContent = isToday ? 'Bugün' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(selected);
  const entries = state.journal[selectedJournalDate] || [];
  $('#journal-entries').innerHTML = entries.length ? entries.map(entry => `<article class="journal-entry"><time>${escape(entry.time)}</time><h3>${escape(entry.title)}</h3><p>${escape(entry.text)}</p><div class="journal-tags">${entry.tags.map(tag => `<span>${escape(tag)}</span>`).join('')}</div></article>`).join('') : '<div class="journal-empty">Bu gün için henüz bir çalışma notu yok.</div>';
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

$('#complete-focus').addEventListener('click', event => {
  const task = state.tasks.find(item => item.id === event.currentTarget.dataset.taskId);
  if (!task || workflowRuns.get(task.id)?.status === 'running') return;
  task.status = 'done';
  addActivity('✓', `${task.title} tamamlandı`, 'Workflow güncellendi');
  addJournalEntry(`Görev tamamlandı: ${task.title}`, task.description || 'Odaktaki görev tamamlandı.', ['workflow', 'tamamlandı']);
  persistAndRender();
});

const taskDialog = $('#task-dialog');
const taskForm = $('#task-form');
function updateTaskModelHint() {
  const points = taskPoints(taskForm.elements.points.value);
  const profile = taskProfiles[points];
  const provider = taskForm.elements.provider.value;
  const route = provider === 'codex' ? profile.codex : provider === 'claude' ? profile.claude : `${profile.codex} / ${profile.claude}`;
  $('#task-model-hint').textContent = `Model profili: ${route}`;
}
$$('[data-open-task]').forEach(button => button.addEventListener('click', () => {
  $('#task-error').textContent = '';
  const preferredProvider = state.workflowProvider || 'auto';
  taskForm.elements.provider.value = [...taskForm.elements.provider.options].some(option => option.value === preferredProvider && !option.disabled) ? preferredProvider : 'auto';
  updateTaskModelHint();
  taskDialog.showModal();
}));
taskForm.elements.points.addEventListener('change', updateTaskModelHint);
taskForm.addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const points = taskPoints(values.points);
  const task = { id: crypto.randomUUID(), title: values.title.trim(), description: values.description.trim(), project: values.project.trim(), provider: values.provider || 'auto', points, status: values.status, priority: values.priority, createdAt: Date.now() };
  state.workflowProvider = task.provider;
  state.tasks.unshift(task);
  addActivity('＋', values.title.trim(), `${values.project.trim()} · ${points} puanlık workflow görevi`);
  event.currentTarget.reset();
  event.currentTarget.elements.provider.value = state.workflowProvider;
  updateTaskModelHint();
  taskDialog.close();
  persistAndRender();
  showView('workflow');
  if (task.status === 'doing') await startWorkflowTask(task);
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

$('.command-trigger').addEventListener('click', () => showView('workflow'));
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showView('workflow'); }
  if (event.key === 'Escape') $('.sidebar').classList.remove('open');
});

const form = $('#review-form');
const result = $('#result');
const status = $('#status');
const repository = $('#repository');
const codexStatus = $('#codex-status');
const contextError = $('#context-error');
const commitOverview = $('#commit-overview');
const diffInput = $('#diff-input');
const diffPreview = $('#diff-preview');
const providerInput = $('#provider-select');
const taskProviderInput = $('#task-provider-select');
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
  if (!diff) { diffPreview.innerHTML = '<code>Repository bağlamı yüklendiğinde diff burada görünür.</code>'; return; }
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
    if (!response.ok || !data.connected) throw new Error();
    const options = '<option value="auto">Otomatik seçim</option>' + data.providers.map(provider => `<option value="${escape(provider.id)}" ${provider.available ? '' : 'disabled'}>${escape(provider.name)} · ${provider.available ? 'hazır' : provider.detail}</option>`).join('');
    providerInput.innerHTML = options;
    taskProviderInput.innerHTML = options;
    providerInput.value = data.providers.some(provider => provider.id === state.reviewProvider && provider.available) ? state.reviewProvider : 'auto';
    taskProviderInput.value = data.providers.some(provider => provider.id === state.workflowProvider && provider.available) ? state.workflowProvider : 'auto';
    state.workflowProvider = taskProviderInput.value;
    updateTaskModelHint();
    const available = data.providers.filter(provider => provider.available).map(provider => provider.name);
    codexStatus.innerHTML = `<i></i>${escape(available.join(' · '))} hazır`;
  } catch { codexStatus.textContent = 'Yerel LLM oturumu gerekli'; }
}

modelInput.addEventListener('change', () => {
  const maxOption = effortInput.querySelector('option[value="max"]');
  maxOption.disabled = Boolean(modelInput.value) && !modelInput.value.startsWith('gpt-5.6');
  if (maxOption.disabled && effortInput.value === 'max') effortInput.value = 'xhigh';
});
providerInput.addEventListener('change', () => { state.reviewProvider = providerInput.value; saveState(); });
taskProviderInput.addEventListener('change', () => { state.workflowProvider = taskProviderInput.value; saveState(); updateTaskModelHint(); });

setReviewEnabled(false);
updateTaskModelHint();
showView(location.hash.slice(1) || 'dashboard', false);
persistAndRender();
checkProviders();
loadProjectOptions().then(loadRepositoryContext);
syncWorkflowRuns();
setInterval(syncWorkflowRuns, 2000);
