// Bundles the server into dist/index.js. Dependencies stay external (installed from node_modules);
// only the workspace package @skillswap/shared, which ships TypeScript source, is bundled in.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-dependencies',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@skillswap/')) return undefined;
          if (args.kind === 'entry-point') return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
