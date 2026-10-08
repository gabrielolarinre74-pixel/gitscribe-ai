/** Sort changed files into the kinds that decide a commit type. */

export type FileKind = 'docs' | 'test' | 'ci' | 'build' | 'deps' | 'config' | 'style' | 'asset' | 'source';

const RULES: [FileKind, RegExp][] = [
  ['ci', /(^|\/)(\.github\/workflows|\.circleci|\.gitlab-ci\.yml|\.buildkite|azure-pipelines\.yml|Jenkinsfile|\.travis\.yml|bitbucket-pipelines\.yml)/],
  ['deps', /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|go\.sum|uv\.lock)$/],
  ['test', /(^|\/)(__tests__|tests?|spec|e2e|cypress|playwright)\/|\.(test|spec|e2e)\.[a-z0-9]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$|(^|\/)fixtures?\//],
  ['docs', /\.(md|mdx|rst|adoc|txt)$|(^|\/)(docs?|documentation)\/|(^|\/)(LICENSE|CHANGELOG|AUTHORS|CODEOWNERS)(\.[a-z]+)?$/i],
  ['build', /(^|\/)(Dockerfile|docker-compose\.ya?ml|Makefile|CMakeLists\.txt|build\.gradle(\.kts)?|pom\.xml|go\.mod|Cargo\.toml|pyproject\.toml|setup\.(py|cfg)|requirements[^/]*\.txt)$|(^|\/)(webpack|rollup|vite|tsup|esbuild|babel|turbo|next|nuxt|astro|svelte)\.config\.[a-z]+$/],
  ['config', /(^|\/)(\.editorconfig|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.env\.example|\.prettierrc[^/]*|\.eslintrc[^/]*|eslint\.config\.[a-z]+|tsconfig[^/]*\.json|biome\.json|\.vscode\/.*)$/],
  ['style', /\.(css|scss|sass|less|styl)$/],
  ['asset', /\.(png|jpe?g|gif|svg|webp|ico|avif|woff2?|ttf|otf|mp4|mp3|wav|pdf)$/i],
];

export function kindOf(path: string): FileKind {
  if (/(^|\/)package\.json$/.test(path)) return 'build';
  for (const [kind, re] of RULES) if (re.test(path)) return kind;
  return 'source';
}

const SKIP_DIRS = new Set(['src', 'lib', 'app', 'apps', 'packages', 'pkg', 'internal', 'cmd', 'source', 'components', 'tests', 'test', '__tests__', 'spec', 'docs', '.github', 'workflows', 'main', 'java', 'kotlin', 'scala', 'resources', 'com', 'org', 'net', 'io']);

/**
 * Pick a short scope from the paths that changed: the first meaningful folder
 * they share (packages/api/... → api, src/auth/login.ts → auth).
 * Returns undefined when files are spread across unrelated areas.
 */
export function scopeOf(paths: string[]): string | undefined {
  if (!paths.length) return undefined;
  const scopes = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    const dirs = parts.slice(0, -1);
    const mono = dirs.findIndex((d) => d === 'packages' || d === 'apps');
    let scope: string | undefined;
    if (mono >= 0 && dirs[mono + 1]) scope = dirs[mono + 1];
    else scope = dirs.find((d) => !SKIP_DIRS.has(d) && !d.startsWith('.'));
    if (!scope && parts.length === 1) scope = undefined;
    scopes.add(scope ?? '');
  }
  if (scopes.size !== 1) return undefined;
  const only = [...scopes][0]!;
  return only ? only.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || undefined : undefined;
}
