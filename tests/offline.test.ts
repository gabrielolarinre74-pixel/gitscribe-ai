import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/core/diff.js';
import { suggest, list, dependencyChanges } from '../src/core/offline.js';
import { header, lint } from '../src/core/message.js';
import { kindOf, scopeOf } from '../src/core/classify.js';
import { diffOf, parsedFixture } from './helpers.js';

const best = (diff: string, opts = {}) => header(suggest(parseDiff(diff), opts)[0]!);
const bestFixture = (name: string) => header(suggest(parsedFixture(name))[0]!);

describe('offline engine on real-world shaped diffs', () => {
  it.each([
    ['new-feature.diff', 'feat: add GET /factorial/:number endpoint'],
    ['fix-nullpointer-exception.diff', 'fix(example): prevent NullPointerException in processItems'],
    ['code-refactoring.diff', 'refactor: rename ExampleComponent to ImprovedExampleComponent'],
    ['code-style.diff', 'style: format app.js'],
    ['continous-integration.diff', 'ci: add continuous integration workflow'],
    ['deprecate-feature.diff', 'refactor: deprecate OldFeature in favour of NewFeature'],
    ['performance-improvement.diff', 'perf: optimise processData'],
    ['chore.diff', 'chore: add clean script'],
    ['documentation-changes.diff', 'docs: document overview'],
  ])('%s → %s', (file, expected) => {
    expect(bestFixture(file)).toBe(expected);
  });

  it('only ever produces headers that pass the linter', () => {
    for (const f of ['new-feature.diff', 'remove-feature.diff', 'testing-react-application.diff', 'github-action-build-pipeline.diff']) {
      for (const s of suggest(parsedFixture(f))) expect(lint(header(s)).filter((i) => i.level === 'error')).toEqual([]);
    }
  });
});

describe('offline engine rules', () => {
  it('names dependency bumps with versions', () => {
    const d = diffOf('package.json', ['    "next": "^15.1.0",'], ['    "next": "^16.0.2",']);
    expect(best(d)).toBe('build(deps): bump next from 15.1.0 to 16.0.2');
    expect(dependencyChanges(parseDiff(d)[0]!)).toEqual([{ name: 'next', from: '15.1.0', to: '16.0.2' }]);
  });

  it('lists added and removed dependencies, ignoring the lockfile', () => {
    const d = diffOf('package.json', ['    "lodash": "^4.17.21",'], ['    "zod": "^4.0.0",', '    "clsx": "^2.1.1",']) + diffOf('package-lock.json', ['old'], ['new']);
    expect(best(d)).toBe('build(deps): add zod and clsx, remove lodash');
  });

  it('spots a release version bump', () => {
    expect(best(diffOf('package.json', ['  "version": "1.2.0",'], ['  "version": "1.3.0",']))).toBe('chore(release): release 1.3.0');
  });

  it('describes new ignore rules', () => {
    expect(best(diffOf('.gitignore', [], ['.env.local', 'coverage/']))).toBe('chore: ignore .env.local and coverage/');
  });

  it('uses new markdown headings for docs', () => {
    expect(best(diffOf('README.md', [], ['## Installation', 'npm i', '## Configuration']))).toBe('docs: document installation and configuration');
  });

  it('marks removed exports as breaking', () => {
    const d = diffOf('src/api/client.ts', ['export function legacyFetch(url: string) {', '  return fetch(url);', '}', 'export const keep = 1;'], ['export const keep = 1;']);
    const [s] = suggest(parseDiff(d));
    expect(header(s!)).toBe('feat(api)!: remove legacyFetch');
    expect(s!.footers[0]).toMatch(/^BREAKING CHANGE: legacyFetch was removed/);
  });

  it('calls Promise.all a performance change', () => {
    const d = diffOf('src/feed/load.ts', ['  const a = await getA();', '  const b = await getB();'], ['  const [a, b] = await Promise.all([getA(), getB()]);'], { context: 'export async function loadFeed() {' });
    expect(best(d)).toBe('perf(feed): run requests in parallel in loadFeed');
  });

  it('respects forced type, scope and length', () => {
    const d = parsedFixture('new-feature.diff');
    expect(header(suggest(d, { type: 'fix' })[0]!)).toMatch(/^fix: /);
    expect(header(suggest(d, { scope: 'math' })[0]!)).toMatch(/^feat\(math\): /);
    for (const s of suggest(d, { maxLength: 40 })) expect(header(s).length).toBeLessThanOrEqual(40);
  });

  it('adds a file-by-file body for multi-file changes', () => {
    const [s] = suggest(parsedFixture('new-feature.diff'));
    expect(s!.body).toContain('- add src/features/newFeature.js (+16 -0)');
    expect(s!.body).toContain('- src/app.js: add GET /factorial/:number (+7 -0)');
  });
});

describe('helpers', () => {
  it('lists naturally', () => {
    expect(list(['a'])).toBe('a');
    expect(list(['a', 'b'])).toBe('a and b');
    expect(list(['a', 'b', 'c'])).toBe('a, b and c');
    expect(list(['a', 'b', 'c', 'd', 'e'])).toBe('a, b and 3 more');
  });

  it('classifies paths', () => {
    expect(kindOf('.github/workflows/ci.yml')).toBe('ci');
    expect(kindOf('src/user.test.ts')).toBe('test');
    expect(kindOf('docs/setup.md')).toBe('docs');
    expect(kindOf('pnpm-lock.yaml')).toBe('deps');
    expect(kindOf('vite.config.ts')).toBe('build');
    expect(kindOf('src/index.ts')).toBe('source');
  });

  it('infers scopes from shared folders', () => {
    expect(scopeOf(['src/auth/login.ts', 'src/auth/session.ts'])).toBe('auth');
    expect(scopeOf(['packages/api/src/index.ts', 'packages/api/README.md'])).toBe('api');
    expect(scopeOf(['src/auth/login.ts', 'src/billing/plan.ts'])).toBeUndefined();
    expect(scopeOf(['index.ts'])).toBeUndefined();
  });
});
