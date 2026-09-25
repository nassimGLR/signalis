// Bundles the game into dist/index.html — a single self-contained file that
// runs straight from disk (no server needed) and can be hosted anywhere.
// The OFL fonts in assets/fonts are inlined as @font-face data URIs, so the
// page makes no network requests at all.
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// family, file, weight range. L7 Mono and L7 Hand are renamed subsets of IBM Plex
// Mono and Reenie Beanie (Reserved Font Names); see assets/fonts/OFL.txt.
const FONTS = [
  ['Sofia Sans Condensed', 'SofiaSansCondensed-VF.woff2', '400 800'],
  ['L7 Mono', 'L7Mono-Regular.woff2', '400'],
  ['L7 Mono', 'L7Mono-Medium.woff2', '500'],
  ['Michroma', 'Michroma-Regular.woff2', '400'],
  ['L7 Hand', 'L7Hand-Regular.woff2', '400'],
];

async function fontFaces() {
  // OFL 1.1 §2: every copy carries the copyright notices and the licence. The
  // notice (families, copyright lines, modifications, full licence text) rides
  // in a CSS comment ahead of the @font-face rules, so it survives into both
  // dist/index.html and dist/embed.html.
  const notice = (await readFile('assets/fonts/OFL.txt', 'utf8')).replace(/\*\//g, '* /').trim();
  let css = `/*\n${notice}\n*/\n`;
  let bytes = 0;
  for (const [family, file, weight] of FONTS) {
    const buf = await readFile(`assets/fonts/${file}`);
    bytes += buf.length;
    css += `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');font-weight:${weight};font-style:normal;font-display:block}\n`;
  }
  return { css, bytes };
}

async function assemble(result) {
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const fonts = await fontFaces();
  const css = fonts.css + await readFile('src/ui/style.css', 'utf8');
  const shell = await readFile('src/index.html', 'utf8');
  const html = shell
    .replace('/*__STYLE__*/', () => css)
    .replace('/*__SCRIPT__*/', () => js.replace(/<\/script/gi, '<\\/script'));
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', html);
  console.log(`[build] dist/index.html  ${(html.length / 1024).toFixed(0)} KB  (fonts ${(fonts.bytes / 1024).toFixed(0)} KB raw)`);
  // Embeddable variant: page content only (the host supplies doctype/head/body).
  const embed = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '');
  await writeFile('dist/embed.html', embed);
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
