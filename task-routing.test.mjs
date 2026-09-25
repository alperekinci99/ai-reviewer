import test from 'node:test';
import assert from 'node:assert/strict';
import { taskProfile } from './task-routing.mjs';

test('2 puan verimli model profiline yönlenir', () => {
  assert.deepEqual(taskProfile(2), {
    points: 2,
    label: 'Küçük',
    codex: { model: 'gpt-5.6-luna', effort: 'low' },
    claude: { model: 'haiku' }
  });
});

test('3 puan dengeli model profiline yönlenir', () => {
  assert.equal(taskProfile('3').codex.model, 'gpt-5.6-terra');
  assert.equal(taskProfile('3').codex.effort, 'medium');
  assert.equal(taskProfile('3').claude.model, 'sonnet');
});

test('5 puan kapsamlı model profiline yönlenir', () => {
  assert.equal(taskProfile(5).codex.model, 'gpt-5.6-sol');
  assert.equal(taskProfile(5).codex.effort, 'high');
  assert.equal(taskProfile(5).claude.model, 'opus');
});

test('puan verilmezse dengeli profil kullanılır, geçersiz puan reddedilir', () => {
  assert.equal(taskProfile().points, 3);
  assert.throws(() => taskProfile(4), /yalnızca 2, 3 veya 5/);
});
