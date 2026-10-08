/** Find the names of things declared on changed lines, across common languages. */

const PATTERNS: RegExp[] = [
  // JS / TS
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  /^\s*(?:export\s+)?const\s+([A-Z][A-Za-z0-9_$]*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:memo|forwardRef)\(/,
  // Python
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*class\s+([A-Za-z_]\w*)\s*[(:]/,
  // Go
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
  // Rust
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
  // Ruby
  /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/,
  // Java / C# / Kotlin methods
  /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>[\],\s]+\s+)?([A-Za-z_]\w*)\s*\([^;]*$/,
  /^\s*(?:fun|suspend\s+fun)\s+([A-Za-z_]\w*)/,
];

const NOISE = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'main', 'init', 'new', 'get', 'set', 'then']);

export function declaredIn(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*(\/\/|#|\*|\/\*)/.test(line)) continue;
    for (const re of PATTERNS) {
      const m = re.exec(line);
      if (m?.[1] && !NOISE.has(m[1]) && !out.includes(m[1])) { out.push(m[1]); break; }
    }
  }
  return out;
}

/** Name of the enclosing function from a hunk context like `function handleLogin(req) {`. */
export function contextName(context: string): string | undefined {
  return declaredIn([context])[0];
}

export interface SymbolChanges {
  added: string[];
  removed: string[];
  /** Declared on both sides: the signature or body changed. */
  changed: string[];
  /** Functions whose body was edited, taken from hunk headers. */
  touched: string[];
}

export function symbolChanges(added: string[], removed: string[], contexts: string[] = [], enclosing: string[] = []): SymbolChanges {
  const plus = declaredIn(added);
  const minus = declaredIn(removed);
  const changed = plus.filter((s) => minus.includes(s));
  const all = [...plus, ...minus];
  const fromCtx = enclosing.length ? enclosing : contexts.map(contextName);
  const touched = fromCtx.filter((s): s is string => !!s && !all.includes(s));
  return {
    added: plus.filter((s) => !minus.includes(s)),
    removed: minus.filter((s) => !plus.includes(s)),
    changed,
    touched: [...new Set(touched)],
  };
}

/** True when an exported symbol disappeared: a likely breaking change. */
export function removedExports(removed: string[], added: string[]): string[] {
  const exported = (lines: string[]) => declaredIn(lines.filter((l) => /^\s*(export\s|pub\s|module\.exports)/.test(l)));
  const before = exported(removed);
  const after = new Set(declaredIn(added));
  return before.filter((s) => !after.has(s));
}
