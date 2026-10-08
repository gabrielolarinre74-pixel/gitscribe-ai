/** A parsed unified diff, as produced by `git diff --cached`. */
import { declaredIn } from './symbols.js';

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface DiffFile {
  path: string;
  /** Previous path for renames, otherwise the same as `path`. */
  oldPath: string;
  status: FileStatus;
  binary: boolean;
  added: string[];
  removed: string[];
  /** Line numbers (in the new file) of each added line, same order as `added`. */
  addedAt: number[];
  /** Function or section names git printed after the `@@` markers. */
  contexts: string[];
  /** Nearest declaration above each change, read from context lines. */
  enclosing: string[];
}

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let line = 0;
  let inHunk = false;
  let lastDecl: string | undefined;
  const near = (f: DiffFile) => {
    if (lastDecl && !f.enclosing.includes(lastDecl)) f.enclosing.push(lastDecl);
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = HEADER.exec(raw);
    if (header) {
      file = {
        path: header[2]!,
        oldPath: header[1]!,
        status: header[1] === header[2] ? 'modified' : 'renamed',
        binary: false,
        added: [],
        removed: [],
        addedAt: [],
        contexts: [],
        enclosing: [],
      };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;

    if (!inHunk) {
      if (raw.startsWith('new file mode')) file.status = 'added';
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted';
      else if (raw.startsWith('rename from ')) { file.oldPath = raw.slice(12); file.status = 'renamed'; }
      else if (raw.startsWith('rename to ')) file.path = raw.slice(10);
      else if (raw.startsWith('Binary files') || raw === 'GIT binary patch') file.binary = true;
      else if (raw.startsWith('+++ ') && raw !== '+++ /dev/null') file.path = raw.slice(4).replace(/^b\//, '');
    }

    const hunk = HUNK.exec(raw);
    if (hunk) {
      inHunk = true;
      line = Number(hunk[1]);
      const ctx = hunk[2]?.trim();
      if (ctx && !file.contexts.includes(ctx)) file.contexts.push(ctx);
      lastDecl = ctx ? declaredIn([ctx])[0] : undefined;
      continue;
    }
    if (!inHunk) continue;

    if (raw.startsWith('+')) {
      file.added.push(raw.slice(1));
      file.addedAt.push(line++);
      if (!declaredIn([raw.slice(1)]).length) near(file);
    } else if (raw.startsWith('-')) {
      file.removed.push(raw.slice(1));
      if (!declaredIn([raw.slice(1)]).length) near(file);
    } else if (raw.startsWith(' ') || raw === '') {
      line++;
      const d = declaredIn([raw.slice(1)])[0];
      if (d) lastDecl = d;
    }
  }
  return files;
}

export const stats = (files: DiffFile[]) => ({
  files: files.length,
  insertions: files.reduce((n, f) => n + f.added.length, 0),
  deletions: files.reduce((n, f) => n + f.removed.length, 0),
});

/** Keep a diff under a size budget for prompts, cutting whole files from the end. */
export function trimDiff(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const parts = text.split(/(?=^diff --git )/m);
  let out = '';
  let dropped = 0;
  for (const part of parts) {
    if (out.length + part.length > maxChars) { dropped++; continue; }
    out += part;
  }
  if (!out) out = text.slice(0, maxChars);
  return dropped ? `${out}\n[${dropped} more file${dropped > 1 ? 's' : ''} not shown]` : out;
}
