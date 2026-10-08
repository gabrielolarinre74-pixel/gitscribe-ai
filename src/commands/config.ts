import { load, save, redact, configPath, isKey, KEYS, DEFAULTS } from '../core/config.js';
import * as ui from '../ui.js';

export function runConfig(mode: string | undefined, pairs: string[]): number {
  if (!mode || mode === 'list') {
    const shown = redact(load());
    const width = Math.max(...KEYS.map((k) => k.length));
    console.log(`${ui.brand()}  ${ui.dim(configPath())}\n`);
    for (const k of KEYS) console.log(`  ${ui.yellow(k.padEnd(width))}  ${shown[k]}${String(load()[k]) === String(DEFAULTS[k]) ? ui.dim('  (default)') : ''}`);
    return 0;
  }
  if (mode === 'path') { console.log(configPath()); return 0; }
  if (mode === 'get') {
    const shown = redact(load());
    for (const k of pairs) {
      if (!isKey(k)) throw new Error(`Unknown setting "${k}". Settings: ${KEYS.join(', ')}.`);
      console.log(shown[k]);
    }
    return 0;
  }
  if (mode === 'set' || mode === 'unset') {
    if (!pairs.length) throw new Error(mode === 'set' ? 'Usage: gitscribe config set key=value [key=value…]' : 'Usage: gitscribe config unset key [key…]');
    const updates: Record<string, string> = {};
    for (const p of pairs) {
      if (mode === 'unset') { updates[p] = ''; continue; }
      const i = p.indexOf('=');
      if (i < 1) throw new Error(`Expected key=value, got "${p}".`);
      updates[p.slice(0, i)] = p.slice(i + 1);
    }
    save(updates);
    for (const k of Object.keys(updates)) console.log(ui.ok(`${mode === 'set' ? 'Saved' : 'Cleared'} ${ui.bold(k)}`));
    return 0;
  }
  throw new Error(`Unknown config command "${mode}". Use list, get, set, unset or path.`);
}
