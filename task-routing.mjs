export const taskProfiles = Object.freeze({
  2: Object.freeze({
    label: 'Küçük',
    codex: Object.freeze({ model: 'gpt-5.6-luna', effort: 'low' }),
    claude: Object.freeze({ model: 'haiku' })
  }),
  3: Object.freeze({
    label: 'Orta',
    codex: Object.freeze({ model: 'gpt-5.6-terra', effort: 'medium' }),
    claude: Object.freeze({ model: 'sonnet' })
  }),
  5: Object.freeze({
    label: 'Kapsamlı',
    codex: Object.freeze({ model: 'gpt-5.6-sol', effort: 'high' }),
    claude: Object.freeze({ model: 'opus' })
  })
});

export function taskProfile(value, fallback = 3) {
  const points = Number(value ?? fallback);
  if (!Object.hasOwn(taskProfiles, points)) throw new Error('İş puanı yalnızca 2, 3 veya 5 olabilir.');
  return { points, ...taskProfiles[points] };
}
