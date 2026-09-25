import test from 'node:test';
import assert from 'node:assert/strict';
import { azureBoardsWiql, azureOrganizationUrl, normalizeAzureBoardItems, workflowPointsForStoryPoints } from './azure-boards.mjs';

test('Azure Boards sorgusu yalnızca Backlog ve Todo durumlarını, seçilen kişiyi kapsar', () => {
  const query = azureBoardsWiql("Ada O'Neil <ada@example.com>");
  assert.match(query, /\[System\.AssignedTo\] = 'Ada O''Neil <ada@example\.com>'/);
  assert.match(query, /IN \('Backlog', 'Todo', 'To Do'\)/);
  assert.match(query, /\[Microsoft\.VSTS\.Scheduling\.StoryPoints\]/);
});

test('@Me varsayılanı ve organizasyon URL’si normalize edilir', () => {
  assert.match(azureBoardsWiql(), /\[System\.AssignedTo\] = @Me/);
  assert.equal(azureOrganizationUrl('orbit-dev'), 'https://dev.azure.com/orbit-dev');
  assert.equal(azureOrganizationUrl('https://dev.azure.com/orbit-dev/'), 'https://dev.azure.com/orbit-dev');
});

test('Azure CLI iş kaydı workflow için güvenli metne dönüştürülür', () => {
  const items = normalizeAzureBoardItems([{ fields: {
    'System.Id': 42,
    'System.Title': 'Giriş <b>akışını</b> düzelt',
    'System.State': 'Todo',
    'System.Description': '<p>Hata kaydını incele.</p><p>Kabul kriteri: test ekle.</p>',
    'System.AssignedTo': { displayName: 'Ada O\'Neil' },
    'Microsoft.VSTS.Scheduling.StoryPoints': 5
  } }], 'https://dev.azure.com/orbit-dev', 'Portal');
  assert.deepEqual(items, [{
    id: 42,
    title: 'Giriş akışını düzelt',
    state: 'Todo',
    description: 'Hata kaydını incele.\nKabul kriteri: test ekle.',
    assignedTo: 'Ada O\'Neil',
    storyPoints: 5,
    workflowPoints: 5,
    url: 'https://dev.azure.com/orbit-dev/Portal/_workitems/edit/42'
  }]);
});

test('Story Points workflow profilindeki 2, 3 ve 5 puana eşlenir', () => {
  assert.equal(workflowPointsForStoryPoints(1), 2);
  assert.equal(workflowPointsForStoryPoints(2), 2);
  assert.equal(workflowPointsForStoryPoints(3), 3);
  assert.equal(workflowPointsForStoryPoints(4), 3);
  assert.equal(workflowPointsForStoryPoints(5), 5);
  assert.equal(workflowPointsForStoryPoints(8), 5);
  assert.equal(workflowPointsForStoryPoints(null), 3);
});
