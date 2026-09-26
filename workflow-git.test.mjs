import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedCommitMessage, taskReference, validateCommitMessage, workflowBranchName } from './workflow-git.mjs';

test('Azure Boards kimliği commit kapsamına ve branch adına eklenir', () => {
  const task = { title: 'Ödeme ekranındaki hatayı düzelt', azureBoards: { id: 4821 } };
  assert.equal(taskReference(task), 'AB#4821');
  assert.equal(suggestedCommitMessage(task), 'fix(AB#4821): Ödeme ekranındaki hatayı düzelt');
  assert.match(workflowBranchName('ignored', task), /^workflow\/ab-4821-/);
});

test('yerel görev anlamlı conventional commit özeti üretir', () => {
  const task = { title: 'Journal takvim seçimini iyileştir' };
  assert.equal(suggestedCommitMessage(task), 'feat: Journal takvim seçimini iyileştir');
  assert.match(workflowBranchName('A1B2C3D4-1234', task), /^workflow\/a1b2c3d4-/);
});

test('harici görev kimliği commit mesajından çıkarılamaz', () => {
  const task = { title: 'API doğrulamasını ekle', externalId: 'DEV-42' };
  assert.throws(() => validateCommitMessage('feat: API doğrulamasını ekle', task), /DEV-42/);
  assert.equal(validateCommitMessage('feat(DEV-42): API doğrulamasını ekle', task), 'feat(DEV-42): API doğrulamasını ekle');
});
