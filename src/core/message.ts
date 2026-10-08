/** Conventional Commits: build, parse and lint messages. https://www.conventionalcommits.org */

export const TYPES = {
  feat: 'A new feature',
  fix: 'A bug fix',
  docs: 'Documentation only',
  style: 'Formatting, whitespace, no logic change',
  refactor: 'Code change that neither fixes a bug nor adds a feature',
  perf: 'Performance improvement',
  test: 'Adding or fixing tests',
  build: 'Build system or dependencies',
  ci: 'CI configuration',
  chore: 'Maintenance that does not touch src or tests',
  revert: 'Reverts a previous commit',
} as const;

export type CommitType = keyof typeof TYPES;
export const isType = (t: string): t is CommitType => t in TYPES;

export interface Commit {
  type: CommitType;
  scope?: string;
  breaking: boolean;
  subject: string;
  body?: string;
  /** Footer lines, e.g. `BREAKING CHANGE: ...` or `Refs: #12`. */
  footers: string[];
}

export function header(c: Pick<Commit, 'type' | 'scope' | 'breaking' | 'subject'>): string {
  return `${c.type}${c.scope ? `(${c.scope})` : ''}${c.breaking ? '!' : ''}: ${c.subject}`;
}

export function format(c: Commit): string {
  const parts = [header(c)];
  if (c.body?.trim()) parts.push(c.body.trim());
  if (c.footers.length) parts.push(c.footers.join('\n'));
  return parts.join('\n\n');
}

const HEADER_RE = /^(\w+)(?:\(([^()\r\n]+)\))?(!)?: (.+)$/;

export function parse(message: string): Commit | null {
  const lines = message.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'));
  const m = HEADER_RE.exec(lines[0]?.trim() ?? '');
  if (!m || !isType(m[1]!.toLowerCase())) return null;
  const rest = lines.slice(1).join('\n').trim();
  const blocks = rest ? rest.split(/\n{2,}/) : [];
  const footerRe = /^(BREAKING[ -]CHANGE|[\w-]+)(: | #)/;
  const last = blocks.at(-1);
  let footers: string[] = [];
  if (last && last.split('\n').every((l) => footerRe.test(l))) {
    blocks.pop();
    footers = last.split('\n');
  }
  return {
    type: m[1]!.toLowerCase() as CommitType,
    scope: m[2],
    breaking: !!m[3] || footers.some((f) => /^BREAKING[ -]CHANGE: /.test(f)),
    subject: m[4]!.trim(),
    body: blocks.join('\n\n') || undefined,
    footers,
  };
}

export interface LintIssue {
  level: 'error' | 'warning';
  rule: string;
  message: string;
}

const PAST_TENSE = /^(added|fixed|updated|removed|changed|improved|refactored|created|deleted|implemented|renamed|moved|bumped|cleaned|merged)\b/i;
const THIRD_PERSON = /^(adds|fixes|updates|removes|changes|improves|refactors|creates|deletes|implements|renames|moves|bumps|cleans)\b/i;
const VAGUE = /^(update|fix|change|wip|stuff|misc|changes|updates|fixes|minor|tweaks?)\.?$/i;

export function lint(message: string, maxHeader = 72): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = message.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'));
  const first = lines[0]?.trim() ?? '';
  if (!first) return [{ level: 'error', rule: 'empty', message: 'The message is empty.' }];

  if (/^(Merge|Revert ")/.test(first)) return issues;

  const m = HEADER_RE.exec(first);
  if (!m) {
    issues.push({ level: 'error', rule: 'format', message: 'Header should look like "type(scope): subject", e.g. "fix(auth): handle expired tokens".' });
    const word = first.split(/\s+/)[0]!;
    if (PAST_TENSE.test(first) || THIRD_PERSON.test(first)) issues.push({ level: 'warning', rule: 'imperative', message: `Use the imperative mood: "${imperative(word)}" rather than "${word}".` });
    if (/\.$/.test(first)) issues.push({ level: 'warning', rule: 'period', message: 'Drop the full stop at the end of the subject.' });
  } else {
    const [, type, scope, , subject] = m as unknown as [string, string, string | undefined, string | undefined, string];
    if (!isType(type.toLowerCase())) issues.push({ level: 'error', rule: 'type', message: `"${type}" is not a conventional type. Use one of: ${Object.keys(TYPES).join(', ')}.` });
    else if (type !== type.toLowerCase()) issues.push({ level: 'warning', rule: 'type-case', message: 'Write the type in lower case.' });
    if (scope !== undefined && !/^[a-z0-9][a-z0-9._/-]*$/.test(scope)) issues.push({ level: 'warning', rule: 'scope', message: 'Keep the scope short and lower-case, like "api" or "ui".' });
    if (/\.$/.test(subject)) issues.push({ level: 'warning', rule: 'period', message: 'Drop the full stop at the end of the subject.' });
    if (/^[A-Z][a-z]/.test(subject)) issues.push({ level: 'warning', rule: 'subject-case', message: 'Start the subject in lower case.' });
    if (PAST_TENSE.test(subject) || THIRD_PERSON.test(subject)) issues.push({ level: 'warning', rule: 'imperative', message: `Use the imperative mood: "${imperative(subject.split(' ')[0]!)}" rather than "${subject.split(' ')[0]}".` });
    if (VAGUE.test(subject.trim())) issues.push({ level: 'error', rule: 'vague', message: 'The subject does not say what changed.' });
    if (subject.trim().length < 8 && !VAGUE.test(subject.trim())) issues.push({ level: 'warning', rule: 'short', message: 'The subject is very short. Say what changed and where.' });
  }
  if (first.length > maxHeader) issues.push({ level: 'error', rule: 'length', message: `Header is ${first.length} characters; keep it at ${maxHeader} or fewer.` });
  if (lines.length > 1 && lines[1]!.trim() !== '') issues.push({ level: 'error', rule: 'blank-line', message: 'Leave a blank line between the header and the body.' });
  const long = lines.slice(2).filter((l) => l.length > 100 && !/https?:\/\//.test(l)).length;
  if (long) issues.push({ level: 'warning', rule: 'body-wrap', message: `${long} body line${long > 1 ? 's are' : ' is'} longer than 100 characters.` });
  return issues;
}

const IRREGULAR: Record<string, string> = { added: 'add', fixed: 'fix', removed: 'remove', changed: 'change', moved: 'move', created: 'create', deleted: 'delete', renamed: 'rename', updated: 'update', improved: 'improve', merged: 'merge', fixes: 'fix' };

export function imperative(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/ied$/.test(w)) return w.replace(/ied$/, 'y');
  if (/(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (/ed$/.test(w)) return w.replace(/ed$/, '');
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
