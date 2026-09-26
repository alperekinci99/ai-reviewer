import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverInterruptedRuns } from './workflow-runs.mjs';

test('sunucu yeniden başladığında yarım kalan workflow çalışması güvenli biçimde hata durumuna alınır', () => {
  const updated = recoverInterruptedRuns([
    { id: 'running', status: 'running' },
    { id: 'finalizing', status: 'finalizing' },
    { id: 'review', status: 'review' }
  ], '2026-09-25T10:00:00.000Z');

  assert.equal(updated[0].status, 'failed');
  assert.match(updated[0].error, /Portal yeniden başlatıldığı/);
  assert.equal(updated[0].updatedAt, '2026-09-25T10:00:00.000Z');
  assert.equal(updated[1].status, 'review');
  assert.match(updated[1].completionError, /Tamamlama işlemi/);
  assert.equal(updated[2].status, 'review');
});
