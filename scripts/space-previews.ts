/** Generate the 40 shipped preview plates, with no runtime raster dependency. */
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Resvg } from '@resvg/resvg-js';
import { SPACE_DESIGN } from '../src/space-design.ts';
const source = (await Promise.all(['space-inks.js', 'art.js'].map((f) => readFile(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')))).join('\n');
const art = runInNewContext(`${source}; portalArt`, {}, { timeout: 1000 }) as { draw: (style: number, key: string) => string };
for (const [inkIndex, set] of SPACE_DESIGN.sets.entries()) for (const [motifIndex, motif] of SPACE_DESIGN.motifs.entries()) {
  const [p, a, b, c, x] = set.colors;
  const svg = art.draw(motifIndex * SPACE_DESIGN.sets.length + inkIndex, 'space-preview')
    .replace('viewBox=', 'width="1200" height="630" viewBox=')
    .replace(/style="[^"]*"/, '')
    .replace(/class="(ap|aa|ab|ac|ax|sb|sc)"/g, (_all, cls: string) => `${cls.startsWith('s') ? 'stroke' : 'fill'}="${({ ap: p, aa: a, ab: b, ac: c, ax: x, sb: b, sc: c } as Record<string, string>)[cls]}"`);
  await writeFile(new URL(`../src/site/space-${set.name}-${motif}.png`, import.meta.url), new Resvg(svg).render().asPng());
}
console.log('40 Space preview plates rendered (1200×630).');
