import { createInterface } from 'node:readline/promises';
import { isDirectory, loadProjects, projectsFile, saveProjects } from './project-config.mjs';

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const clean = value => value.trim().replace(/^['"]|['"]$/g, '');
const namePattern = /^[a-z0-9][a-z0-9_-]*$/;
const [command, suppliedName, suppliedPath] = process.argv.slice(2);

try {
  const projects = await loadProjects();
  if (command === '--set') {
    const name = clean(suppliedName || '').toLowerCase();
    const path = clean(suppliedPath || '');
    if (!namePattern.test(name)) throw new Error('Kısayol yalnızca küçük harf, rakam, tire ve alt çizgi içerebilir.');
    if (!path || !(await isDirectory(path))) throw new Error('Okunabilir bir repository klasörü girin.');
    projects[name] = path;
    await saveProjects(projects);
    console.log(`"${name}" kaydedildi.`);
    process.exitCode = 0;
  } else {
  console.log(`Proje ayar dosyası: ${projectsFile}`);
  if (Object.keys(projects).length) console.table(Object.entries(projects).map(([name, path]) => ({ Kısayol: name, Yol: path })));
  else console.log('Henüz kayıtlı proje yok.');

  const action = (await terminal.question('İşlem (ekle/sil/çık) [çık]: ')).trim().toLowerCase() || 'çık';
  if (['çık', 'cik', 'exit'].includes(action)) process.exitCode = 0;
  else if (['ekle', 'add'].includes(action)) {
    const name = clean(await terminal.question('Kısayol adı: ')).toLowerCase();
    if (!namePattern.test(name)) throw new Error('Kısayol yalnızca küçük harf, rakam, tire ve alt çizgi içerebilir.');
    const path = clean(await terminal.question('Repository yolu: '));
    if (!path || !(await isDirectory(path))) throw new Error('Okunabilir bir repository klasörü girin.');
    projects[name] = path;
    await saveProjects(projects);
    console.log(`"${name}" kaydedildi.`);
  } else if (['sil', 'delete', 'remove'].includes(action)) {
    const name = clean(await terminal.question('Silinecek kısayol: ')).toLowerCase();
    if (!projects[name]) throw new Error(`"${name}" adlı kayıt yok.`);
    delete projects[name];
    await saveProjects(projects);
    console.log(`"${name}" silindi.`);
  } else throw new Error('İşlem ekle, sil veya çık olmalıdır.');
  }
} catch (error) {
  console.error(`Proje ayarı güncellenemedi: ${error.message}`);
  process.exitCode = 1;
} finally { terminal.close(); }
