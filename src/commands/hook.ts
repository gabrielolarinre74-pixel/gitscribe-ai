import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooksDir, repoRoot, stagedDiff } from '../git.js';
import { parseDiff } from '../core/diff.js';
import { format, lint } from '../core/message.js';
import { load } from '../core/config.js';
import { generate } from './commit.js';
import { runScan } from './scan.js';
import * as ui from '../ui.js';

export const HOOKS = {
  'prepare-commit-msg': 'Fill in a message when you run "git commit" without -m',
  'commit-msg': 'Reject messages that break Conventional Commits',
  'pre-commit': 'Block commits that contain secrets',
} as const;
export type HookName = keyof typeof HOOKS;

const MARKER = '# managed by gitscribe';

export function hookScript(name: HookName, node = process.execPath, cli = fileURLToPath(import.meta.url)): string {
  return [
    '#!/bin/sh',
    MARKER,
    `CLI=${JSON.stringify(cli)}`,
    `if [ -f "$CLI" ]; then exec ${JSON.stringify(node)} "$CLI" _hook ${name} "$@"; fi`,
    `if command -v gitscribe >/dev/null 2>&1; then exec gitscribe _hook ${name} "$@"; fi`,
    'exit 0',
    '',
  ].join('\n');
}

export function parseHookList(only?: string): HookName[] {
  if (!only) return Object.keys(HOOKS) as HookName[];
  const map: Record<string, HookName> = { message: 'prepare-commit-msg', lint: 'commit-msg', scan: 'pre-commit' };
  return only.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const name = map[s] ?? (s in HOOKS ? (s as HookName) : undefined);
    if (!name) throw new Error(`Unknown hook "${s}". Use message, lint or scan.`);
    return name;
  });
}

export function install(names: HookName[], cwd?: string): { installed: HookName[]; skipped: HookName[] } {
  repoRoot(cwd);
  const dir = hooksDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const installed: HookName[] = [];
  const skipped: HookName[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARKER)) { skipped.push(name); continue; }
    fs.writeFileSync(file, hookScript(name), { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    installed.push(name);
  }
  return { installed, skipped };
}

export function uninstall(names: HookName[], cwd?: string): HookName[] {
  repoRoot(cwd);
  const dir = hooksDir(cwd);
  const removed: HookName[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(MARKER)) { fs.rmSync(file); removed.push(name); }
  }
  return removed;
}

export function runHookCommand(mode: string, only?: string): number {
  const names = parseHookList(only);
  if (mode === 'install') {
    const { installed, skipped } = install(names);
    for (const n of installed) console.log(ui.ok(`${ui.bold(n)}  ${ui.dim(HOOKS[n])}`));
    for (const n of skipped) console.log(ui.warn(`${ui.bold(n)} already exists and was not written by gitscribe, left as is`));
    return skipped.length && !installed.length ? 1 : 0;
  }
  if (mode === 'uninstall') {
    const removed = uninstall(names);
    if (!removed.length) console.log(ui.dim('No gitscribe hooks were installed.'));
    for (const n of removed) console.log(ui.ok(`Removed ${n}`));
    return 0;
  }
  throw new Error(`Use "gitscribe hook install" or "gitscribe hook uninstall".`);
}

/** Entry point when Git runs one of the installed hooks. Never blocks a commit by crashing. */
export async function runHook(name: string, args: string[]): Promise<number> {
  try {
    if (name === 'pre-commit') {
      if (!load()['block-secrets']) return 0;
      return runScan({ quiet: true });
    }
    if (name === 'commit-msg') {
      const file = args[0];
      if (!file) return 0;
      const message = fs.readFileSync(file, 'utf8');
      if (/^(fixup!|squash!|amend!|Merge |Revert ")/.test(message)) return 0;
      const issues = lint(message, load()['max-length']);
      const errors = issues.filter((i) => i.level === 'error');
      if (!errors.length) return 0;
      console.error(`${ui.brand()}  ${ui.dim('commit message rejected')}`);
      for (const i of issues) console.error(`  ${ui.issueLine(i)}`);
      console.error(ui.dim('  Fix the message, or commit with --no-verify to skip this check.'));
      return 1;
    }
    if (name === 'prepare-commit-msg') {
      const [file, source] = args;
      if (!file || source) return 0; // -m, -F, merges, squashes and amends keep their own message
      const diff = stagedDiff();
      const files = parseDiff(diff);
      if (!files.length) return 0;
      const [best] = await generate(files, diff, load(), {});
      if (!best) return 0;
      const existing = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, `${format(best)}\n${existing.startsWith('\n') ? '' : '\n'}${existing}`);
      return 0;
    }
  } catch (e) {
    if (name === 'prepare-commit-msg') return 0;
    console.error(ui.warn(`gitscribe ${name}: ${(e as Error).message}`));
    return name === 'pre-commit' ? 0 : 1;
  }
  return 0;
}
