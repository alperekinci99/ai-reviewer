import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('görev görsellerini yerel alana güvenli biçimde kaydeder ve çözümler', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-task-assets-test-'));
  const previousDirectory = process.env.AI_REVIEWER_TASK_ASSETS_DIR;
  process.env.AI_REVIEWER_TASK_ASSETS_DIR = directory;
  const assets = await import(`./task-assets.mjs?test=${randomUUID()}`);
  try {
    const [attachment] = await assets.saveTaskImages('task-123', [{ name: '../mockup.png', type: 'image/png', data: onePixelPng }]);
    assert.equal(attachment.name, 'mockup.png');
    assert.equal(attachment.type, 'image/png');
    assert.match(attachment.url, /^\/api\/workflow\/tasks\/task-123\/assets\//);

    const [resolved] = await assets.resolveTaskImages('task-123', [attachment]);
    await access(resolved.path);
    assert.equal(resolved.id, attachment.id);
    assert.equal((await stat(resolved.path)).mode & 0o222, 0);

    const image = await assets.readTaskImage('task-123', attachment.id);
    assert.equal(image.data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    await assets.deleteTaskImages('task-123');
    await assert.rejects(access(resolved.path));
  } finally {
    if (previousDirectory === undefined) delete process.env.AI_REVIEWER_TASK_ASSETS_DIR;
    else process.env.AI_REVIEWER_TASK_ASSETS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test('görsel gibi gösterilen geçersiz dosyayı reddeder', async () => {
  const assets = await import('./task-assets.mjs');
  assert.throws(
    () => assets.decodeTaskImage({ name: 'fake.png', type: 'image/png', data: 'data:image/png;base64,ZmFrZQ==' }),
    /geçerli değil/
  );
});
