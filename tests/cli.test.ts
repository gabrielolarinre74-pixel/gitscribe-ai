import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { install, uninstall, hookScript } from '../src/commands/hook.js';
import { tempRepo } from './helpers.js';

const root = path.resolve(__dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscribe-cli-'));

function cli(cwd: string, args: string[], input?: string) {
  const r = spawnSync(tsx, [path.join(root, 'src', 'cli.ts'), ...args], {
    cwd, input, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', GITSCRIBE_CONFIG: path.join(cfgDir, 'config') },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('gitscribe CLI', () => {
  const repo = tempRepo();
  beforeAll(() => {
    repo.write('src/cart/total.js', 'export function total(items) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n');
    repo.run(['add', '.']);
    repo.run(['commit', '-qm', 'feat(cart): add cart total']);
    repo.run(['tag', 'v1.0.0']);
  });
  afterAll(() => { repo.cleanup(); fs.rmSync(cfgDir, { recursive: true, force: true }); });

  it('explains when nothing is staged', () => {
    const r = cli(repo.dir, ['--dry-run']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Nothing is staged');
  });

  it('prints the best message for scripts', () => {
    repo.write('src/cart/total.js', 'export function total(items) {\n  if (!items?.length) return 0;\n  return items.reduce((s, i) => s + i.price, 0);\n}\n');
    repo.run(['add', '.']);
    const r = cli(repo.dir, ['--print']);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('fix(cart): handle missing values in total');
  });

  it('commits with --yes', () => {
    const r = cli(repo.dir, ['--yes']);
    expect(r.code).toBe(0);
    expect(repo.run(['log', '-1', '--format=%s']).stdout.trim()).toBe('fix(cart): handle missing values in total');
  });

  it('blocks a commit that contains a secret', () => {
    repo.write('src/cart/pay.js', `export const key = "${['sk', '_live_', 'Zq8Lm2Xv9Rk4Pw7Nt3Yb6Hc1'].join('')}";\n`);
    repo.run(['add', '.']);
    const r = cli(repo.dir, ['--yes']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Stripe secret key');
    expect(r.out).toContain('src/cart/pay.js:1');
    expect(cli(repo.dir, ['scan']).code).toBe(1);
    expect(JSON.parse(cli(repo.dir, ['scan', '--json']).out).findings).toHaveLength(1);
    repo.run(['reset', '-q', 'src/cart/pay.js']);
    fs.rmSync(path.join(repo.dir, 'src/cart/pay.js'));
    expect(cli(repo.dir, ['scan']).code).toBe(0);
  });

  it('lints messages from arguments and stdin', () => {
    expect(cli(repo.dir, ['lint', 'feat: add coupon codes']).code).toBe(0);
    const bad = cli(repo.dir, ['lint', 'Added coupons.']);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('type(scope): subject');
    expect(cli(repo.dir, ['lint'], 'fix: Handle rounding').code).toBe(0);
    expect(cli(repo.dir, ['lint', '--strict'], 'fix: Handle rounding').code).toBe(1);
  });

  it('writes a changelog since the last tag', () => {
    const r = cli(repo.dir, ['changelog']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^## v1\.0\.1 \(\d{4}-\d{2}-\d{2}\)/);
    expect(r.out).toContain('### Bug fixes\n\n- **cart:** handle missing values in total');
    expect(cli(repo.dir, ['changelog', '--write']).code).toBe(0);
    expect(fs.readFileSync(path.join(repo.dir, 'CHANGELOG.md'), 'utf8')).toMatch(/^# Changelog\n\n## v1\.0\.1/);
  });

  it('saves and shows config without leaking the key', () => {
    expect(cli(repo.dir, ['config', 'set', 'api-key=abcdef123456', 'max-length=64']).code).toBe(0);
    expect(cli(repo.dir, ['config', 'get', 'api-key']).out.trim()).toBe('abc…3456');
    expect(cli(repo.dir, ['config', 'set', 'engine=gpt']).code).toBe(1);
  });
});

describe('hooks', () => {
  it('installs, refuses to overwrite foreign hooks and uninstalls', () => {
    const repo = tempRepo();
    const hooks = path.join(repo.dir, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nnpm test\n');
    const r = install(['prepare-commit-msg', 'commit-msg', 'pre-commit'], repo.dir);
    expect(r).toEqual({ installed: ['prepare-commit-msg', 'commit-msg'], skipped: ['pre-commit'] });
    expect(fs.readFileSync(path.join(hooks, 'commit-msg'), 'utf8')).toContain('_hook commit-msg "$@"');
    expect(uninstall(['prepare-commit-msg', 'commit-msg', 'pre-commit'], repo.dir)).toEqual(['prepare-commit-msg', 'commit-msg']);
    expect(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8')).toBe('#!/bin/sh\nnpm test\n');
    repo.cleanup();
  });

  it('writes a POSIX script that falls back to gitscribe on PATH', () => {
    const s = hookScript('pre-commit', '/usr/bin/node', '/opt/gitscribe/dist/cli.mjs');
    expect(s.split('\n')[0]).toBe('#!/bin/sh');
    expect(s).toContain('exec "/usr/bin/node" "$CLI" _hook pre-commit "$@"');
    expect(s).toContain('exec gitscribe _hook pre-commit "$@"');
  });
});
