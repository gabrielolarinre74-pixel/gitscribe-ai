import { cli, command } from 'cleye';
import pkg from '../package.json' with { type: 'json' };
import { runCommit, UserError } from './commands/commit.js';
import { runScan } from './commands/scan.js';
import { runChangelog } from './commands/changelog.js';
import { runLint } from './commands/lint.js';
import { runHookCommand, runHook } from './commands/hook.js';
import { runConfig } from './commands/config.js';
import { GitError } from './git.js';
import { ConfigError } from './core/config.js';
import * as ui from './ui.js';

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const done = (code: number | Promise<number>) =>
  Promise.resolve(code).then((c) => process.exit(c), (e: unknown) => {
    const err = e as Error;
    const known = err instanceof UserError || err instanceof GitError || err instanceof ConfigError;
    console.error(ui.fail(err.message));
    if (!known && process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });

const scan = command({
  name: 'scan',
  help: { description: 'Scan staged changes (or a commit range) for keys, tokens and credential files' },
  flags: {
    range: { type: String, description: 'Scan every commit in a range instead, e.g. main..HEAD' },
    json: { type: Boolean, description: 'Print findings as JSON' },
  },
}, (argv) => done(runScan(argv.flags)));

const changelog = command({
  name: 'changelog',
  help: { description: 'Write release notes from Conventional Commits since the last tag' },
  flags: {
    from: { type: String, description: 'Start after this tag or commit (default: latest tag)' },
    to: { type: String, description: 'End at this ref (default: HEAD)' },
    release: { type: String, description: 'Version title for the section (default: next semver from the commits)' },
    write: { type: Boolean, description: 'Prepend the section to CHANGELOG.md instead of printing it' },
    all: { type: Boolean, description: 'Include docs, tests, chores and non-conventional commits' },
    json: { type: Boolean, description: 'Print the parsed commits and bump as JSON' },
  },
}, (argv) => done(runChangelog(argv.flags)));

const lintCmd = command({
  name: 'lint',
  parameters: ['[message or file]'],
  help: { description: 'Check a commit message against Conventional Commits (reads stdin when piped)' },
  flags: { strict: { type: Boolean, description: 'Fail on warnings too' } },
}, (argv) => done(runLint(argv._.messageOrFile, argv.flags)));

const hook = command({
  name: 'hook',
  parameters: ['<install|uninstall>'],
  help: { description: 'Install Git hooks: message (prepare-commit-msg), lint (commit-msg) and scan (pre-commit)' },
  flags: { only: { type: String, description: 'Comma-separated subset: message, lint, scan' } },
}, (argv) => done(runHookCommand(argv._.installUninstall, argv.flags.only)));

const config = command({
  name: 'config',
  parameters: ['[list|get|set|unset|path]', '[pairs...]'],
  help: { description: 'Show or change settings in ~/.gitscribe' },
}, (argv) => done(runConfig(argv._.listGetSetUnsetPath, argv._.pairs)));

// Git hooks call `gitscribe _hook <name> ...args`; handled before normal parsing so it stays out of --help.
const raw = process.argv.slice(2);
const argv = raw[0] === '_hook' ? null : cli({
  name: 'gitscribe',
  version: pkg.version,
  help: { description: pkg.description, usage: ['gitscribe [flags] [-- git commit flags]', 'gitscribe <command> [flags]'] },
  flags: {
    all: { type: Boolean, alias: 'a', description: 'Stage every tracked change first (git add --update)' },
    generate: { type: Number, alias: 'g', description: 'How many suggestions to show (default 3)' },
    type: { type: String, alias: 't', description: 'Force a commit type, e.g. fix' },
    scope: { type: String, alias: 's', description: 'Force a scope, or "none" to leave it out' },
    offline: { type: Boolean, description: 'Use the offline engine even when AI is configured' },
    ai: { type: Boolean, description: 'Use the AI engine for this run' },
    yes: { type: Boolean, alias: 'y', description: 'Commit with the first suggestion without asking' },
    print: { type: Boolean, alias: 'p', description: 'Print the best message to stdout and exit (for scripts)' },
    dryRun: { type: Boolean, description: 'Show suggestions without committing' },
    noScan: { type: Boolean, description: 'Skip the secret scan' },
    noBody: { type: Boolean, description: 'Header only, no body' },
    noVerify: { type: Boolean, alias: 'n', description: 'Pass --no-verify to git commit' },
    instructions: { type: String, alias: 'i', description: 'Extra guidance for the AI engine' },
  },
  commands: [scan, changelog, lintCmd, hook, config],
});

if (raw[0] === '_hook') {
  done(runHook(raw[1] ?? '', raw.slice(2)));
} else if (argv && !argv.command) {
  const gitArgs = (argv._ as unknown as { '--'?: string[] })['--'] ?? [];
  done(runCommit(argv.flags, gitArgs));
}
