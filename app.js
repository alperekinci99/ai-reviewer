const form = document.querySelector('#review-form');
const result = document.querySelector('#result');
const status = document.querySelector('#status');
const repository = document.querySelector('#repository');
const codexStatus = document.querySelector('#codex-status');
const contextError = document.querySelector('#context-error');
const commitOverview = document.querySelector('#commit-overview');
const diffInput = document.querySelector('#diff-input');
const diffPreview = document.querySelector('#diff-preview');
const modelInput = form.elements.model;
const effortInput = form.elements.reasoningEffort;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

function render(data) {
  const findings = data.findings || [];
  const verdict = data.summary?.verdict || 'approve';
  result.className = `result ${verdict}`;
  const cards = findings.length ? findings.map(f => `<article class="finding ${f.severity}"><div class="finding-head"><span class="badge">${escape(f.severity)}</span><code>${escape(f.file)}:${escape(f.line)}</code></div><h3>${escape(f.title)}</h3><p>${escape(f.reason)}</p><div class="suggestion"><b>Öneri</b>${escape(f.suggestion)}</div></article>`).join('') : `<div class="all-clear"><div class="check">✓</div><h3>Sorun bulunmadı</h3><p>İncelenen değişikliklerde kanıtlanabilir bir sorun bulunmadı.</p></div>`;
  result.innerHTML = `<header class="review-summary"><div><span class="verdict-dot"></span><span>${verdict === 'approve' ? 'Onaylanabilir' : 'Değişiklik gerekli'}</span><h2>${escape(data.summary?.one_line || '')}</h2></div><span class="count">${findings.length} bulgu</span></header>${cards}`;
}

function renderCommit(commit, reviewType) {
  const isPullRequest = reviewType === 'pull_request';
  document.querySelector('#review-title').textContent = isPullRequest ? 'Pull request incelemesi' : 'Commit incelemesi';
  document.querySelector('#change-kind').textContent = isPullRequest ? 'Pull request' : 'Commit';
  document.querySelector('#change-hash-label').textContent = isPullRequest ? 'Merge commit' : 'Commit';
  form.elements.commit.value = commit.context;
  document.querySelector('#commit-subject').textContent = commit.subject;
  document.querySelector('#commit-hash').textContent = commit.hash;
  document.querySelector('#commit-author').textContent = commit.author;
  document.querySelector('#commit-date').textContent = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(commit.authoredAt));
  commitOverview.hidden = false;
}

function renderDiff() {
  const diff = diffInput.value;
  if (!diff) {
    diffPreview.innerHTML = '<code>Repository bağlamı yüklendiğinde diff burada görünür.</code>';
    return;
  }
  const lines = diff.split('\n').map(line => {
    const type = line.startsWith('diff --git') || line.startsWith('index ') ? 'meta'
      : line.startsWith('@@') ? 'hunk'
      : line.startsWith('+++') ? 'file-add'
      : line.startsWith('---') ? 'file-remove'
      : line.startsWith('+') ? 'addition'
      : line.startsWith('-') ? 'deletion'
      : 'context';
    return `<span class="diff-line ${type}">${escape(line) || ' '}</span>`;
  });
  diffPreview.innerHTML = lines.join('');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button'); const values = Object.fromEntries(new FormData(form));
  const modelName = form.elements.model.selectedOptions[0].textContent.split(' — ')[0];
  const effortName = form.elements.reasoningEffort.selectedOptions[0].textContent.split(' — ')[0];
  button.disabled = true; status.textContent = `${modelName} · ${effortName} çaba ile review ediliyor…`; result.className = 'result loading'; result.innerHTML = `<div class="loader"><i></i><i></i><i></i><p>${escape(modelName)} · ${escape(effortName)} çaba ile review ediliyor…</p></div>`;
  try {
    const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'İnceleme tamamlanamadı.'); render(data);
  } catch (error) { result.className = 'result error'; result.innerHTML = `<div class="all-clear"><div class="check">!</div><h3>İnceleme başlatılamadı</h3><p>${escape(error.message)}</p></div>`; }
  finally { button.disabled = false; status.textContent = ''; }
});

async function loadRepositoryContext() {
  try {
    const response = await fetch('/api/context');
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error); error.repository = data.repository; throw error; }
    if (!data.enabled) return;
    renderCommit(data.commit, data.reviewType);
    form.elements.diff.value = data.diff;
    renderDiff();
    form.elements.readme.value = data.readme;
    form.elements.agents.value = data.agents;
    repository.textContent = `${data.repository} · ${data.commit.hash.slice(0, 7)}`;
    contextError.hidden = true;
    status.textContent = 'Repository bağlamı yüklendi.';
  } catch (error) {
    repository.textContent = 'Repository yüklenemedi';
    commitOverview.hidden = true;
    const missingCommit = /bad object|unknown revision|not a valid object/i.test(error.message);
    contextError.hidden = false;
    contextError.innerHTML = missingCommit
      ? `<b>Commit yerel klonda bulunamadı.</b><p>Repository yolu doğru, ancak seçilen commit henüz bu bilgisayara indirilmemiş. Terminalde aşağıdaki komutu çalıştırıp uygulamayı yeniden başlatın:</p><code>git -C "${escape(error.repository || 'REPOSITORY_YOLU')}" fetch origin</code><small>Hata: ${escape(error.message)}</small>`
      : `<b>Repository bağlamı yüklenemedi.</b><p>Repo yolu ve commit kimliğini kontrol edip uygulamayı yeniden başlatın.</p><small>Hata: ${escape(error.message)}</small>`;
    status.textContent = '';
  }
}
async function checkCodex() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (!response.ok || !data.connected) throw new Error();
    codexStatus.innerHTML = '<i></i> Codex CLI bağlı';
  } catch { codexStatus.textContent = 'Codex CLI oturumu gerekli'; status.textContent = 'Terminalde codex login komutuyla giriş yapın.'; }
}
checkCodex();
loadRepositoryContext();
diffInput.addEventListener('input', renderDiff);
modelInput.addEventListener('change', () => {
  const maxOption = effortInput.querySelector('option[value="max"]');
  maxOption.disabled = Boolean(modelInput.value) && !modelInput.value.startsWith('gpt-5.6');
  if (maxOption.disabled && effortInput.value === 'max') effortInput.value = 'xhigh';
});
