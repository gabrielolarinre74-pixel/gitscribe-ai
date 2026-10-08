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

export function fileLine(f: DiffFile, width = 0): string {
  const status = { added: green('A'), deleted: red('D'), modified: yellow('M'), renamed: cyan('R') }[f.status];
  const plain = f.status === 'renamed' ? `${f.oldPath} → ${f.path}` : f.path;
  const name = f.status === 'renamed' ? `${dim(f.oldPath + ' → ')}${f.path}` : f.path;
  const pad = ' '.repeat(Math.max(0, width - plain.length));
  const counts = f.binary ? dim('binary'.padEnd(9)) : `${green(('+' + f.added.length).padStart(4))} ${red(('-' + f.removed.length).padStart(4))}`;
  return `${status}  ${name}${pad}  ${counts}  ${dim(kindOf(f.path))}`;
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
