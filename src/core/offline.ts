/**
 * The offline engine: reads a parsed diff and writes a Conventional Commit
 * without calling any model. It decides the type from what kind of files
 * changed and what the changed lines do, picks a scope from the paths, and
 * names the functions, routes, dependencies or sections involved.
 */
import { type DiffFile, stats } from './diff.js';
import { kindOf, scopeOf, type FileKind } from './classify.js';
import { symbolChanges, removedExports } from './symbols.js';
import { type Commit, type CommitType, header } from './message.js';

export interface Suggestion extends Commit {
  /** One line on why the engine picked this type. */
  reason: string;
}

interface Analysed extends DiffFile {
  kind: FileKind;
}

const base = (p: string) => p.split('/').pop()!;
const stem = (p: string) => base(p).replace(/\.(test|spec|e2e|stories)?\.?[^.]+$/, '').replace(/^\./, '');
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').toLowerCase().trim();

/** "a", "a and b", "a, b and c", "a, b and 2 more" */
export function list(items: string[], max = 3): string {
  const uniq = [...new Set(items)];
  if (uniq.length <= 1) return uniq[0] ?? '';
  if (uniq.length > max) return `${uniq.slice(0, max - 1).join(', ')} and ${uniq.length - max + 1} more`;
  return `${uniq.slice(0, -1).join(', ')} and ${uniq.at(-1)}`;
}

const strip = (l: string) => l.replace(/\s+/g, '');
const onlyWhitespace = (f: DiffFile) =>
  (f.added.length > 0 || f.removed.length > 0) && f.added.map(strip).filter(Boolean).join('') === f.removed.map(strip).filter(Boolean).join('');

const code = (lines: string[]) => lines.filter((l) => l.trim() && !/^\s*(\/\/|#(?!include)|\*|\/\*|<!--)/.test(l));

// --- signals in changed source lines -------------------------------------------------

const FIX_PATTERNS: [RegExp, string][] = [
  [/(\?\.|\?\?|!= ?null|!== ?(null|undefined)|=== ?(null|undefined)|== ?null|is None|is not None|if \(!\w|if not \w|unless \w)/, 'handle missing values'],
  [/\b(try\s*\{|catch\s*\(|except\b|rescue\b|\.catch\(|if err != nil)/, 'handle errors'],
  [/\b(Number\.isNaN|isNaN\(|Number\.isFinite|parseInt\([^)]*, ?10\)|Math\.(max|min)\()/, 'validate numeric input'],
  [/\b(clearTimeout|clearInterval|removeEventListener|unsubscribe\(|\.abort\(\)|AbortController|return \(\) =>)/, 'clean up listeners and timers'],
  [/(\.trim\(\)|\.toLowerCase\(\)|encodeURIComponent|escape\w*\()/, 'normalise input'],
  [/(<=|>=|length - 1|\+ ?1\b|- ?1\b)/, 'fix an off-by-one boundary'],
];
const PERF = /\b(useMemo|useCallback|React\.memo|memoize|lru|cache[d]?\b|Promise\.all|debounce|throttle|lazy\(|requestIdleCallback|WeakMap|createIndex|\.index\(|batch)/i;
const ROUTE = /\b(?:app|router|server|r)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]|@(Get|Post|Put|Patch|Delete)(?:Mapping)?\(\s*['"]([^'"]+)['"]|@app\.route\(\s*['"]([^'"]+)['"]/;
const DEPRECATE = /@deprecated|DeprecationWarning|\bdeprecat(e|ed|ion)\b/i;
const FIX_WORDS = /\b(fix(es|ed|ing)?|bug|broken|crash|regression|workaround|edge case)\b/i;

function routes(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const m = ROUTE.exec(l);
    if (!m) continue;
    const method = (m[1] ?? m[3] ?? 'GET').toUpperCase();
    const path = m[2] ?? m[4] ?? m[5];
    out.push(`${method} ${path}`);
  }
  return out;
}

// --- dependency changes in manifests ----------------------------------------------------

const DEP_LINE = /^\s*"(@?[\w./-]+)":\s*"([~^]?[\w.*-]+)"/;
const DEP_SECTIONS = /"(dependencies|devDependencies|peerDependencies|optionalDependencies)"/;

export interface DepChange { name: string; from?: string; to?: string }

export function dependencyChanges(f: DiffFile): DepChange[] {
  if (!/package\.json$/.test(f.path)) return [];
  const read = (lines: string[]) => new Map(lines.map((l) => DEP_LINE.exec(l)).filter((m): m is RegExpExecArray => !!m && m[1] !== 'version' && m[1] !== 'name' && !/^(build|test|lint|dev|start|main|module|types|type|description|license)$/.test(m[1]!)).map((m) => [m[1]!, m[2]!.replace(/^[~^]/, '')]));
  const before = read(f.removed);
  const after = read(f.added);
  const out: DepChange[] = [];
  for (const [name, to] of after) out.push({ name, from: before.get(name), to });
  for (const [name, from] of before) if (!after.has(name)) out.push({ name, from });
  return out.filter((d) => d.from !== d.to);
}

const VERSION_LIKE = /^([~^>=<]*\d|latest$|next$|\*$|workspace:|npm:|file:|link:|github:|git)/;
const KV = /^\s*"([\w:.-]+)":\s*"([^"]*)"/;

/** npm scripts added or changed in package.json. */
export function scriptChanges(f: DiffFile): { added: string[]; changed: string[]; removed: string[] } {
  const read = (lines: string[]) => new Map(lines.map((l) => KV.exec(l)).filter((m): m is RegExpExecArray => !!m && !VERSION_LIKE.test(m[2]!) && !/^(name|version|description|main|module|types|type|license|author|homepage)$/.test(m[1]!)).map((m) => [m[1]!, m[2]!]));
  if (!/package\.json$/.test(f.path)) return { added: [], changed: [], removed: [] };
  const before = read(f.removed);
  const after = read(f.added);
  return {
    added: [...after.keys()].filter((k) => !before.has(k)),
    changed: [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k)),
    removed: [...before.keys()].filter((k) => !after.has(k)),
  };
}

const versionBump = (f: DiffFile) => {
  const to = f.added.map((l) => /^\s*"version":\s*"([^"]+)"/.exec(l)?.[1]).find(Boolean);
  return to && f.removed.some((l) => /^\s*"version":/.test(l)) ? to : undefined;
};

// --- the engine ---------------------------------------------------------------------------

interface Draft {
  type: CommitType;
  subject: string;
  alt?: string;
  reason: string;
  breaking?: string[];
  scope?: string | null;
}

function draftFor(files: Analysed[]): Draft {
  const kinds = new Set(files.map((f) => f.kind));
  const only = (...k: FileKind[]) => [...kinds].every((x) => k.includes(x));
  const paths = files.map((f) => f.path);

  // Pure renames / moves.
  if (files.every((f) => f.status === 'renamed' && !f.added.length && !f.removed.length)) {
    const f = files[0]!;
    return files.length === 1
      ? { type: 'refactor', subject: `move ${base(f.oldPath)} to ${f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') + '/' : ''}${base(f.path) === base(f.oldPath) ? '' : base(f.path)}`.replace(/\/$/, ''), reason: 'Only file moves, no content changes.' }
      : { type: 'refactor', subject: `reorganise ${files.length} files`, reason: 'Only file moves, no content changes.' };
  }

  if (files.every(onlyWhitespace)) {
    return { type: 'style', subject: `format ${list(paths.map(base))}`, reason: 'Only whitespace and formatting changed.' };
  }

  if (only('docs')) {
    const headings = files.flatMap((f) => f.added.map((l) => /^#{1,3}\s+(.+)/.exec(l)?.[1]?.replace(/[`*_]/g, '').trim()).filter((h): h is string => !!h));
    const created = files.filter((f) => f.status === 'added');
    if (created.length === files.length) return { type: 'docs', subject: `add ${list(created.map((f) => stem(f.path) === 'README' ? 'readme' : words(stem(f.path))))}${created.length === 1 && !/guide|readme/i.test(created[0]!.path) ? ' guide' : ''}`, reason: 'New documentation files.' };
    if (headings.length) return { type: 'docs', subject: `document ${list(headings.map((h) => h.toLowerCase()), 2)}`, alt: `update ${list(paths.map(base))}`, reason: 'Documentation only, with new sections.' };
    return { type: 'docs', subject: `update ${list(paths.map(base))}`, reason: 'Documentation only.' };
  }

  if (only('test')) {
    const created = files.some((f) => f.status === 'added');
    const subjects = paths.map((p) => words(stem(p)));
    return { type: 'test', subject: `${created ? 'add' : 'update'} tests for ${list(subjects)}`, alt: `cover ${list(subjects)}`, reason: 'Only test files changed.' };
  }

  if (only('ci')) {
    const names = files.map((f) => {
      const named = f.added.map((l) => /^name:\s*['"]?(.+?)['"]?\s*$/.exec(l)?.[1]).find(Boolean);
      return (named ?? words(stem(f.path))).toLowerCase().replace(/\s+workflow$/, '');
    });
    const node = files.flatMap((f) => f.added).map((l) => /node-version:\s*\[?\s*['"]?([\d.x]+)/.exec(l)?.[1]).find(Boolean);
    if (files.every((f) => f.status === 'added')) return { type: 'ci', subject: `add ${list(names)} workflow${names.length > 1 ? 's' : ''}`, reason: 'New CI workflow.' };
    if (node) return { type: 'ci', subject: `run ${list(names)} on Node ${node}`, alt: `update ${list(names)} workflow`, reason: 'CI configuration only.' };
    return { type: 'ci', subject: `update ${list(names)} workflow${names.length > 1 ? 's' : ''}`, reason: 'CI configuration only.' };
  }

  if (only('build', 'deps', 'config')) {
    const manifests = files.filter((f) => /package\.json$/.test(f.path));
    const deps = manifests.flatMap(dependencyChanges);
    const bump = manifests.map(versionBump).find(Boolean);
    if (deps.length) {
      const added = deps.filter((d) => !d.from);
      const removed = deps.filter((d) => !d.to);
      const bumped = deps.filter((d) => d.from && d.to);
      const parts: string[] = [];
      if (bumped.length === 1 && !added.length && !removed.length) {
        const d = bumped[0]!;
        return { type: 'build', subject: `bump ${d.name} from ${d.from} to ${d.to}`, alt: `upgrade ${d.name} to ${d.to}`, reason: 'Dependency version change.', scope: 'deps' };
      }
      if (added.length) parts.push(`add ${list(added.map((d) => d.name), 2)}`);
      if (bumped.length) parts.push(`bump ${list(bumped.map((d) => d.name), 2)}`);
      if (removed.length) parts.push(`remove ${list(removed.map((d) => d.name), 2)}`);
      return { type: 'build', subject: parts.join(', '), alt: `update ${deps.length} dependenc${deps.length > 1 ? 'ies' : 'y'}`, reason: 'Dependency changes in package.json.', scope: 'deps' };
    }
    if (bump) return { type: 'chore', subject: `release ${bump}`, reason: 'Package version bump.', scope: 'release' };
    const scripts = manifests.map(scriptChanges);
    const sAdded = scripts.flatMap((x) => x.added);
    const sChanged = scripts.flatMap((x) => x.changed);
    const sRemoved = scripts.flatMap((x) => x.removed);
    if (manifests.length === files.length && sAdded.length + sChanged.length + sRemoved.length) {
      const parts: string[] = [];
      if (sAdded.length) parts.push(`add ${list(sAdded, 2)}`);
      if (sChanged.length) parts.push(`${parts.length ? 'update' : 'update'} ${list(sChanged, 2)}`);
      if (sRemoved.length) parts.push(`remove ${list(sRemoved, 2)}`);
      const n = sAdded.length + sChanged.length + sRemoved.length;
      return { type: 'chore', subject: `${parts.join(', ')} script${n > 1 ? 's' : ''}`, alt: `update npm scripts`, reason: 'Only npm scripts changed in package.json.' };
    }
    if (only('deps')) return { type: 'build', subject: 'refresh lockfile', reason: 'Only the lockfile changed.', scope: 'deps' };
    const ignored = files.filter((f) => base(f.path) === '.gitignore').flatMap((f) => f.added.filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim()));
    if (only('config') && ignored.length && files.length === 1) return { type: 'chore', subject: `ignore ${list(ignored)}`, reason: 'New ignore rules.' };
    const type: CommitType = only('config') ? 'chore' : 'build';
    return { type, subject: `update ${list(paths.map(base))}`, reason: type === 'build' ? 'Build tooling only.' : 'Project configuration only.' };
  }

  // --- source changes ---
  const src = files.filter((f) => !['docs', 'test', 'deps', 'ci', 'config', 'asset'].includes(f.kind));
  const pool = src.length ? src : files;
  const plus = pool.flatMap((f) => code(f.added));
  const minus = pool.flatMap((f) => code(f.removed));
  const sym = pool.map((f) => ({ f, s: symbolChanges(f.added, f.removed, f.contexts, f.enclosing) }));
  const newSyms = sym.flatMap(({ s }) => s.added);
  const goneSyms = sym.flatMap(({ s }) => s.removed);
  const touched = [...new Set(sym.flatMap(({ s }) => [...s.changed, ...s.touched]))];
  const newRoutes = routes(plus).filter((r) => !routes(minus).includes(r));
  const brokenExports = pool.flatMap((f) => (f.status === 'deleted' ? [] : removedExports(f.removed, f.added)));
  const createdFiles = pool.filter((f) => f.status === 'added');
  const deletedFiles = pool.filter((f) => f.status === 'deleted');
  const where = touched.length ? ` in ${list(touched, 2)}` : pool.length <= 2 ? ` in ${list(pool.map((f) => base(f.path)), 2)}` : '';

  // Deprecations.
  if (pool.some((f) => f.added.some((l) => DEPRECATE.test(l)) && !f.removed.some((l) => DEPRECATE.test(l)))) {
    const text = plus.join('\n');
    const named = /\b([A-Z]\w+|\w+\(\))\s+is deprecated/.exec(text)?.[1];
    const instead = /\buse\s+`?([A-Za-z_]\w*)`?\s+instead/i.exec(text)?.[1];
    const target = named ?? touched[0] ?? newSyms[0] ?? stem(pool[0]!.path);
    return { type: 'refactor', subject: `deprecate ${target}${instead ? ` in favour of ${instead}` : ''}`, alt: `deprecate ${target}`, reason: 'A deprecation marker or warning was added.' };
  }

  // Removals.
  if (deletedFiles.length && deletedFiles.length >= pool.length - 1 && plus.length < minus.length / 3) {
    const names = deletedFiles.map((f) => words(stem(f.path)));
    const breaking = deletedFiles.some((f) => f.removed.some((l) => /^\s*(export\s|module\.exports|pub\s)/.test(l)));
    return { type: breaking ? 'feat' : 'refactor', subject: `remove ${list(names)}`, reason: 'Source files were deleted.', breaking: breaking ? deletedFiles.map((f) => base(f.path)) : undefined };
  }
  if (goneSyms.length && !newSyms.length && plus.length < minus.length / 2) {
    return { type: brokenExports.length ? 'feat' : 'refactor', subject: `remove ${list(goneSyms)}`, reason: 'Declarations were removed and little was added.', breaking: brokenExports.length ? brokenExports : undefined };
  }

  // Features: new files, exports, routes.
  if (newRoutes.length || createdFiles.length || newSyms.length >= 1 && plus.length > minus.length * 1.5) {
    const things = newRoutes.length ? [...newRoutes.map((r) => `${r} endpoint`)] : newSyms.length ? newSyms : createdFiles.map((f) => words(stem(f.path)));
    const alt = newRoutes.length && newSyms.length ? `add ${list(newSyms)}` : createdFiles.length && newSyms.length ? `add ${list(createdFiles.map((f) => words(stem(f.path))))}` : undefined;
    return { type: 'feat', subject: `add ${list(things, newRoutes.length ? 2 : 3)}`, alt, reason: newRoutes.length ? 'New HTTP routes.' : createdFiles.length ? 'New source files.' : 'New declarations that outweigh removals.', breaking: brokenExports.length ? brokenExports : undefined };
  }

  // Performance.
  const perfAdded = plus.filter((l) => PERF.test(l)).length;
  const perfNote = pool.some((f) => f.added.some((l) => /(\/\/|#|\*)/.test(l) && /\b(perf(ormance)?|faster|speed( up)?|optimi[sz]\w*|efficien\w*|improved? (loop|iteration|lookup))\b/i.test(l)));
  if (perfNote && !newSyms.length) {
    return { type: 'perf', subject: `optimise ${touched.length ? list(touched, 2) : list(pool.map((f) => base(f.path)), 2)}`, alt: `speed up ${touched[0] ?? words(stem(pool[0]!.path))}`, reason: 'A comment in the change describes a performance improvement.' };
  }
  if (perfAdded && perfAdded > minus.filter((l) => PERF.test(l)).length) {
    const what = plus.some((l) => /Promise\.all/.test(l)) ? 'run requests in parallel' : plus.some((l) => /memo|cache|lru/i.test(l)) ? 'cache results' : plus.some((l) => /debounce|throttle/i.test(l)) ? 'debounce updates' : 'speed up';
    return { type: 'perf', subject: `${what}${where}`, alt: touched[0] ? `speed up ${touched[0]}` : undefined, reason: 'Caching, memoisation or parallelism was introduced.' };
  }

  // Fixes.
  const explicitFix = pool.some((f) => f.added.some((l) => /^\s*(\/\/|#|\*)/.test(l) && FIX_WORDS.test(l)));
  const fixHits = FIX_PATTERNS.map(([re, label]) => ({ label, n: plus.filter((l) => re.test(l)).length - minus.filter((l) => re.test(l)).length })).filter((h) => h.n > 0).sort((a, b) => b.n - a.n);
  const small = plus.length + minus.length <= 40;
  if (explicitFix || (fixHits.length && small && !newSyms.length)) {
    const exception = pool.flatMap((f) => f.added.filter((l) => /^\s*(\/\/|#|\*)/.test(l))).map((l) => /\b(\w+(?:Exception|Error))\b/.exec(l)?.[1]).find(Boolean);
    const label = exception ? `prevent ${exception}` : fixHits[0]?.label ?? 'correct behaviour';
    return { type: 'fix', subject: `${label}${where}`, alt: touched[0] ? `correct ${touched[0]} behaviour` : undefined, reason: explicitFix ? 'A comment in the change mentions a bug.' : `Added ${label.replace(/^(handle|fix|validate|clean up|normalise) /, '')} checks in a small change.` };
  }

  // Refactors.
  if (goneSyms.length === 1 && newSyms.length === 1) {
    return { type: 'refactor', subject: `rename ${goneSyms[0]} to ${newSyms[0]}`, reason: 'One declaration replaced by another.' };
  }
  if (newSyms.length && minus.length >= plus.length * 0.5) {
    return { type: 'refactor', subject: `extract ${list(newSyms)}${touched.length ? ` from ${list(touched, 2)}` : ''}`, reason: 'New helpers with matching removals elsewhere.' };
  }
  if (minus.length > plus.length * 1.3 && minus.length - plus.length > 3) {
    return { type: 'refactor', subject: `simplify ${touched.length ? list(touched, 2) : list(pool.map((f) => base(f.path)), 2)}`, reason: 'More lines removed than added, no new behaviour detected.' };
  }

  const area = touched.length ? list(touched, 2) : list(pool.map((f) => words(stem(f.path))), 2);
  if (newSyms.length) return { type: 'feat', subject: `add ${list(newSyms)}`, reason: 'New declarations.' };
  return { type: plus.length > minus.length ? 'feat' : 'refactor', subject: `${plus.length > minus.length ? 'extend' : 'update'} ${area}`, alt: `update ${list(pool.map((f) => base(f.path)), 2)}`, reason: 'General source changes.' };
}

function bodyFor(files: Analysed[]): string {
  const lines: string[] = [];
  const shown = files.filter((f) => f.kind !== 'deps').slice(0, 6);
  for (const f of shown) {
    const s = symbolChanges(f.added, f.removed, f.contexts, f.enclosing);
    const r = routes(code(f.added));
    const deps = dependencyChanges(f);
    const counts = `(+${f.added.length} -${f.removed.length})`;
    let what: string;
    if (f.status === 'added') what = `add ${f.path}`;
    else if (f.status === 'deleted') what = `delete ${f.path}`;
    else if (f.status === 'renamed') what = `move ${f.oldPath} to ${f.path}`;
    else if (deps.length) what = `${f.path}: ${list(deps.map((d) => (d.from && d.to ? `${d.name} ${d.from} → ${d.to}` : d.to ? `+${d.name}` : `-${d.name}`)), 4)}`;
    else if (r.length) what = `${f.path}: add ${list(r, 2)}`;
    else if (s.added.length) what = `${f.path}: add ${list(s.added)}`;
    else if (s.removed.length) what = `${f.path}: remove ${list(s.removed)}`;
    else if (s.changed.length || s.touched.length) what = `${f.path}: change ${list([...s.changed, ...s.touched])}`;
    else what = `update ${f.path}`;
    lines.push(`- ${what} ${counts}`);
  }
  const rest = files.length - shown.length - files.filter((f) => f.kind === 'deps').length;
  if (rest > 0) lines.push(`- and ${rest} more file${rest > 1 ? 's' : ''}`);
  return lines.join('\n');
}

const fit = (type: CommitType, scope: string | undefined, breaking: boolean, subject: string, max: number) => {
  let s = subject.replace(/\s+/g, ' ').trim();
  while (header({ type, scope, breaking, subject: s }).length > max && / and \d+ more$| and [^,]+$|, /.test(s)) {
    const next = s.replace(/(, [^,]+)? and [^,]+$/, (m, a) => (a ? ' and more' : '')).trim();
    if (next === s) break;
    s = next;
  }
  if (header({ type, scope, breaking, subject: s }).length > max) s = s.slice(0, Math.max(10, max - header({ type, scope, breaking, subject: '' }).length - 1)).replace(/\s+\S*$/, '');
  return s;
};

export interface OfflineOptions {
  /** Maximum header length (default 72). */
  maxLength?: number;
  /** Force a type instead of inferring it. */
  type?: CommitType;
  /** Force a scope, or pass false to never add one. */
  scope?: string | false;
}

/** Up to three distinct suggestions, best first. */
export function suggest(files: DiffFile[], opts: OfflineOptions = {}): Suggestion[] {
  const max = opts.maxLength ?? 72;
  const analysed: Analysed[] = files.filter((f) => !f.binary || f.status !== 'modified').map((f) => ({ ...f, kind: kindOf(f.path) }));
  if (!analysed.length) return [];
  const meaningful = analysed.filter((f) => f.kind !== 'deps');
  const draft = draftFor(meaningful.length ? meaningful : analysed);
  const type = opts.type ?? draft.type;
  const scope = opts.scope === false ? undefined : opts.scope || (draft.scope === null ? undefined : draft.scope ?? scopeOf((meaningful.length ? meaningful : analysed).filter((f) => !['test', 'docs'].includes(f.kind) || meaningful.every((m) => ['test', 'docs'].includes(m.kind))).map((f) => f.path)));
  const breaking = !!draft.breaking?.length;
  const footers = breaking ? [`BREAKING CHANGE: ${list(draft.breaking!, 4)} ${draft.breaking!.length > 1 ? 'were' : 'was'} removed.`] : [];
  const body = bodyFor(analysed);
  const testsToo = draft.type !== 'test' && analysed.some((f) => f.kind === 'test');
  const fullBody = testsToo ? `${body}\n\nTests updated alongside the change.` : body;

  const out: Suggestion[] = [];
  const push = (s: Omit<Suggestion, 'subject'> & { subject: string }) => {
    const subject = fit(s.type, s.scope, s.breaking, s.subject, max);
    if (!out.some((o) => header(o) === header({ ...s, subject }))) out.push({ ...s, subject });
  };
  push({ type, scope, breaking, subject: draft.subject, body: analysed.length > 1 ? fullBody : undefined, footers, reason: draft.reason });
  if (draft.alt) push({ type, scope, breaking, subject: draft.alt, body: fullBody, footers, reason: draft.reason });
  if (scope) push({ type, scope: undefined, breaking, subject: draft.subject, body: fullBody, footers, reason: `${draft.reason} Without a scope.` });
  else push({ type, scope, breaking, subject: draft.subject, body: fullBody, footers, reason: `${draft.reason} With a file-by-file body.` });
  return out.slice(0, 3);
}

export const summary = (files: DiffFile[]) => {
  const s = stats(files);
  return `${s.files} file${s.files === 1 ? '' : 's'}, +${s.insertions} -${s.deletions}`;
};
