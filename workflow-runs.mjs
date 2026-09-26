import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const configDirectory = process.env.AI_REVIEWER_CONFIG_DIR || join(homedir(), '.config', 'ai-reviewer');
export const workflowRunsFile = process.env.AI_REVIEWER_WORKFLOW_RUNS_FILE || join(configDirectory, 'workflow-runs.json');

export async function loadWorkflowRuns() {
  try {
    const parsed = JSON.parse(await readFile(workflowRunsFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.runs)) throw new Error('"runs" listesi eksik.');
    return parsed.runs.filter(run => run && typeof run.id === 'string');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Workflow çalışma kaydı okunamadı (${workflowRunsFile}): ${error.message}`);
  }
}

export async function saveWorkflowRuns(runs) {
  await mkdir(dirname(workflowRunsFile), { recursive: true });
  const temporaryFile = `${workflowRunsFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify({ runs }, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, workflowRunsFile);
}

export function recoverInterruptedRuns(runs, now = new Date().toISOString()) {
  return runs.map(run => run.status === 'running'
    ? { ...run, status: 'failed', error: 'Portal yeniden başlatıldığı için çalışma kesildi. Görevi başka bir kolona, ardından tekrar In Progress kolonuna taşıyarak devam ettirebilirsin.', updatedAt: now }
    : run);
}
