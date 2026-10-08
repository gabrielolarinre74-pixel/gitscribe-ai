import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/core/diff.js';
import { scanDiff, scanLine, entropy, mask } from '../src/core/secrets.js';
import { diffOf } from './helpers.js';

// Test tokens are assembled at runtime so this file never contains a real-looking secret.
const j = (...parts: string[]) => parts.join('');
const rnd = (n: number, alphabet = 'aB3dE5gH7jK9mN2pQ4sT6vW8yZ') => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join('');

describe('scanLine', () => {
  it.each([
    ['github-token', `token = "${j('gh', 'p_', rnd(36))}"`],
    ['aws-access-key', `AWS_ACCESS_KEY_ID=${j('AK', 'IA', 'QX7PLM2RT9ZK4WNB')}`],
    ['stripe-key', `const k = "${j('sk', '_live_', rnd(28))}"`],
    ['slack-token', `SLACK=${j('xo', 'xb-', '1234567890-', rnd(24))}`],
    ['google-api-key', `key: ${j('AI', 'za', rnd(35))}`],
    ['npm-token', `//registry.npmjs.org/:_authToken=${j('np', 'm_', rnd(36))}`],
    ['private-key', j('-----BEGIN ', 'RSA PRIVATE KEY-----')],
    ['db-url', `DATABASE_URL=${j('postgres', '://app:', 'S3cretPassw0rd', '@db.internal:5432/app')}`],
    ['generic-secret', `const apiKey = "${j('q8Zt', '2LmX9', 'vR4kP7wN')}";`],
  ])('detects %s', (rule, line) => {
    expect(scanLine(line).map((f) => f.rule)).toContain(rule);
  });

  it('ignores placeholders, env lookups and low-entropy values', () => {
    expect(scanLine('const password = "changeme";')).toEqual([]);
    expect(scanLine('API_KEY="your-api-key-here"')).toEqual([]);
    expect(scanLine('const token = process.env.GITHUB_TOKEN;')).toEqual([]);
    expect(scanLine('password: "aaaaaaaaaaaa1"')).toEqual([]);
    expect(scanLine('const secretName = "${SECRET}"')).toEqual([]);
  });

  it('respects the allow comment', () => {
    expect(scanLine(`const k = "${j('sk', '_live_', rnd(28))}"; // gitscribe:allow`)).toEqual([]);
  });

  it('masks what it prints', () => {
    const [hit] = scanLine(`const k = "${j('sk', '_live_', rnd(28))}"`);
    expect(hit!.preview).toMatch(/^sk_l\*+\w{4}$/);
    expect(mask('short')).toBe('*****');
  });
});

describe('scanDiff', () => {
  it('reports file and line, skipping removed lines and lockfiles', () => {
    const token = j('gh', 'p_', rnd(36));
    const d = diffOf('src/config.ts', [`const old = "${token}";`], ['// config', `export const token = "${token}";`]) + diffOf('package-lock.json', [], [`"integrity": "${token}"`]);
    const findings = scanDiff(parseDiff(d));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/config.ts', line: 2, rule: 'github-token', severity: 'high' });
  });

  it('flags committed .env files but not .env.example', () => {
    const d = diffOf('.env', [], ['DEBUG=true'], { status: 'added' }) + diffOf('.env.example', [], ['API_KEY='], { status: 'added' });
    expect(scanDiff(parseDiff(d)).map((f) => [f.file, f.rule])).toEqual([['.env', 'sensitive-file']]);
  });

  it('measures entropy', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
  });
});
