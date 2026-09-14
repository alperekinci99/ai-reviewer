import test from 'node:test';
import assert from 'node:assert/strict';
import { changedLinesByFile, limitReviewToChangedCode } from './review-scope.mjs';

const diff = `diff --git a/src/a.js b/src/a.js
index 1..2 100644
--- a/src/a.js
+++ b/src/a.js
@@ -10,3 +10,4 @@ export function run() {
 const enabled = true;
-return oldValue;
+const value = getValue();
+return value;
 }
diff --git a/src/new.js b/src/new.js
new file mode 100644
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,2 @@
+export const ready = true;
+`;

test('yalnızca diff ile eklenen yeni dosya satırlarını kapsam kabul eder', () => {
  const changed = changedLinesByFile(diff);
  assert.deepEqual([...changed.get('src/a.js')], [11, 12]);
  assert.deepEqual([...changed.get('src/new.js')], [1, 2]);
});

test('değişmeyen satıra veya dosyaya işaret eden bulguları eler', () => {
  const review = {
    summary: { verdict: 'needs_changes', one_line: 'Model özeti' },
    findings: [
      { file: 'src/a.js', line: 12, severity: 'medium', title: 'Geçerli', reason: 'x', suggestion: 'y' },
      { file: 'src/a.js', line: 10, severity: 'medium', title: 'Bağlam', reason: 'x', suggestion: 'y' },
      { file: 'src/elsewhere.js', line: 1, severity: 'medium', title: 'Dosya dışı', reason: 'x', suggestion: 'y' }
    ]
  };
  const result = limitReviewToChangedCode(review, diff);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].line, 12);
  assert.equal(result.summary.verdict, 'needs_changes');
});

test('tüm bulgular kapsam dışı kalırsa incelemeyi onaylar', () => {
  const result = limitReviewToChangedCode({
    summary: { verdict: 'needs_changes', one_line: 'Model özeti' },
    findings: [{ file: 'src/a.js', line: 10, severity: 'medium', title: 'Bağlam', reason: 'x', suggestion: 'y' }]
  }, diff);
  assert.deepEqual(result, {
    summary: { verdict: 'approve', one_line: 'Değiştirilen kod satırlarında kanıtlanabilir bir sorun bulunmadı.' },
    findings: []
  });
});
