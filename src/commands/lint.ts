import fs from 'node:fs';
import { lint } from '../core/message.js';
import { load } from '../core/config.js';
import * as ui from '../ui.js';

/** Lint a message given as text or as a file path (e.g. .git/COMMIT_EDITMSG). */
export function runLint(input: string | undefined, flags: { strict?: boolean }): number {
  let message = input ?? '';
  if (input && fs.existsSync(input) && fs.statSync(input).isFile()) message = fs.readFileSync(input, 'utf8');
  else if (!input && !process.stdin.isTTY) message = fs.readFileSync(0, 'utf8');
  const issues = lint(message, load()['max-length']);
  const first = message.split('\n')[0] ?? '';
  if (!issues.length) {
    console.log(ui.ok(`${ui.bold(first)} follows Conventional Commits`));
    return 0;
  }
  console.log(`${ui.bold(first || '(empty message)')}`);
  for (const i of issues) console.log(`  ${ui.issueLine(i)}`);
  const errors = issues.filter((i) => i.level === 'error').length;
  return errors || (flags.strict && issues.length) ? 1 : 0;
}
