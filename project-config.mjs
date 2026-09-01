import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const configDirectory = process.env.AI_REVIEWER_CONFIG_DIR || join(homedir(), '.config', 'ai-reviewer');
export const projectsFile = process.env.AI_REVIEWER_PROJECTS_FILE || join(configDirectory, 'projects.json');

export async function loadProjects() {
  try {
    const parsed = JSON.parse(await readFile(projectsFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.projects !== 'object' || !parsed.projects || Array.isArray(parsed.projects)) {
      throw new Error('"projects" nesnesi eksik.');
    }
    return Object.fromEntries(Object.entries(parsed.projects)
      .filter(([name, path]) => typeof name === 'string' && typeof path === 'string' && name.trim() && path.trim())
      .map(([name, path]) => [name.trim().toLowerCase(), path.trim()]));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Proje ayarı okunamadı (${projectsFile}): ${error.message}`);
  }
}

export async function saveProjects(projects) {
  await mkdir(dirname(projectsFile), { recursive: true });
  await writeFile(projectsFile, `${JSON.stringify({ projects }, null, 2)}\n`, 'utf8');
}

export async function isDirectory(path) {
  try { return (await stat(path)).isDirectory(); }
  catch { return false; }
}
