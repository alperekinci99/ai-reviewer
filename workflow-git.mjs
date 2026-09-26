const commitTypes = [
  { type: 'fix', pattern: /\b(fix|bug|hata|sorun|düzelt)/i },
  { type: 'refactor', pattern: /\b(refactor|yeniden düzenle|sadeleştir)/i },
  { type: 'test', pattern: /\b(test|spec|coverage|kapsama)/i },
  { type: 'docs', pattern: /\b(doc|docs|readme|doküman|belgele)/i },
  { type: 'chore', pattern: /\b(chore|config|dependency|bağımlılık|konfigürasyon)/i }
];

function singleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slug(value) {
  const turkish = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return singleLine(value).toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, character => turkish[character])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function taskReference(task) {
  const azureId = Number(task?.azureBoards?.id);
  if (Number.isInteger(azureId) && azureId > 0) return `AB#${azureId}`;
  const externalId = singleLine(task?.externalId);
  return externalId && /^[A-Z][A-Z0-9_-]*-\d+$/i.test(externalId) ? externalId.toUpperCase() : '';
}

export function workflowBranchName(taskId, task) {
  const reference = taskReference(task);
  const identifier = reference ? reference.replace('#', '-').toLowerCase() : singleLine(taskId).slice(0, 8).toLowerCase();
  const title = slug(task?.title).slice(0, 42) || 'task';
  return `workflow/${identifier}-${title}`;
}

export function suggestedCommitMessage(task) {
  const title = singleLine(task?.title).replace(/[.!?]+$/, '');
  if (!title) throw new Error('Commit mesajı için görev başlığı gerekli.');
  const type = commitTypes.find(candidate => candidate.pattern.test(title))?.type || 'feat';
  const reference = taskReference(task);
  const prefix = reference ? `${type}(${reference}): ` : `${type}: `;
  const available = Math.max(12, 100 - prefix.length);
  const summary = title.length > available ? `${title.slice(0, available - 1).trimEnd()}…` : title;
  return `${prefix}${summary}`;
}

export function validateCommitMessage(value, task) {
  const message = singleLine(value);
  if (message.length < 10 || message.length > 120) throw new Error('Commit mesajı 10–120 karakter arasında, tek satırlık bir iş özeti olmalı.');
  if (!/^(feat|fix|refactor|test|docs|chore|perf|style|build|ci)(\([^)]+\))?:\s\S/i.test(message)) {
    throw new Error('Commit mesajı conventional commit biçiminde olmalı (örn. feat: görev özeti).');
  }
  const reference = taskReference(task);
  if (reference && !message.toLocaleUpperCase('tr-TR').includes(reference.toLocaleUpperCase('tr-TR'))) {
    throw new Error(`Commit mesajı görev kimliğini içermeli: ${reference}`);
  }
  return message;
}
