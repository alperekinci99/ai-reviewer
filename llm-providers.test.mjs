import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeExecArgs, codexExecArgs, resolveLocalAgent } from './llm-providers.mjs';

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

test('görev görselleri yeni ve devam eden Codex turlarına eklenir', () => {
  const images = ['/tmp/task-assets/mockup.png', '/tmp/task-assets/error.jpg'];
  const initial = codexExecArgs({ mode: 'execute', images, outputPath: '/tmp/result.md' });
  const resumed = codexExecArgs({ mode: 'execute', sessionId: 'session-123', images, outputPath: '/tmp/result.md' });

  for (const args of [initial, resumed]) {
    assert.equal(args.filter(argument => argument === '--image').length, 2);
    assert.ok(args.includes(images[0]));
    assert.ok(args.includes(images[1]));
  }
});

test('Claude Code görev görsellerinin klasörüne salt okunur erişim alır', () => {
  const args = claudeExecArgs({
    mode: 'execute',
    images: ['/tmp/task-1/mockup.png', '/tmp/task-1/error.jpg'],
    model: 'sonnet'
  });

  assert.equal(args.filter(argument => argument === '--add-dir').length, 1);
  assert.equal(args.filter(argument => argument === '/tmp/task-1').length, 1);
  assert.ok(args.includes('acceptEdits'));
});

test('seçili provider için model çalışma başlamadan belirlenir', async () => {
  const selection = await resolveLocalAgent({
    provider: 'codex',
    models: { codex: 'gpt-5.6-terra', claude: 'sonnet' },
    effort: 'medium'
  });

  assert.deepEqual(selection, { provider: 'codex', model: 'gpt-5.6-terra', effort: 'medium' });
});
