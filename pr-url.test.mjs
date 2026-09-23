import test from 'node:test';
import assert from 'node:assert/strict';
import { azurePullRequestUrl } from './pr-url.mjs';

test('Azure DevOps PR URL içinden bağlantı bilgilerini çıkarır', () => {
  assert.deepEqual(
    azurePullRequestUrl('https://dev.azure.com/FloTechnology/EcomFrontend/_git/sites/pullrequest/43238'),
    { organization: 'FloTechnology', project: 'EcomFrontend', repository: 'sites', id: '43238' }
  );
});

test('Azure DevOps olmayan URL için fallback bilgisi üretmez', () => {
  assert.equal(azurePullRequestUrl('https://github.com/openai/example/pull/42'), null);
});
