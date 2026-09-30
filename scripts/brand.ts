/**
 * MCPortal's brand, drawn from one source. Writes every brand asset from the geometry
 * and type below, so the marks, favicon, social card, workspace header and MCP server
 * icon can't drift apart:
 *
 *   node scripts/brand.ts          write everything
 *
 * brand/            masters: marks, wordmark, lockups, social card (SVG), usage notes
 * src/site/         what the public pages serve: favicon, app icon, social card, lockup
 * src/ui/brand/     marks inlined into the workspace (colours from its CSS)
 * src/brand-icons.ts   the icons the MCP server advertises (data: URIs)
 *
 * The wordmark is Jost Bold (brand/fonts, SIL OFL), converted to outlines here so
 * nothing downstream needs the font. PNGs are rendered with resvg. Both tools are
 * dev dependencies; the server itself stays dependency-free.
 *
 * test/core.test.ts rebuilds the SVG and TypeScript outputs and fails if the
 * committed files differ, so edit this script and re-run it rather than the outputs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype, { type Font, type Path } from 'opentype.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The house ink set ("atomic", also the first set in src/ui/art.js). */
export const INK = { paper: '#F2E6CF', teal: '#2A8C82', mustard: '#E0A526', ink: '#1F2A36', brick: '#C4452C' };

const r2 = (v: number) => Number(v.toFixed(2)).toString();

// ------------------------------------------------------------------ geometry

/** A doorway: straight sides from `base` up to a semicircular top. */
function arch(cx: number, base: number, w: number, h: number): string {
  const a = w / 2, top = base - h + a;
  return `M${r2(cx - a)} ${r2(base)}V${r2(top)}A${r2(a)} ${r2(a)} 0 0 1 ${r2(cx + a)} ${r2(top)}V${r2(base)}Z`;
}

/** Half of a tilted ellipse: the back half runs behind the door, the front half across it. */
function ring(cx: number, cy: number, rx: number, ry: number, deg: number, half: 'back' | 'front'): string {
  const a = (deg * Math.PI) / 180;
  const at = (t: number) => [cx + rx * Math.cos(t) * Math.cos(a) - ry * Math.sin(t) * Math.sin(a), cy + rx * Math.cos(t) * Math.sin(a) + ry * Math.sin(t) * Math.cos(a)];
  const [from, to] = half === 'back' ? [at(Math.PI), at(0)] : [at(0), at(Math.PI)];
  return `M${r2(from[0]!)} ${r2(from[1]!)}A${r2(rx)} ${r2(ry)} ${r2(deg)} 0 1 ${r2(to[0]!)} ${r2(to[1]!)}`;
}

/** The Portal mark's parts on a 64-unit grid: a door, an orbit through it, a moon in the doorway. */
const PORTAL = {
  door: arch(32, 54, 24, 38),
  back: ring(32, 37, 26, 7.5, -18, 'back'),
  front: ring(32, 37, 26, 7.5, -18, 'front'),
  moon: { cx: 32, cy: 29 },
};

const halftone = (id: string, step: number, r: number, fill: string) =>
  `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="${fill}"/></pattern>`;

/**
 * The Portal mark. `detail` adds the print texture (a halftone screen and an off-register
 * keyline), for sizes of about 64px and up; small sizes get thicker lines and a bigger moon.
 * `bleed` fills the whole square (app icons, which the platform rounds itself).
 */
function portalMark({ detail = false, bleed = false } = {}): string {
  const line = detail ? 3.2 : 4.4, moon = detail ? 4.2 : 5;
  const shape = bleed ? 'width="64" height="64"' : 'x="2" y="2" width="60" height="60" rx="14"';
  const plate = `<rect ${shape} fill="${INK.teal}"/>`
    + (detail ? `<defs>${halftone('mcp-ht', 3, 0.7, INK.ink)}</defs><rect ${shape} fill="url(#mcp-ht)" fill-opacity=".28"/>` : '');
  const scene = `<path d="${PORTAL.back}" fill="none" stroke="${INK.mustard}" stroke-width="${line}" stroke-linecap="round"/>`
    + `<path d="${PORTAL.door}" fill="${INK.ink}"/>`
    + `<circle cx="${PORTAL.moon.cx}" cy="${PORTAL.moon.cy}" r="${moon}" fill="${INK.brick}"/>`
    + `<path d="${PORTAL.front}" fill="none" stroke="${INK.mustard}" stroke-width="${line}" stroke-linecap="round"/>`
    + (detail ? `<path d="${PORTAL.door}" fill="none" stroke="${INK.ink}" stroke-width="1.2" stroke-opacity=".7" transform="translate(1.4 -1)"/>` : '');
  // App icons keep the scene clear of the rounded corners the platform applies.
  return plate + (bleed ? `<g transform="translate(32 32) scale(.86) translate(-32 -32)">${scene}</g>` : scene);
}

/**
 * The Line mark for the UI icon set (24-unit grid, same strokes as the other icons):
 * the door, the front of the orbit, and the moon as the one spot of colour.
 */
function lineMark(stroke: string, dot: string): string {
  const k = 24 / 64;
  const door = arch(32 * k, 54 * k, 28 * k, 42 * k);
  const front = ring(32 * k, 38 * k, 26 * k, 8 * k, -18, 'front');
  return `<path d="${door}" fill="none" ${stroke} stroke-width="1.9" stroke-linejoin="round"/>`
    + `<path d="${front}" fill="none" ${stroke} stroke-width="1.9" stroke-linecap="round"/>`
    + `<circle cx="${r2(32 * k)}" cy="${r2(27 * k)}" r="1.6" ${dot}/>`;
}

// ------------------------------------------------------------------ type

/** SVG path data from a glyph path's commands (opentype.js's own serializer isn't reliable across versions). */
function pathData(p: Path): string {
  return p.commands.map((c) => {
    switch (c.type) {
      case 'M': case 'L': return `${c.type}${r2(c.x!)} ${r2(c.y!)}`;
      case 'Q': return `Q${r2(c.x1!)} ${r2(c.y1!)} ${r2(c.x!)} ${r2(c.y!)}`;
      case 'C': return `C${r2(c.x1!)} ${r2(c.y1!)} ${r2(c.x2!)} ${r2(c.y2!)} ${r2(c.x!)} ${r2(c.y!)}`;
      default: return 'Z';
    }
  }).join('');
}

interface SetText { d: string; width: number; top: number; bottom: number }

/** Set text as outlines: caps `capHeight` tall, tracked by `tracking` em, baseline at 0. */
function setText(font: Font, text: string, capHeight: number, tracking: number, x0 = 0): SetText {
  const size = (capHeight * font.unitsPerEm) / font.tables.os2.sCapHeight;
  const scale = size / font.unitsPerEm;
  let x = x0, d = '', top = 0, bottom = 0;
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  glyphs.forEach((glyph, i) => {
    const p = glyph.getPath(x, 0, size);
    const box = p.getBoundingBox();
    top = Math.min(top, box.y1);
    bottom = Math.max(bottom, box.y2);
    d += pathData(p);
    const next = glyphs[i + 1];
    x += glyph.advanceWidth * scale + (next ? font.getKerningValue(glyph, next) * scale + tracking * size : 0);
  });
  return { d, width: x - x0, top, bottom };
}

/** The wordmark: MCPORTAL in Jost Bold, tracked 0.08em, split MC | PORTAL for colour. */
function wordmark(bold: Font, capHeight: number) {
  const tracking = 0.08;
  const mc = setText(bold, 'MC', capHeight, tracking);
  const gap = tracking * ((capHeight * bold.unitsPerEm) / bold.tables.os2.sCapHeight);
  const portal = setText(bold, 'PORTAL', capHeight, tracking, mc.width + gap);
  return { mc: mc.d, portal: portal.d, width: mc.width + gap + portal.width, top: Math.min(mc.top, portal.top), bottom: Math.max(mc.bottom, portal.bottom) };
}

// ------------------------------------------------------------------ files

const svg = (w: number, h: number, body: string, label = 'MCPortal', viewBox = `0 0 ${r2(w)} ${r2(h)}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="${viewBox}" role="img" aria-label="${label}">${body}</svg>\n`;

/** Every asset: path (relative to the repo) -> contents. PNGs are rendered from their SVG sources. */
export function buildBrand(): { text: Record<string, string>; png: Record<string, { from: string; width: number }[]> } {
  const bold = opentype.parse(new Uint8Array(readFileSync(path.join(ROOT, 'brand/fonts/Jost-Bold.ttf'))).buffer);
  const medium = opentype.parse(new Uint8Array(readFileSync(path.join(ROOT, 'brand/fonts/Jost-Medium.ttf'))).buffer);

  // Wordmark: cap height 100 units, viewBox tight to the ink (O and C overshoot slightly).
  const wm = wordmark(bold, 100);
  const wmBox = `0 ${r2(wm.top)} ${r2(wm.width)} ${r2(wm.bottom - wm.top)}`;
  const wmH = wm.bottom - wm.top;
  const wordmarkSvg = (mc: string, portal: string) => svg(wm.width, wmH, `<path d="${wm.mc}" fill="${mc}"/><path d="${wm.portal}" fill="${portal}"/>`, 'MCPortal', wmBox);

  // Lockups. Side by side: the mark is 2.4 cap heights tall, a cap height away. Stacked: centred.
  const lockup = (mc: string, portal: string) => {
    const cap = 100, mark = cap * 2.4, gap = cap * 0.9;
    const w = mark + gap + wm.width, h = mark;
    const y = (h - cap) / 2 + cap;   // baseline so the caps sit on the mark's centre line
    return svg(w, h, `<svg width="${mark}" height="${mark}" viewBox="0 0 64 64">${portalMark({ detail: true })}</svg>`
      + `<g transform="translate(${r2(mark + gap)} ${r2(y)})"><path d="${wm.mc}" fill="${mc}"/><path d="${wm.portal}" fill="${portal}"/></g>`);
  };
  const stacked = (() => {
    const cap = 100, mark = cap * 3.2, gap = cap * 0.7;
    const w = Math.max(mark, wm.width), h = mark + gap + cap;
    return svg(w, h, `<svg x="${r2((w - mark) / 2)}" width="${mark}" height="${mark}" viewBox="0 0 64 64">${portalMark({ detail: true })}</svg>`
      + `<g transform="translate(${r2((w - wm.width) / 2)} ${r2(mark + gap + cap)})"><path d="${wm.mc}" fill="${INK.ink}"/><path d="${wm.portal}" fill="${INK.teal}"/></g>`);
  })();

  // Social card, 1200x630: the portal scene large on the right, lockup and tagline on the left.
  const social = (() => {
    const W = 1200, H = 630;
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let stars = '';
    for (let i = 0; i < 70; i++) {
      const x = rand() * W, y = rand() * H, rad = 0.8 + rand() * 2.2;
      stars += `M${r2(x - rad)} ${r2(y)}a${r2(rad)} ${r2(rad)} 0 1 0 ${r2(2 * rad)} 0a${r2(rad)} ${r2(rad)} 0 1 0 ${r2(-2 * rad)} 0`;
    }
    const door = arch(900, 630, 300, 520), inner = arch(900, 630, 170, 400);
    const back = ring(900, 420, 420, 90, -14, 'back'), front = ring(900, 420, 420, 90, -14, 'front');
    const cap = 44, markSize = cap * 2.4, lx = 96, ly = 150;
    const tag = setText(medium, 'Your liminal webspace.', 34, 0);
    return svg(W, H, `<defs>${halftone('mcp-ht-card', 14, 3.2, INK.ink)}</defs>`
      + `<rect width="${W}" height="${H}" fill="${INK.ink}"/><path d="${stars}" fill="${INK.paper}" fill-opacity=".55"/>`
      + `<path d="${back}" fill="none" stroke="${INK.mustard}" stroke-width="12" stroke-linecap="round"/>`
      + `<path d="${door}" fill="${INK.teal}"/><path d="${door}" fill="url(#mcp-ht-card)" fill-opacity=".35"/>`
      + `<path d="${inner}" fill="${INK.paper}"/><circle cx="900" cy="330" r="34" fill="${INK.brick}"/>`
      + `<path d="${front}" fill="none" stroke="${INK.mustard}" stroke-width="14" stroke-linecap="round"/>`
      + `<path d="${door}" fill="none" stroke="${INK.paper}" stroke-width="3" stroke-opacity=".5" transform="translate(9 -6)"/>`
      + `<svg x="${lx}" y="${ly}" width="${r2(markSize)}" height="${r2(markSize)}" viewBox="0 0 64 64">${portalMark({ detail: true })}</svg>`
      + `<g transform="translate(${r2(lx + markSize + cap * 0.9)} ${r2(ly + (markSize - cap) / 2 + cap)}) scale(${cap / 100})"><path d="${wm.mc}" fill="${INK.paper}"/><path d="${wm.portal}" fill="${INK.mustard}"/></g>`
      + `<g transform="translate(${lx} ${ly + markSize + 96})"><path d="${tag.d}" fill="${INK.paper}"/></g>`,
    'MCPortal: your liminal webspace.');
  })();

  const lineInk = lineMark(`stroke="${INK.ink}"`, `fill="${INK.brick}"`);
  const text: Record<string, string> = {
    'brand/mark.svg': svg(64, 64, portalMark({ detail: true })),
    'brand/mark-small.svg': svg(64, 64, portalMark()),
    'brand/app-icon.svg': svg(64, 64, portalMark({ bleed: true })),
    'brand/mark-line.svg': svg(24, 24, lineInk),
    'brand/wordmark.svg': wordmarkSvg(INK.ink, INK.teal),
    'brand/wordmark-on-dark.svg': wordmarkSvg(INK.paper, INK.mustard),
    'brand/lockup.svg': lockup(INK.ink, INK.teal),
    'brand/lockup-on-dark.svg': lockup(INK.paper, INK.mustard),
    'brand/lockup-stacked.svg': stacked,
    'brand/social-card.svg': social,
    'src/site/favicon.svg': svg(64, 64, portalMark()),
    'src/site/lockup.svg': lockup(INK.ink, INK.teal),
    // Inlined into the workspace: colours come from its CSS so they follow the theme.
    'src/ui/brand/mark-line.svg': `<svg class="brand-line" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${lineMark('stroke="currentColor"', 'class="brand-dot"')}</svg>`,
    'src/ui/brand/badge.svg': `<svg class="brand-badge" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${portalMark()}</svg>`,
    'src/ui/brand/wordmark.svg': `<svg class="brand-word" viewBox="${wmBox}" role="img" aria-label="MCPortal"><path class="brand-mc" d="${wm.mc}"/><path class="brand-portal" d="${wm.portal}"/></svg>`,
  };
  const png = {
    'src/site/favicon.ico': [{ from: 'brand/mark-small.svg', width: 16 }, { from: 'brand/mark-small.svg', width: 32 }, { from: 'brand/mark-small.svg', width: 48 }],
    'src/site/apple-touch-icon.png': [{ from: 'brand/app-icon.svg', width: 180 }],
    'src/site/icon-512.png': [{ from: 'brand/app-icon.svg', width: 512 }],
    'src/site/og.png': [{ from: 'brand/social-card.svg', width: 1200 }],
  };
  return { text, png };
}

/** The MCP server's icons (2025-11-25 `Implementation.icons`): a PNG every client can show, and the SVG. */
function serverIcons(png64: Buffer, smallSvg: string): string {
  return `// Generated by scripts/brand.ts. Do not edit: change the script and re-run it.
/** The icons MCPortal advertises in serverInfo (MCP 2025-11-25 \`Implementation.icons\`). */
export const SERVER_ICONS = [
  { src: 'data:image/png;base64,${png64.toString('base64')}', mimeType: 'image/png', sizes: ['64x64'] },
  { src: 'data:image/svg+xml;base64,${Buffer.from(smallSvg).toString('base64')}', mimeType: 'image/svg+xml', sizes: ['any'] },
];
`;
}

/** An .ico holding PNG images (every current browser and Windows reads these). */
function ico(images: Array<{ width: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ width, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(width >= 256 ? 0 : width, e);
    header.writeUInt8(width >= 256 ? 0 : width, e + 1);
    header.writeUInt16LE(1, e + 4);    // colour planes
    header.writeUInt16LE(32, e + 6);   // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

async function main(): Promise<void> {
  const { Resvg } = await import('@resvg/resvg-js');
  const render = (source: string, width: number) => Buffer.from(new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng());
  const { text, png } = buildBrand();
  const write = (file: string, data: string | Buffer) => {
    mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
    writeFileSync(path.join(ROOT, file), data);
    console.log(`wrote ${file}`);
  };
  for (const [file, contents] of Object.entries(text)) write(file, contents);
  for (const [file, sources] of Object.entries(png)) {
    const images = sources.map(({ from, width }) => ({ width, data: render(text[from]!, width) }));
    write(file, file.endsWith('.ico') ? ico(images) : images[0]!.data);
  }
  write('src/brand-icons.ts', serverIcons(render(text['brand/mark-small.svg']!, 64), text['brand/mark-small.svg']!));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
