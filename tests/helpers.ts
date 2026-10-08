import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDiff } from '../src/core/diff.js';

export const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
export const parsedFixture = (name: string) => parseDiff(fixture(name));

/** Build a minimal unified diff for one file. */
export function diffOf(file: string, removed: string[], added: string[], opts: { status?: 'added' | 'deleted'; context?: string } = {}): string {
  const head = [`diff --git a/${file} b/${file}`];
  if (opts.status === 'added') head.push('new file mode 100644', '--- /dev/null', `+++ b/${file}`);
  else if (opts.status === 'deleted') head.push('deleted file mode 100644', `--- a/${file}`, '+++ /dev/null');
  else head.push(`--- a/${file}`, `+++ b/${file}`);
  head.push(`@@ -1,${removed.length} +1,${added.length} @@${opts.context ? ' ' + opts.context : ''}`);
  return [...head, ...removed.map((l) => '-' + l), ...added.map((l) => '+' + l)].join('\n') + '\n';
}

export function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscribe-'));
  const run = (args: string[], input?: string) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', input });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'commit.gpgsign', 'false']);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  return { dir, run, write, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
