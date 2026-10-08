import { bgYellow, black, bold, dim, green, red, yellow, cyan, gray, magenta, blue, lightYellow } from 'kolorist';
import type { CommitType, LintIssue } from './core/message.js';
import type { Suggestion } from './core/offline.js';
import type { Finding } from './core/secrets.js';
import { kindOf } from './core/classify.js';
import type { DiffFile } from './core/diff.js';

export const brand = () => bgYellow(black(bold(' gitscribe ')));

const TYPE_COLOR: Record<CommitType, (s: string) => string> = {
  feat: green, fix: red, docs: blue, style: magenta, refactor: cyan, perf: lightYellow, test: yellow,
  build: gray, ci: gray, chore: gray, revert: red,
};

export function headerLine(s: Pick<Suggestion, 'type' | 'scope' | 'breaking' | 'subject'>): string {
  const color = TYPE_COLOR[s.type];
  return `${bold(color(s.type))}${s.scope ? dim('(') + s.scope + dim(')') : ''}${s.breaking ? red(bold('!')) : ''}${dim(':')} ${bold(s.subject)}`;
}

export function fileLine(f: DiffFile): string {
  const status = { added: green('A'), deleted: red('D'), modified: yellow('M'), renamed: cyan('R') }[f.status];
  const name = f.status === 'renamed' ? `${dim(f.oldPath + ' → ')}${f.path}` : f.path;
  const counts = f.binary ? dim('binary') : `${green('+' + f.added.length)} ${red('-' + f.removed.length)}`;
  return `${status}  ${name}  ${counts}  ${dim(kindOf(f.path))}`;
}

export function findingLine(f: Finding): string {
  const sev = f.severity === 'high' ? red(bold('HIGH  ')) : yellow(bold('MEDIUM'));
  const where = f.line ? `${f.file}${dim(':' + f.line)}` : f.file;
  return `${sev} ${bold(f.name)}  ${where}  ${dim(f.preview)}`;
}

export function issueLine(i: LintIssue): string {
  return `${i.level === 'error' ? red('✖') : yellow('▲')} ${i.message} ${dim(i.rule)}`;
}

export const ok = (s: string) => `${green('✔')} ${s}`;
export const fail = (s: string) => `${red('✖')} ${s}`;
export const warn = (s: string) => `${yellow('▲')} ${s}`;
export { bold, dim, yellow, green, red, gray };
