/**
 * Scan added lines for credentials before they land in history.
 * Rules match well-known token formats; a generic rule catches high-entropy
 * values assigned to names like `password` or `api_key`.
 */
import type { DiffFile } from './diff.js';

export type Severity = 'high' | 'medium';

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  re: RegExp;
  /** Capture group holding the secret (default 0). */
  group?: number;
}

export const RULES: Rule[] = [
  { id: 'private-key', name: 'Private key', severity: 'high', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key', name: 'AWS access key ID', severity: 'high', re: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/, group: 1 },
  { id: 'aws-secret', name: 'AWS secret access key', severity: 'high', re: /aws.{0,20}?(?:secret|private).{0,20}?['"=:\s]([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/i, group: 1 },
  { id: 'github-token', name: 'GitHub token', severity: 'high', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, group: 1 },
  { id: 'gitlab-token', name: 'GitLab token', severity: 'high', re: /\b(glpat-[A-Za-z0-9_-]{20,})\b/, group: 1 },
  { id: 'openai-key', name: 'OpenAI API key', severity: 'high', re: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,})\b/, group: 1 },
  { id: 'anthropic-key', name: 'Anthropic API key', severity: 'high', re: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})\b/, group: 1 },
  { id: 'google-api-key', name: 'Google API key', severity: 'high', re: /\b(AIza[0-9A-Za-z_-]{35})\b/, group: 1 },
  { id: 'stripe-key', name: 'Stripe secret key', severity: 'high', re: /\b((?:sk|rk)_live_[0-9A-Za-z]{24,})\b/, group: 1 },
  { id: 'stripe-test-key', name: 'Stripe test key', severity: 'medium', re: /\b((?:sk|rk)_test_[0-9A-Za-z]{24,})\b/, group: 1 },
  { id: 'slack-token', name: 'Slack token', severity: 'high', re: /\b(xox[abposr]-[0-9A-Za-z-]{10,})\b/, group: 1 },
  { id: 'slack-webhook', name: 'Slack webhook URL', severity: 'high', re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,})/, group: 1 },
  { id: 'discord-webhook', name: 'Discord webhook URL', severity: 'high', re: /(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{50,})/, group: 1 },
  { id: 'npm-token', name: 'npm access token', severity: 'high', re: /\b(npm_[A-Za-z0-9]{36})\b/, group: 1 },
  { id: 'sendgrid-key', name: 'SendGrid API key', severity: 'high', re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/, group: 1 },
  { id: 'twilio-key', name: 'Twilio API key', severity: 'high', re: /\b(SK[0-9a-f]{32})\b/, group: 1 },
  { id: 'jwt', name: 'JSON Web Token', severity: 'medium', re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/, group: 1 },
  { id: 'db-url', name: 'Database URL with password', severity: 'high', re: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/'"]+:([^\s@/'"]{3,})@[^\s'"]+)/, group: 1 },
];

const ASSIGN = /\b([\w.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth)[\w.-]*)\b["']?\s*(?:[:=]|=>|:=)\s*["'`]([^"'`\s]{8,})["'`]/i;
const PLACEHOLDER = /^(x+|\*+|\.+|<.*>|\$\{.*\}|\{\{.*\}\}|%.*%|change[-_ ]?me|your[-_].*|example.*|placeholder|dummy|test(ing)?|sample|redacted|null|none|undefined|true|false|password|secret|todo|fixme|process\.env.*|env\(.*\)|os\.environ.*)$/i;

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  name: string;
  severity: Severity;
  /** The secret with the middle masked, safe to print. */
  preview: string;
}

export const mask = (s: string) => (s.length <= 8 ? '*'.repeat(s.length) : `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`);

const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock|go\.sum)$|\.(min\.js|map|svg|snap)$/;
const SENSITIVE_FILES: [RegExp, string][] = [
  [/(^|\/)\.env(\.(?!example|sample|template|dist)[\w.-]+)?$/, 'Environment file'],
  [/(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/, 'SSH private key file'],
  [/\.(pem|p12|pfx|key|keystore|jks)$/, 'Key or certificate file'],
  [/(^|\/)(\.npmrc|\.pypirc|\.netrc|credentials\.json|service[-_]account[^/]*\.json)$/, 'Credentials file'],
];

/** Lines ending with this comment are ignored, for known test fixtures. */
export const ALLOW_COMMENT = /gitscribe:allow/;

export function scanLine(text: string): Omit<Finding, 'file' | 'line'>[] {
  if (ALLOW_COMMENT.test(text)) return [];
  const out: Omit<Finding, 'file' | 'line'>[] = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) out.push({ rule: r.id, name: r.name, severity: r.severity, preview: mask(m[r.group ?? 0] ?? m[0]) });
  }
  if (!out.length) {
    const m = ASSIGN.exec(text);
    const value = m?.[2];
    if (value && !PLACEHOLDER.test(value) && !/^(https?:)?\/\//.test(value) && entropy(value) >= 3.5 && /\d/.test(value) && /[A-Za-z]/.test(value)) {
      out.push({ rule: 'generic-secret', name: `Hard-coded ${m![1]!.toLowerCase().includes('pass') ? 'password' : 'secret'} (${m![1]})`, severity: 'medium', preview: mask(value) });
    }
  }
  return out;
}

export function scanDiff(files: DiffFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    if (f.status === 'deleted') continue;
    const sensitive = SENSITIVE_FILES.find(([re]) => re.test(f.path));
    if (sensitive) findings.push({ file: f.path, line: 0, rule: 'sensitive-file', name: sensitive[1], severity: 'high', preview: f.path.split('/').pop()! });
    if (SKIP_FILES.test(f.path)) continue;
    f.added.forEach((text, i) => {
      for (const hit of scanLine(text)) findings.push({ file: f.path, line: f.addedAt[i] ?? 0, ...hit });
    });
  }
  return findings;
}
