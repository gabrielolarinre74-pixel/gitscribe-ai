/** Turn Conventional Commits from `git log` into release notes and a version bump. */
import { parse, type Commit, type CommitType } from './message.js';

export interface LogEntry {
  hash: string;
  date: string;
  message: string;
}

export interface Entry extends Commit {
  hash: string;
  date: string;
}

export type Bump = 'major' | 'minor' | 'patch' | 'none';

const SECTIONS: [CommitType, string][] = [
  ['feat', 'Features'],
  ['fix', 'Bug fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['build', 'Build and dependencies'],
  ['ci', 'Continuous integration'],
  ['test', 'Tests'],
  ['style', 'Style'],
  ['chore', 'Chores'],
  ['revert', 'Reverts'],
];

/** Record separator used to split `git log` output safely. */
export const LOG_FORMAT = '%H%x1f%cs%x1f%B%x1e';

export function parseLog(raw: string): LogEntry[] {
  return raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [hash = '', date = '', message = ''] = r.split('\x1f');
    return { hash, date, message: message.trim() };
  });
}

export interface Grouped {
  entries: Entry[];
  /** Commits that are not Conventional Commits. */
  other: LogEntry[];
  breaking: Entry[];
  bump: Bump;
}

export function group(log: LogEntry[]): Grouped {
  const entries: Entry[] = [];
  const other: LogEntry[] = [];
  for (const l of log) {
    if (/^Merge (pull request|branch|remote-tracking)/.test(l.message)) continue;
    const c = parse(l.message);
    if (c) entries.push({ ...c, hash: l.hash, date: l.date });
    else other.push(l);
  }
  const breaking = entries.filter((e) => e.breaking);
  const bump: Bump = breaking.length ? 'major' : entries.some((e) => e.type === 'feat') ? 'minor' : entries.some((e) => ['fix', 'perf'].includes(e.type)) ? 'patch' : entries.length || other.length ? 'patch' : 'none';
  return { entries, other, breaking, bump };
}

/** Next version for a bump. Before 1.0.0, breaking changes bump the minor version. */
export function nextVersion(current: string, bump: Bump): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) return bump === 'none' ? current : '0.1.0';
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const prefix = current.startsWith('v') ? 'v' : '';
  if (bump === 'none') return current;
  if (bump === 'major' && maj === 0) bump = 'minor';
  if (bump === 'major') [maj, min, pat] = [maj + 1, 0, 0];
  else if (bump === 'minor') [min, pat] = [min + 1, 0];
  else pat++;
  return `${prefix}${maj}.${min}.${pat}`;
}

export interface RenderOptions {
  version?: string;
  date?: string;
  /** e.g. https://github.com/user/repo, used to link commit hashes. */
  repoUrl?: string;
  /** Include docs, chores, tests and other housekeeping (default false). */
  all?: boolean;
}

const VISIBLE = new Set<CommitType>(['feat', 'fix', 'perf', 'refactor', 'revert']);

export function render(g: Grouped, opts: RenderOptions = {}): string {
  const lines: string[] = [];
  const title = opts.version ? `## ${opts.version}${opts.date ? ` (${opts.date})` : ''}` : `## Unreleased${opts.date ? ` (${opts.date})` : ''}`;
  lines.push(title, '');
  const link = (e: Entry) => {
    const short = e.hash.slice(0, 7);
    return opts.repoUrl ? `([${short}](${opts.repoUrl.replace(/\/$/, '')}/commit/${e.hash}))` : `(${short})`;
  };
  const item = (e: Entry) => `- ${e.scope ? `**${e.scope}:** ` : ''}${e.subject} ${link(e)}`;

  if (g.breaking.length) {
    lines.push('### ⚠ Breaking changes', '');
    for (const e of g.breaking) {
      const note = e.footers.find((f) => /^BREAKING[ -]CHANGE: /.test(f))?.replace(/^BREAKING[ -]CHANGE: /, '');
      lines.push(`- ${e.scope ? `**${e.scope}:** ` : ''}${note ?? e.subject} ${link(e)}`);
    }
    lines.push('');
  }
  for (const [type, label] of SECTIONS) {
    if (!opts.all && !VISIBLE.has(type)) continue;
    const items = g.entries.filter((e) => e.type === type);
    if (!items.length) continue;
    lines.push(`### ${label}`, '');
    const sorted = [...items].sort((a, b) => (a.scope ?? '~').localeCompare(b.scope ?? '~'));
    for (const e of sorted) lines.push(item(e));
    lines.push('');
  }
  if (opts.all && g.other.length) {
    lines.push('### Other changes', '');
    for (const o of g.other) lines.push(`- ${o.message.split('\n')[0]} (${o.hash.slice(0, 7)})`);
    lines.push('');
  }
  if (lines.length === 2) lines.push('_No user-facing changes._', '');
  return lines.join('\n').trimEnd() + '\n';
}

/** Insert a new release section at the top of an existing CHANGELOG.md. */
export function prepend(existing: string, section: string): string {
  const head = '# Changelog\n\n';
  const body = existing.replace(/^# Changelog\s*\n+/, '');
  return head + section + (body.trim() ? `\n${body.trimStart()}` : '');
}
