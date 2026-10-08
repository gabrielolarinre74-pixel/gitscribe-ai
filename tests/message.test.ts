import { describe, expect, it } from 'vitest';
import { format, header, imperative, lint, parse } from '../src/core/message.js';

describe('format and parse', () => {
  it('round-trips header, body and footers', () => {
    const msg = format({ type: 'feat', scope: 'api', breaking: true, subject: 'drop v1 routes', body: '- remove /v1/users', footers: ['BREAKING CHANGE: v1 is gone.', 'Refs: #12'] });
    expect(msg).toBe('feat(api)!: drop v1 routes\n\n- remove /v1/users\n\nBREAKING CHANGE: v1 is gone.\nRefs: #12');
    expect(parse(msg)).toEqual({ type: 'feat', scope: 'api', breaking: true, subject: 'drop v1 routes', body: '- remove /v1/users', footers: ['BREAKING CHANGE: v1 is gone.', 'Refs: #12'] });
  });

  it('marks breaking from a footer alone and ignores comment lines', () => {
    const c = parse('fix: change default port\n\nBREAKING CHANGE: port is now 8080\n# Please enter the commit message');
    expect(c?.breaking).toBe(true);
  });

  it('rejects non-conventional headers', () => {
    expect(parse('Update stuff')).toBeNull();
    expect(parse('feature: add thing')).toBeNull();
  });

  it('builds headers without a scope', () => {
    expect(header({ type: 'docs', breaking: false, subject: 'add setup guide' })).toBe('docs: add setup guide');
  });
});

describe('lint', () => {
  const rules = (m: string) => lint(m).map((i) => i.rule);

  it('passes a good message', () => {
    expect(lint('fix(auth): refresh tokens before they expire')).toEqual([]);
  });

  it('flags format, type, tense, case, period and length', () => {
    expect(rules('Fixed the login')).toContain('format');
    expect(rules('feature: add login')).toContain('type');
    expect(rules('feat: added login page')).toContain('imperative');
    expect(rules('feat: Add login page')).toContain('subject-case');
    expect(rules('feat: add login page.')).toContain('period');
    expect(rules(`feat: ${'a'.repeat(80)}`)).toContain('length');
    expect(rules('fix: update')).toContain('vague');
    expect(rules('feat: add login\nbody right away')).toContain('blank-line');
  });

  it('suggests the imperative form', () => {
    expect(lint('feat: adds login page')[0]!.message).toContain('"add"');
    expect(imperative('fixed')).toBe('fix');
    expect(imperative('applied')).toBe('apply');
    expect(imperative('pushes')).toBe('push');
  });

  it('leaves merge and revert commits alone', () => {
    expect(lint('Merge branch main into feature')).toEqual([]);
  });
});
