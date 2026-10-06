import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

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
  plugins: [react()],
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
