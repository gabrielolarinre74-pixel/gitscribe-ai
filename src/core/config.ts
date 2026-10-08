/** Settings in ~/.gitscribe (INI), overridable with GITSCRIBE_* environment variables. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ini from 'ini';

export interface Config {
  engine: 'offline' | 'ai';
  'base-url': string;
  model: string;
  'api-key': string;
  'max-length': number;
  /** Add a file-by-file body to commit messages. */
  body: boolean;
  /** Block commits when the secret scanner finds something. */
  'block-secrets': boolean;
  /** Extra instructions for the AI engine, e.g. a language or house style. */
  instructions: string;
}

export const DEFAULTS: Config = {
  engine: 'offline',
  'base-url': 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  'api-key': '',
  'max-length': 72,
  body: true,
  'block-secrets': true,
  instructions: '',
};

export const KEYS = Object.keys(DEFAULTS) as (keyof Config)[];
export const isKey = (k: string): k is keyof Config => (KEYS as string[]).includes(k);

export const configPath = () => process.env.GITSCRIBE_CONFIG || path.join(os.homedir(), '.gitscribe');

export class ConfigError extends Error {}

export function coerce<K extends keyof Config>(key: K, value: string): Config[K] {
  const def = DEFAULTS[key];
  if (typeof def === 'number') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 30 || n > 200) throw new ConfigError(`${key} must be a whole number between 30 and 200.`);
    return n as Config[K];
  }
  if (typeof def === 'boolean') {
    if (!/^(true|false|1|0|yes|no|on|off)$/i.test(value)) throw new ConfigError(`${key} must be true or false.`);
    return /^(true|1|yes|on)$/i.test(value) as Config[K];
  }
  if (key === 'engine' && value !== 'offline' && value !== 'ai') throw new ConfigError('engine must be "offline" or "ai".');
  if (key === 'base-url') {
    let url: URL;
    try { url = new URL(value); } catch { throw new ConfigError('base-url must be a full URL, e.g. https://api.openai.com/v1'); }
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(url.hostname) || url.hostname.endsWith('.local');
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ConfigError('base-url must use https (plain http is only allowed for localhost).');
    return value.replace(/\/+$/, '') as Config[K];
  }
  return value as Config[K];
}

function readFile(): Partial<Record<string, string>> {
  try { return ini.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}

export function load(env: NodeJS.ProcessEnv = process.env): Config {
  const file = readFile();
  const cfg: Config = { ...DEFAULTS };
  for (const key of KEYS) {
    const envVal = env[`GITSCRIBE_${key.toUpperCase().replace(/-/g, '_')}`];
    const raw = envVal ?? file[key];
    if (raw === undefined || raw === '') continue;
    try { (cfg as unknown as Record<string, unknown>)[key] = coerce(key, String(raw)); } catch { /* ignore bad values, keep default */ }
  }
  return cfg;
}

export function save(updates: Partial<Record<keyof Config, string>>): void {
  const file = readFile();
  for (const [k, v] of Object.entries(updates)) {
    if (!isKey(k)) throw new ConfigError(`Unknown setting "${k}". Settings: ${KEYS.join(', ')}.`);
    if (v === '' || v === undefined) delete file[k];
    else file[k] = String(coerce(k, v));
  }
  fs.writeFileSync(configPath(), ini.stringify(file), { mode: 0o600 });
}

/** Safe to print: hides most of the API key. */
export function redact(cfg: Config): Record<string, string> {
  return Object.fromEntries(KEYS.map((k) => {
    const v = cfg[k];
    if (k === 'api-key') return [k, v ? `${String(v).slice(0, 3)}…${String(v).slice(-4)}` : '(not set)'];
    return [k, v === '' ? '(not set)' : String(v)];
  }));
}
