import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coerce, load, save, redact, ConfigError, DEFAULTS } from '../src/core/config.js';
import { buildPrompt, parseReply, assertReady } from '../src/core/ai.js';
import { parseDiff } from '../src/core/diff.js';
import { fixture } from './helpers.js';

describe('config', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitscribe-cfg-'));
    process.env.GITSCRIBE_CONFIG = path.join(dir, 'config');
  });
  afterEach(() => {
    delete process.env.GITSCRIBE_CONFIG;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts from defaults', () => {
    expect(load({})).toEqual(DEFAULTS);
  });

  it('saves, reloads and lets env win', () => {
    save({ engine: 'ai', model: 'llama3.1', 'max-length': '60' });
    expect(load({})).toMatchObject({ engine: 'ai', model: 'llama3.1', 'max-length': 60 });
    expect(load({ GITSCRIBE_MODEL: 'gpt-4o' }).model).toBe('gpt-4o');
    expect((fs.statSync(process.env.GITSCRIBE_CONFIG!).mode & 0o777).toString(8)).toBe('600');
    save({ model: '' });
    expect(load({}).model).toBe(DEFAULTS.model);
  });

  it('validates values', () => {
    expect(() => coerce('engine', 'gpt')).toThrow(ConfigError);
    expect(() => coerce('max-length', '10')).toThrow(/between 30 and 200/);
    expect(() => coerce('base-url', 'http://api.example.com/v1')).toThrow(/https/);
    expect(coerce('base-url', 'http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
    expect(coerce('body', 'off')).toBe(false);
    expect(() => save({ colour: 'blue' } as never)).toThrow(/Unknown setting/);
  });

  it('never prints the full key', () => {
    expect(redact({ ...DEFAULTS, 'api-key': 'abc123456789xyz' })['api-key']).toBe('abc…9xyz');
    expect(redact(DEFAULTS)['api-key']).toBe('(not set)');
  });
});

describe('AI engine', () => {
  const diff = fixture('new-feature.diff');
  const files = parseDiff(diff);

  it('builds a prompt with limits, scope hint and house style', () => {
    const { system, user } = buildPrompt({ diff, files, count: 3, maxLength: 60, body: true, instructions: 'Write in British English' });
    expect(system).toContain('at most 60 characters');
    expect(system).toContain('exactly 3 distinct options');
    expect(system).toContain('House style from the user: Write in British English');
    expect(user).toContain('diff --git a/src/app.js');
  });

  it('cleans up model replies', () => {
    const reply = 'Sure! ```json\n{"messages":[{"type":"Feat","scope":"API","subject":"feat(api): Add factorial endpoint.","body":"- add route"},{"type":"feat","scope":"api","subject":"add factorial endpoint"},{"type":"oops","subject":"remove the old v1 handler that nobody uses anymore at all today","breaking":true,"breaking_note":"v1 is gone"}]}\n```';
    const out = parseReply(reply, 50);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: 'feat', scope: 'api', subject: 'add factorial endpoint', body: '- add route' });
    expect(out[1]!.type).toBe('chore');
    expect(out[1]!.breaking).toBe(true);
    expect(out[1]!.footers).toEqual(['BREAKING CHANGE: v1 is gone']);
    expect(`chore!: ${out[1]!.subject}`.length).toBeLessThanOrEqual(50);
  });

  it('forces a type when asked and rejects junk', () => {
    expect(parseReply('{"messages":[{"type":"feat","subject":"add things"}]}', 72, 'fix')[0]!.type).toBe('fix');
    expect(() => parseReply('no json here', 72)).toThrow(/valid JSON/);
  });

  it('needs a key unless the endpoint is local', () => {
    expect(() => assertReady({ ...DEFAULTS, engine: 'ai' })).toThrow(/API key/);
    expect(() => assertReady({ ...DEFAULTS, engine: 'ai', 'base-url': 'http://localhost:11434/v1' })).not.toThrow();
  });
});
