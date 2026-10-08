import * as p from '@clack/prompts';
import { parseDiff, stats, type DiffFile } from '../core/diff.js';
import { suggest, summary, type Suggestion } from '../core/offline.js';
import { suggestWithAI } from '../core/ai.js';
import { scanDiff } from '../core/secrets.js';
import { format, lint, parse, isType, type CommitType, TYPES } from '../core/message.js';
import { load, type Config } from '../core/config.js';
import { kindOf } from '../core/classify.js';
import { repoRoot, stagedDiff, stageTracked, commit } from '../git.js';
import * as ui from '../ui.js';

export interface CommitFlags {
  all?: boolean;
  generate?: number;
  type?: string;
  scope?: string;
  offline?: boolean;
  ai?: boolean;
  yes?: boolean;
  print?: boolean;
  dryRun?: boolean;
  noScan?: boolean;
  noBody?: boolean;
  noVerify?: boolean;
  instructions?: string;
}

export class UserError extends Error {}

/** Shared by the CLI and the prepare-commit-msg hook. */
export async function generate(files: DiffFile[], diff: string, cfg: Config, flags: CommitFlags): Promise<Suggestion[]> {
  const type = flags.type ? (isType(flags.type) ? (flags.type as CommitType) : (() => { throw new UserError(`Unknown type "${flags.type}". Use one of: ${Object.keys(TYPES).join(', ')}.`); })()) : undefined;
  const useAI = flags.ai || (cfg.engine === 'ai' && !flags.offline);
  const body = cfg.body && !flags.noBody;
  let out: Suggestion[];
  if (useAI) {
    const depsPaths = files.filter((f) => kindOf(f.path) === 'deps').map((f) => f.path);
    const sections = diff.split(/(?=^diff --git )/m);
    const kept = sections.filter((part) => !depsPaths.some((path) => part.startsWith(`diff --git a/${path} `)));
    const promptDiff = kept.join('') || diff;
    out = await suggestWithAI(cfg, { diff: promptDiff, files, count: Math.min(Math.max(flags.generate ?? 3, 1), 5), maxLength: cfg['max-length'], type, instructions: flags.instructions ?? cfg.instructions, body });
  } else {
    out = suggest(files, { maxLength: cfg['max-length'], type, scope: flags.scope === 'none' ? false : flags.scope });
    if (flags.generate) out = out.slice(0, Math.max(1, flags.generate));
  }
  if (flags.scope && useAI) out = out.map((s) => ({ ...s, scope: flags.scope === 'none' ? undefined : flags.scope }));
  if (!body) out = out.map((s) => ({ ...s, body: undefined }));
  return out;
}

export async function runCommit(flags: CommitFlags, gitArgs: string[] = []): Promise<number> {
  repoRoot();
  const cfg = load();
  if (flags.all) stageTracked();
  const diff = stagedDiff();
  const files = parseDiff(diff);
  if (!files.length) throw new UserError('Nothing is staged. Stage files with "git add", or pass --all to include every tracked change.');

  const interactive = process.stdout.isTTY && process.stdin.isTTY && !flags.yes && !flags.print && !flags.dryRun;
  const out = flags.print ? process.stderr : process.stdout;
  const say = (s = '') => out.write(s + '\n');

  if (!flags.print) {
    say(`\n${ui.brand()}  ${ui.dim(`${summary(files)} staged`)}\n`);
    const shown = files.slice(0, 12);
    const width = Math.max(...shown.map((f) => (f.status === 'renamed' ? f.oldPath.length + 3 : 0) + f.path.length));
    for (const f of shown) say(`  ${ui.fileLine(f, width)}`);
    if (files.length > 12) say(ui.dim(`  … and ${files.length - 12} more`));
    say();
  }

  // 1. Secrets
  if (!flags.noScan) {
    const findings = scanDiff(files);
    if (findings.length) {
      const blocking = cfg['block-secrets'];
      say(blocking ? ui.fail(ui.bold(`Possible secret${findings.length > 1 ? 's' : ''} in the staged changes`)) : ui.warn(ui.bold('Possible secrets in the staged changes')));
      for (const f of findings) say(`  ${ui.findingLine(f)}`);
      say(ui.dim('\n  Unstage or remove them, mark a known test value with a "gitscribe:allow" comment,\n  or re-run with --no-scan if you are sure.\n'));
      if (blocking) return 1;
    } else if (!flags.print) {
      say(ui.ok(`No secrets found in ${stats(files).insertions} added lines`));
    }
  }

  // 2. Generate
  const useAI = flags.ai || (cfg.engine === 'ai' && !flags.offline);
  let spin: ReturnType<typeof p.spinner> | undefined;
  if (interactive) { spin = p.spinner(); spin.start(useAI ? `Asking ${cfg.model}` : 'Reading the diff'); }
  let suggestions: Suggestion[];
  try {
    suggestions = await generate(files, diff, cfg, flags);
  } catch (e) {
    spin?.error('Could not generate a message');
    throw e;
  }
  spin?.stop(`${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} ${ui.dim(useAI ? `from ${cfg.model}` : 'from the offline engine')}`);
  if (!suggestions.length) throw new UserError('Could not write a message for these changes.');

  if (flags.print) {
    process.stdout.write(format(suggestions[0]!) + '\n');
    return 0;
  }

  if (!interactive) {
    say(ui.bold(`Suggestions ${ui.dim(useAI ? `(${cfg.model})` : '(offline engine)')}`));
    suggestions.forEach((s, i) => {
      say(`\n  ${ui.yellow(String(i + 1))}  ${ui.headerLine(s)}`);
      say(`     ${ui.dim(s.reason)}`);
      if (i === 0 && s.body) for (const l of s.body.split('\n')) say(`     ${ui.dim(l)}`);
      if (i === 0) for (const f of s.footers) say(`     ${ui.red(f)}`);
    });
    say();
    if (!flags.yes || flags.dryRun) {
      if (flags.dryRun) say(ui.dim('Dry run: nothing was committed.'));
      return 0;
    }
  }

  // 3. Pick
  let message: string;
  if (interactive) {
    const choice = await p.select({
      message: 'Pick a commit message',
      options: [
        ...suggestions.map((s, i) => ({ value: String(i), label: ui.headerLine(s), hint: s.reason })),
        { value: 'edit', label: 'Write my own, starting from the first one' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    if (p.isCancel(choice) || choice === 'cancel') { p.cancel('Nothing was committed.'); return 1; }
    const picked = choice === 'edit' ? suggestions[0]! : suggestions[Number(choice)]!;
    message = format(picked);
    if (choice === 'edit') {
      const edited = await p.text({ message: 'Header', initialValue: message.split('\n')[0], validate: (v) => (v && v.trim() ? undefined : 'Enter a message') });
      if (p.isCancel(edited)) { p.cancel('Nothing was committed.'); return 1; }
      message = [edited.trim(), ...message.split('\n').slice(1)].join('\n');
    }
    const issues = lint(message, cfg['max-length']);
    if (issues.length) {
      p.log.warn(issues.map(ui.issueLine).join('\n'));
    }
    if (picked.body) p.note(picked.body + (picked.footers.length ? `\n\n${picked.footers.join('\n')}` : ''), 'Body');
    const go = await p.confirm({ message: 'Commit with this message?', initialValue: true });
    if (p.isCancel(go) || !go) { p.cancel('Nothing was committed.'); return 1; }
  } else {
    message = format(suggestions[0]!);
  }

  const extra = [...gitArgs];
  if (flags.noVerify) extra.push('--no-verify');
  const result = commit(message, extra);
  const first = result.split('\n')[0] ?? '';
  const parsed = parse(message);
  if (interactive) p.outro(ui.ok(`Committed ${parsed ? ui.headerLine(parsed) : message.split('\n')[0]}  ${ui.dim(first.match(/\[[^\]]+\]/)?.[0] ?? '')}`));
  else say(ui.ok(`Committed: ${message.split('\n')[0]}`));
  return 0;
}
