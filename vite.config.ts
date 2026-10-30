import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { isBuiltin } from 'node:module';
import { relative } from 'node:path';

/**
 * The browser bundle must not contain code the browser cannot run. Vite silently
 * externalizes node builtins (`events`, `fs`, …) to `undefined`, which turns a
 * server-only import into a runtime crash — "Class extends value undefined"
 * from the MongoDB driver, in the case that shipped and froze the app on a
 * blank page. Fail the build instead, naming the import chain.
 */
function noNodeBuiltinsInClient(): Plugin {
  let root = process.cwd();
  const leaks: string[] = [];
  return {
    name: 'queen:no-node-builtins-in-client',
    apply: 'build',
    enforce: 'pre', // before Vite's own resolver, which would externalize them
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      leaks.length = 0;
    },
    // Throwing here is downgraded to a warning by the bundler, so fail at the end.
    resolveId(source, importer) {
      if (!importer || importer.includes('/node_modules/')) return null;
      if (!source.startsWith('node:') && !isBuiltin(source)) return null;
      leaks.push(`${source} ← ${relative(root, importer)}`);
      return null;
    },
    buildEnd(error) {
      if (error || leaks.length === 0) return;
      this.error(
        'These node builtins cannot be bundled for the browser:\n  ' +
          leaks.join('\n  ') +
          '\nKeep client code free of server-only modules — see src/server/lib/accounting/normalize.ts.',
      );
    },
  };
}

let gitHash = 'unknown';
let version = 'dev';

try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Fallback for Docker builds or environments without git
  gitHash = (process.env.VITE_GIT_COMMIT_HASH || 'unknown').slice(0, 7);
}

try {
  version = execSync('git describe --tags --abbrev=0 2>/dev/null').toString().trim();
} catch {
  version = process.env.VITE_BUILD_VERSION || 'dev';
}

export default defineConfig({
  plugins: [react(), noNodeBuiltinsInClient()],
  define: {
    __GIT_COMMIT__: JSON.stringify(gitHash),
    __VERSION__: JSON.stringify(version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
