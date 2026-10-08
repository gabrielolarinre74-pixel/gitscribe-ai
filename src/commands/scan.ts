import { parseDiff } from '../core/diff.js';
import { scanDiff, type Finding } from '../core/secrets.js';
import { repoRoot, stagedDiff, git } from '../git.js';
import * as ui from '../ui.js';

export interface ScanFlags { range?: string; json?: boolean; quiet?: boolean }

/** Scan staged changes, or every commit in a range like main..HEAD. Exit code 1 when something is found. */
export function runScan(flags: ScanFlags): number {
  repoRoot();
  let findings: Finding[] = [];
  let scope: string;
  if (flags.range) {
    const hashes = git(['rev-list', '--reverse', flags.range]).split('\n').filter(Boolean);
    for (const h of hashes) {
      const diff = git(['show', '--no-color', '--format=', '-M', h]);
      findings.push(...scanDiff(parseDiff(diff)).map((f) => ({ ...f, file: `${h.slice(0, 7)} ${f.file}` })));
    }
    scope = `${hashes.length} commit${hashes.length === 1 ? '' : 's'} in ${flags.range}`;
  } else {
    const files = parseDiff(stagedDiff());
    findings = scanDiff(files);
    scope = `${files.length} staged file${files.length === 1 ? '' : 's'}`;
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ scanned: scope, findings }, null, 2) + '\n');
    return findings.length ? 1 : 0;
  }
  if (!findings.length) {
    if (!flags.quiet) console.log(ui.ok(`No secrets found in ${scope}`));
    return 0;
  }
  console.log(`\n${ui.brand()}  ${ui.dim('secret scan')}\n`);
  for (const f of findings) console.log(`  ${ui.findingLine(f)}`);
  const high = findings.filter((f) => f.severity === 'high').length;
  console.log(`\n${ui.fail(`${findings.length} finding${findings.length > 1 ? 's' : ''} in ${scope}${high ? ` (${high} high)` : ''}`)}`);
  console.log(ui.dim('  Remove the value or load it from the environment. Mark known test values with a "gitscribe:allow" comment.\n'));
  return 1;
}
