// Bundles the game into dist/index.html — a single self-contained file that
// runs straight from disk (no server needed) and can be hosted anywhere.
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

async function assemble(result) {
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = await readFile('src/ui/style.css', 'utf8');
  const shell = await readFile('src/index.html', 'utf8');
  const html = shell
    .replace('/*__STYLE__*/', () => css)
    .replace('/*__SCRIPT__*/', () => js.replace(/<\/script/gi, '<\\/script'));
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', html);
  console.log(`[build] dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
}

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !watch,
  target: 'es2020',
  write: false,
  outdir: 'dist',
  legalComments: 'none',
  plugins: [{
    name: 'assemble',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        await assemble(result);
      });
    },
  }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 8080 });
  console.log(`[dev] watching — open http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
