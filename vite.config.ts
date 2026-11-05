import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: { legalComments: 'eof' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787', '/i/': 'http://127.0.0.1:8787', '/a/': 'http://127.0.0.1:8787' },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        banner: '/*! 映屿 (Yingyu) — Copyright 2026 qiuyuxc. Apache-2.0. Third-party licenses and copyrights: /third-party-notices.txt */',
      },
    },
  },
});
