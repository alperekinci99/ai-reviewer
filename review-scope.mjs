function unquoteGitPath(path) {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
}

/**
 * Returns the exact new-file lines represented by `+` lines in a unified diff.
 * Review findings must point to one of these lines; surrounding context exists
 * only to help understand the change, not as an independently reviewable scope.
 */
export function changedLinesByFile(diff) {
  const linesByFile = new Map();
  let file = null;
  let newLine = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      file = path === '/dev/null' ? null : unquoteGitPath(path.replace(/^b\//, ''));
      newLine = null;
      if (file && !linesByFile.has(file)) linesByFile.set(file, new Set());
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { newLine = Number(hunk[1]); continue; }
    if (newLine === null || !file) continue;

    if (line.startsWith('+')) linesByFile.get(file).add(newLine++);
    else if (line.startsWith(' ')) newLine++;
  }
  return linesByFile;
}

export function isFindingInChangedCode(finding, changedLines) {
  return typeof finding?.file === 'string'
    && Number.isInteger(finding?.line)
    && changedLines.get(finding.file)?.has(finding.line) === true;
}

export function limitReviewToChangedCode(review, diff) {
  const changedLines = changedLinesByFile(diff);
  const findings = review.findings.filter(finding => isFindingInChangedCode(finding, changedLines));
  if (findings.length === 0) {
    return {
      summary: { verdict: 'approve', one_line: 'Değiştirilen kod satırlarında kanıtlanabilir bir sorun bulunmadı.' },
      findings
    };
  }
  return { ...review, summary: { ...review.summary, verdict: 'needs_changes' }, findings };
}
