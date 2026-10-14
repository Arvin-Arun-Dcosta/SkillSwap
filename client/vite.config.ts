/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { constants, brotliCompressSync, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

const API_TARGET = process.env.VITE_DEV_API ?? 'http://localhost:5000';

/**
 * Production build tweaks:
 * - preloads the Latin subset of the UI font, so text does not wait for the stylesheet to be parsed;
 * - writes brotli and gzip copies of text assets, which the server sends instead of compressing
 *   on every request.
 */
function productionAssets(): Plugin {
  return {
    name: 'skillswap-production-assets',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) =>
          /\/plus-jakarta-sans-latin-wght-normal-[\w-]+\.woff2$/.test(file),
        );
        if (!font) return [];
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              href: `/${font}`,
              as: 'font',
              type: 'font/woff2',
              crossorigin: '',
            },
            injectTo: 'head',
          },
        ];
      },
    },
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      for (const [file, output] of Object.entries(bundle)) {
        if (!/^assets\/.+\.(js|css|svg|json)$/.test(file)) continue;
        const source = output.type === 'chunk' ? output.code : output.source;
        const data = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source);
        if (data.byteLength < 1024) continue;
        const target = path.join(dir, file);
        writeFileSync(
          `${target}.br`,
          brotliCompressSync(data, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
              [constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
            },
          }),
        );
        writeFileSync(`${target}.gz`, gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), productionAssets()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Never inline assets as data: URLs; the Content-Security-Policy only allows same-origin files.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
