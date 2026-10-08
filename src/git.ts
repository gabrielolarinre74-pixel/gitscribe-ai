import { spawnSync } from 'node:child_process';

export class GitError extends Error {}

export function git(args: string[], opts: { input?: string; cwd?: string; allowFail?: boolean } = {}): string {
  const r = spawnSync('git', args, { cwd: opts.cwd, input: opts.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new GitError('Git is not installed or not on your PATH.');
  if (r.status !== 0) {
    if (opts.allowFail) return '';
    throw new GitError(r.stderr.trim() || `git ${args[0]} failed`);
  }
  return r.stdout;
}

export function repoRoot(cwd?: string): string {
  const out = git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true }).trim();
  if (!out) throw new GitError('This folder is not inside a Git repository.');
  return out;
}

export const stagedDiff = (cwd?: string) => git(['diff', '--cached', '--no-color', '--no-ext-diff', '-M', '--diff-algorithm=minimal', '--unified=3'], { cwd });

export const stageTracked = (cwd?: string) => void git(['add', '--update'], { cwd });

export const commit = (message: string, extra: string[] = [], cwd?: string) => git(['commit', '-F', '-', ...extra], { input: message, cwd });

export const hooksDir = (cwd?: string) => git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { cwd }).trim();

export const latestTag = (cwd?: string) => git(['describe', '--tags', '--abbrev=0'], { cwd, allowFail: true }).trim() || undefined;

export function log(range: string, format: string, cwd?: string): string {
  return git(['log', '--no-color', `--format=${format}`, range], { cwd });
}

export const diffForRange = (range: string, cwd?: string) => git(['log', '-p', '--no-color', '--format=commit %H', range], { cwd });

/** https URL for the origin remote, used to link commits in changelogs. */
export function remoteUrl(cwd?: string): string | undefined {
  const raw = git(['remote', 'get-url', 'origin'], { cwd, allowFail: true }).trim();
  if (!raw) return undefined;
  const ssh = /^git@([^:]+):(.+?)(\.git)?$/.exec(raw);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.toString().replace(/\.git$/, '').replace(/\/$/, '');
  } catch { return undefined; }
}
