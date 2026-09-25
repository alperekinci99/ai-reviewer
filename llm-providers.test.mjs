import test from 'node:test';
import assert from 'node:assert/strict';
import { codexExecArgs, resolveLocalAgent } from './llm-providers.mjs';

test('workflow executor çakışan approve-for-me bayrağı olmadan workspace-write kullanır', () => {
  const args = codexExecArgs({ mode: 'execute', model: 'gpt-5.6-terra', effort: 'medium', outputPath: '/tmp/result.md' });

  assert.deepEqual(args.slice(0, 4), ['exec', '--sandbox', 'workspace-write', '--json']);
  assert.equal(args.includes('--approve-for-me'), false);
  assert.ok(args.includes('approval_policy="never"'));
});

test('devam turu aynı güvenlik sınırlarını config üzerinden korur', () => {
  const args = codexExecArgs({ mode: 'execute', sessionId: 'session-123', outputPath: '/tmp/result.md' });

  assert.deepEqual(args.slice(0, 3), ['exec', 'resume', '--json']);
  assert.ok(args.includes('sandbox_mode="workspace-write"'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('session-123'));
});

test('seçili provider için model çalışma başlamadan belirlenir', async () => {
  const selection = await resolveLocalAgent({
    provider: 'codex',
    models: { codex: 'gpt-5.6-terra', claude: 'sonnet' },
    effort: 'medium'
  });

  assert.deepEqual(selection, { provider: 'codex', model: 'gpt-5.6-terra', effort: 'medium' });
});
