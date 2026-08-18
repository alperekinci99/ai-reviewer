import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const clean = value => value.trim().replace(/^['"]|['"]$/g, '');

try {
  const repo = clean(await terminal.question('Repository yolu: '));
  if (!repo) throw new Error('Repository yolu boş bırakılamaz.');
  const commit = clean(await terminal.question('Commit kimliği (boş bırakılırsa HEAD): ')) || 'HEAD';
  terminal.close();
  console.log(`\nİncelenecek repository: ${repo}\nCommit: ${commit}\n`);
  const server = spawn(process.execPath, ['server.mjs', '--repo', repo, '--commit', commit], { stdio: 'inherit' });
  server.on('error', error => { console.error(`Sunucu başlatılamadı: ${error.message}`); process.exitCode = 1; });
  server.on('exit', code => { process.exitCode = code || 0; });
} catch (error) {
  terminal.close();
  console.error(`Başlatma iptal edildi: ${error.message}`);
  process.exitCode = 1;
}
