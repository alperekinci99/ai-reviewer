const azureFields = {
  id: ['System.Id', 'id', 'ID'],
  title: ['System.Title', 'title', 'Title'],
  state: ['System.State', 'state', 'State'],
  description: ['System.Description', 'description', 'Description'],
  assignedTo: ['System.AssignedTo', 'assignedTo', 'Assigned To'],
  storyPoints: ['Microsoft.VSTS.Scheduling.StoryPoints', 'storyPoints', 'Story Points']
};

function fieldValue(item, field) {
  const sources = [item?.fields, item];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of azureFields[field]) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return '';
}

function textValue(value) {
  if (value && typeof value === 'object') return value.displayName || value.uniqueName || value.name || '';
  return String(value ?? '');
}

function plainText(value) {
  return textValue(value)
    .replace(/<br\s*\/?>(?:\r?\n)?/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function azureOrganizationUrl(value) {
  const input = String(value ?? '').trim().replace(/\/$/, '');
  if (!input) throw new Error('Azure DevOps organizasyonu gerekli.');
  if (/^[a-z0-9-]+$/i.test(input)) return `https://dev.azure.com/${input}`;
  let url;
  try { url = new URL(input); }
  catch { throw new Error('Organizasyon adı veya https://dev.azure.com/... URL’si girin.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'dev.azure.com' || !url.pathname.split('/').filter(Boolean).length) {
    throw new Error('https://dev.azure.com/<organizasyon> biçiminde bir URL girin.');
  }
  return `${url.origin}/${url.pathname.split('/').filter(Boolean)[0]}`;
}

export function azureBoardsWiql(assignee = '@Me') {
  const identity = String(assignee).trim() || '@Me';
  const assignedTo = /^@me$/i.test(identity) ? '@Me' : `'${identity.replace(/'/g, "''")}'`;
  return `SELECT [System.Id], [System.Title], [System.State], [System.Description], [System.AssignedTo], [Microsoft.VSTS.Scheduling.StoryPoints]\nFROM WorkItems\nWHERE [System.AssignedTo] = ${assignedTo}\n  AND [System.State] IN ('Backlog', 'Todo', 'To Do')\nORDER BY [System.ChangedDate] DESC`;
}

export function workflowPointsForStoryPoints(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 3;
  const storyPoints = Number(value);
  if (!Number.isFinite(storyPoints) || storyPoints < 0) return 3;
  if (storyPoints <= 2) return 2;
  if (storyPoints < 5) return 3;
  return 5;
}

export function normalizeAzureBoardItems(output, organization, project) {
  const records = Array.isArray(output) ? output : Array.isArray(output?.value) ? output.value : [];
  return records.map(item => {
    const id = Number(fieldValue(item, 'id'));
    const title = plainText(fieldValue(item, 'title'));
    if (!Number.isInteger(id) || id <= 0 || !title) return null;
    const storyPointValue = fieldValue(item, 'storyPoints');
    const rawStoryPoints = storyPointValue === '' ? Number.NaN : Number(storyPointValue);
    const storyPoints = Number.isFinite(rawStoryPoints) && rawStoryPoints >= 0 ? rawStoryPoints : null;
    return {
      id,
      title,
      state: plainText(fieldValue(item, 'state')),
      description: plainText(fieldValue(item, 'description')),
      assignedTo: plainText(fieldValue(item, 'assignedTo')),
      storyPoints,
      workflowPoints: workflowPointsForStoryPoints(storyPoints),
      url: `${organization}/${encodeURIComponent(project)}/_workitems/edit/${id}`
    };
  }).filter(Boolean);
}
