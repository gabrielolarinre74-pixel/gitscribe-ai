import { describe, expect, it } from 'vitest';
import { group, nextVersion, parseLog, prepend, render } from '../src/core/changelog.js';

const raw = [
  ['a1b2c3d4e5', '2026-10-01', 'feat(api): add search endpoint'],
  ['b2c3d4e5f6', '2026-10-02', 'fix: handle empty query'],
  ['c3d4e5f6a7', '2026-10-03', 'docs: explain search syntax'],
  ['d4e5f6a7b8', '2026-10-04', 'refactor(api)!: rename list to search\n\nBREAKING CHANGE: GET /list is now GET /search.'],
  ['e5f6a7b8c9', '2026-10-05', 'Merge pull request #4 from x/y'],
  ['f6a7b8c9d0', '2026-10-06', 'tweak styles'],
].map(([h, d, m]) => `${h}\x1f${d}\x1f${m}\x1e`).join('\n');

describe('changelog', () => {
  const g = group(parseLog(raw));

  it('parses git log records and skips merges', () => {
    expect(g.entries).toHaveLength(4);
    expect(g.other.map((o) => o.message)).toEqual(['tweak styles']);
    expect(g.breaking.map((b) => b.subject)).toEqual(['rename list to search']);
  });

  it('picks the semver bump', () => {
    expect(g.bump).toBe('major');
    expect(group(parseLog('a\x1f2026-01-01\x1ffeat: x\x1e')).bump).toBe('minor');
    expect(group(parseLog('a\x1f2026-01-01\x1ffix: x\x1e')).bump).toBe('patch');
    expect(group([]).bump).toBe('none');
  });

  it('computes the next version, keeping 0.x breaking changes on minor', () => {
    expect(nextVersion('v1.4.2', 'major')).toBe('v2.0.0');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3');
    expect(nextVersion('0.3.1', 'major')).toBe('0.4.0');
    expect(nextVersion('not-a-tag', 'minor')).toBe('0.1.0');
  });

  it('renders sections with breaking notes and linked hashes', () => {
    const md = render(g, { version: 'v2.0.0', date: '2026-10-07', repoUrl: 'https://github.com/acme/app' });
    expect(md).toContain('## v2.0.0 (2026-10-07)');
    expect(md).toContain('### ⚠ Breaking changes\n\n- **api:** GET /list is now GET /search. ([d4e5f6a](https://github.com/acme/app/commit/d4e5f6a7b8))');
    expect(md).toContain('### Features\n\n- **api:** add search endpoint');
    expect(render(g)).toContain('### Bug fixes\n\n- handle empty query (b2c3d4e)');
    expect(md).not.toContain('Documentation');
    expect(render(g, { all: true })).toContain('### Other changes\n\n- tweak styles (f6a7b8c)');
  });

  it('prepends to an existing changelog', () => {
    expect(prepend('# Changelog\n\n## v1.0.0\n', '## v1.1.0\n')).toBe('# Changelog\n\n## v1.1.0\n\n## v1.0.0\n');
    expect(prepend('', '## v0.1.0\n')).toBe('# Changelog\n\n## v0.1.0\n');
  });
});
