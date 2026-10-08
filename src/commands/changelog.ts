import fs from 'node:fs';
import path from 'node:path';
import { group, parseLog, render, nextVersion, prepend, LOG_FORMAT } from '../core/changelog.js';
import { repoRoot, latestTag, log, remoteUrl } from '../git.js';
import * as ui from '../ui.js';

export interface ChangelogFlags { from?: string; to?: string; release?: string; write?: boolean; all?: boolean; json?: boolean }

export function runChangelog(flags: ChangelogFlags): number {
  const root = repoRoot();
  const from = flags.from ?? latestTag();
  const to = flags.to ?? 'HEAD';
  const range = from ? `${from}..${to}` : to;
  const g = group(parseLog(log(range, LOG_FORMAT)));
  const version = flags.release ?? (from ? nextVersion(from, g.bump) : undefined);
  const date = new Date().toISOString().slice(0, 10);

  if (flags.json) {
    process.stdout.write(JSON.stringify({ range, bump: g.bump, version, entries: g.entries, other: g.other.length }, null, 2) + '\n');
    return 0;
  }
  const md = render(g, { version, date, repoUrl: remoteUrl(), all: flags.all });
  const counts = `${g.entries.length} conventional, ${g.other.length} other`;
  process.stderr.write(`${ui.brand()}  ${ui.dim(`${range} · ${counts} · bump: `)}${ui.yellow(g.bump)}${version ? ui.dim(` → ${version}`) : ''}\n\n`);
  if (flags.write) {
    const file = path.join(root, 'CHANGELOG.md');
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.writeFileSync(file, prepend(existing, md));
    process.stderr.write(ui.ok(`Updated ${path.relative(process.cwd(), file) || 'CHANGELOG.md'}`) + '\n');
  } else {
    process.stdout.write(md);
  }
  return 0;
}
