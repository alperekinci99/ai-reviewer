import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { loadProjects } from './project-config.mjs';

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const clean = value => value.trim().replace(/^['"]|['"]$/g, '');

try {
  const projects = await loadProjects();
  const aliases = Object.keys(projects);
  if (aliases.length) console.log(`Kayıtlı projeler: ${aliases.join(', ')}`);
  const selection = clean(await terminal.question('Repository yolu veya proje kısayolu: '));
  const repo = projects[selection.toLowerCase()] || selection;
  if (!repo) throw new Error('Repository yolu boş bırakılamaz.');
  const type = clean(await terminal.question('İnceleme türü (commit/pr) [commit]: ')).toLowerCase() || 'commit';
  if (!['commit', 'pr'].includes(type)) throw new Error('İnceleme türü commit veya pr olmalıdır.');
  const target = clean(await terminal.question(type === 'pr' ? 'Pull request URL’si veya numarası: ' : 'Commit kimliği (boş bırakılırsa HEAD): ')) || (type === 'commit' ? 'HEAD' : '');
  if (!target) throw new Error('Pull request URL’si veya numarası boş bırakılamaz.');
  terminal.close();
  console.log(`\nİncelenecek repository: ${repo}\n${type === 'pr' ? 'Pull request' : 'Commit'}: ${target}\n`);
  const serverArgs = ['server.mjs', '--repo', repo, type === 'pr' ? '--pull-request' : '--commit', target];
  const server = spawn(process.execPath, serverArgs, { stdio: 'inherit' });
  server.on('error', error => { console.error(`Sunucu başlatılamadı: ${error.message}`); process.exitCode = 1; });
  server.on('exit', code => { process.exitCode = code || 0; });
} catch (error) {
  terminal.close();
  console.error(`Başlatma iptal edildi: ${error.message}`);
  process.exitCode = 1;
}
