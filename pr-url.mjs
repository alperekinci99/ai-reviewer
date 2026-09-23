export function azurePullRequestUrl(value) {
  const match = String(value).trim().match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)(?:[/?#]|$)/i);
  if (!match) return null;
  const [, organization, project, repository, id] = match;
  return {
    id,
    organization: decodeURIComponent(organization),
    project: decodeURIComponent(project),
    repository: decodeURIComponent(repository)
  };
}
