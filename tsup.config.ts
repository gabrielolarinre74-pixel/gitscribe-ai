import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
});
