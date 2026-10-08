import { describe, expect, it } from 'vitest';
import { parseDiff, stats, trimDiff } from '../src/core/diff.js';
import { fixture, parsedFixture } from './helpers.js';

describe('parseDiff', () => {
  it('reads files, status and changed lines', () => {
    const files = parsedFixture('new-feature.diff');
    expect(files.map((f) => [f.path, f.status])).toEqual([['src/features/newFeature.js', 'added'], ['src/app.js', 'modified']]);
    expect(files[1]!.added).toContain("const { factorial } = require('./features/newFeature');");
    expect(stats(files)).toEqual({ files: 2, insertions: 23, deletions: 0 });
  });

  it('tracks new-file line numbers for added lines', () => {
    const [, app] = parsedFixture('new-feature.diff');
    expect(app!.addedAt[0]).toBe(5);
    expect(app!.addedAt[1]).toBe(25);
  });

  it('finds the declaration that encloses a change', () => {
    const [file] = parsedFixture('fix-nullpointer-exception.diff');
    expect(file!.enclosing).toContain('processItems');
  });

  it('handles renames, deletions and binary files', () => {
    const files = parseDiff([
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 100%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      'diff --git a/gone.js b/gone.js',
      'deleted file mode 100644',
      '--- a/gone.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-module.exports = 1;',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n'));
    expect(files.map((f) => [f.oldPath, f.path, f.status, f.binary])).toEqual([
      ['old/name.ts', 'new/name.ts', 'renamed', false],
      ['gone.js', 'gone.js', 'deleted', false],
      ['logo.png', 'logo.png', 'modified', true],
    ]);
  });
});

describe('trimDiff', () => {
  it('drops whole files from the end and says how many', () => {
    const text = fixture('new-feature.diff');
    const out = trimDiff(text, 700);
    expect(out).toContain('newFeature.js');
    expect(out).toMatch(/\[1 more file not shown\]$/);
  });
});
