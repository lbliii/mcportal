/**
 * Fallback art for items without a picture (or while it loads): small portal scenes
 * printed like a mid-century sci-fi paperback. Flat inks on paper, a halftone screen,
 * a keyline slightly off register.
 *
 * Each source gets a style, one ink set and one motif, so a shelf reads as one source;
 * each item gets its own placement, so a row of them isn't identical. styles() hands the
 * portal's sources distinct styles in order: every source starts from the one its key
 * hashes to, so the same feed tends to look the same everywhere.
 *
 * draw() returns SVG markup built only from numbers and the constants below; keys only
 * reach it through the hash. Colours are CSS classes, not attributes, so the .art rules
 * in room.html can swap paper and ink for dark mode.
 *
 * Plain script, inlined into room.html by roomHtml(); tests load it with vm.
 */
const portalArt = (() => {
  // paper, ink a, ink b, darkest ink, accent
  const INKS = [
    ['#F2E6CF', '#2A8C82', '#E0A526', '#1F2A36', '#C4452C'],   // atomic
    ['#EFE3C8', '#E2692A', '#3FA7A0', '#1E2F4F', '#F2C230'],   // space age
    ['#F4E4C1', '#2B5C8A', '#D2402F', '#1B2330', '#F2C230'],   // pulp
    ['#EDE2C6', '#7A8B3A', '#C8622B', '#3E2C22', '#E9B949'],   // olive drab
    ['#F3E1D3', '#5B3558', '#E27A73', '#2A1C2B', '#8CC6A8'],   // pink moon
    ['#F0DDC2', '#B5482E', '#E3B070', '#3A2A3F', '#5FA8A0'],   // mars
    ['#ECE6D6', '#1F4E8C', '#9AA3A6', '#17202E', '#D8432E'],   // mission
    ['#E9E4D4', '#2F7F9A', '#EFB23C', '#243447', '#D9603B'],   // harbor
  ];
  const W = 160, H = 84;

  /** FNV-1a: a stable 32-bit hash of a key. */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** mulberry32: well mixed from the first draw, so seeds that differ by a character diverge. */
  function random(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let z = Math.imul(t ^ (t >>> 15), 1 | t);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n = (v) => (Math.round(v * 10) / 10).toString();
  // Pattern and clip ids must be unique in the document.
  let seq = 0;
  const id = () => `pa${++seq}`;

  const dot = (cx, cy, rad) => { const q = n(rad); return `M${n(cx - rad)} ${n(cy)}a${q} ${q} 0 1 0 ${n(2 * rad)} 0a${q} ${q} 0 1 0 ${n(-2 * rad)} 0`; };
  const archPath = (cx, w, h) => { const a = w / 2, yT = H - h + a; return `M${n(cx - a)} ${H}V${n(yT)}A${n(a)} ${n(a)} 0 0 1 ${n(cx + a)} ${n(yT)}V${H}Z`; };
  const inArch = (px, py, cx, w, h) => {
    const a = w / 2, yT = H - h + a;
    if (py > H || Math.abs(px - cx) > a) return false;
    return py >= yT || Math.hypot(px - cx, py - yT) <= a;
  };
  /** Back (false) or front (true) half of a tilted ellipse, so a ring can pass behind and in front. */
  const ring = (cx, cy, rx, ry, deg, front) => {
    const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
    let d = '';
    for (let i = 0; i <= 32; i++) {
      const t = (front ? 0 : Math.PI) + (Math.PI * i) / 32;
      d += `${i ? 'L' : 'M'}${n(cx + rx * Math.cos(t) * co - ry * Math.sin(t) * si)} ${n(cy + rx * Math.cos(t) * si + ry * Math.sin(t) * co)}`;
    }
    return d;
  };
  const screen = (step, rad) => {
    const pid = id();
    return { pid, def: `<pattern id="${pid}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle class="ac" cx="${step / 2}" cy="${step / 2}" r="${rad}"/></pattern>` };
  };
  const paper = `<rect class="ap" width="${W}" height="${H}"/>`;
  const keyline = (d) => `<path class="sc" d="${d}" fill="none" stroke-width="1.3" transform="translate(1.6 -1.1)"/>`;

  // Each motif keeps its composition but varies per item: where it sits (cropping at the
  // edge like a paperback cover), how big it is, and which side the small body is on.
  const between = (r, lo, hi) => lo + r() * (hi - lo);
  const side = (r) => (r() < 0.5 ? -1 : 1);

  const MOTIFS = {
    arches(r) {
      const cx = between(r, 22, 138), k = between(r, 0.72, 1.08), layers = r() < 0.5 ? 3 : 4, s = screen(3.2, 0.7);
      const size = (i) => [84 - i * 20, 82 - i * 14].map((v) => v * k);
      const outer = archPath(cx, ...size(0));
      const fills = ['aa', 'ab', 'aa', 'ac'];
      let body = `<circle class="ax" cx="${n(cx + side(r) * between(r, 16, 34) * k)}" cy="${n(between(r, 14, 34))}" r="${n(between(r, 10, 16))}"/>`
        + `<path class="aa" d="${outer}"/><path d="${outer}" fill="url(#${s.pid})" opacity=".35"/>`;
      for (let i = 1; i < layers; i++) body += `<path class="${i === layers - 1 ? 'ac' : fills[i]}" d="${archPath(cx, ...size(i))}"/>`;
      return `<defs>${s.def}</defs>${paper}${body}${keyline(outer)}`;
    },
    orbits(r) {
      const cx = between(r, 26, 134), cy = between(r, 26, 58), R = between(r, 15, 26), tilt = between(r, -28, 28);
      const rx = R * between(r, 1.8, 2.3), ry = R * between(r, 0.35, 0.55), s = screen(3, 0.9), clip = id(), lit = side(r);
      let stars = '';
      for (let i = 0; i < 14; i++) stars += dot(r() * W, r() * H, 0.5 + r() * 0.8);
      const a = r() * 6.28, orbit = R * between(r, 1.5, 2);
      // Halftone shading on the side away from the light.
      const shade = lit > 0 ? `x="${n(cx - R)}"` : `x="${n(cx)}"`;
      return `<defs>${s.def}<clipPath id="${clip}"><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/></clipPath></defs>${paper}<path class="ac" d="${stars}"/>`
        + `<path class="sc" d="${ring(cx, cy, rx, ry, tilt, false)}" fill="none" stroke-width="2.4"/>`
        + `<circle class="aa" cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/><rect ${shade} y="${n(cy - R)}" width="${n(R)}" height="${n(2 * R)}" fill="url(#${s.pid})" clip-path="url(#${clip})"/>`
        + `<path class="sb" d="${ring(cx, cy, rx, ry, tilt, true)}" fill="none" stroke-width="3"/>`
        + `<circle class="ax" cx="${n(cx + orbit * Math.cos(a))}" cy="${n(cy + orbit * 0.7 * Math.sin(a))}" r="${n(between(r, 3.5, 5.5))}"/>`
        + keyline(dot(cx, cy, R));
    },
    portal(r) {
      const cx = between(r, 30, 130), k = between(r, 0.78, 1.08), tilt = between(r, -32, 32), s = screen(3.2, 0.75);
      const w = 58 * k, h = 76 * k, cy = H - h * between(r, 0.35, 0.6), rx = w * between(r, 0.95, 1.2), ry = between(r, 10, 16);
      const door = archPath(cx, w, h), inner = archPath(cx, w * 0.58, h * 0.74);
      return `<defs>${s.def}</defs>${paper}<path class="sb" d="${ring(cx, cy, rx, ry, tilt, false)}" fill="none" stroke-width="2.6"/>`
        + `<path class="aa" d="${door}"/><path d="${door}" fill="url(#${s.pid})" opacity=".35"/><path class="ac" d="${inner}"/>`
        + `<circle class="ax" cx="${n(cx + between(r, -6, 6) * k)}" cy="${n(H - h * between(r, 0.3, 0.5))}" r="${n(5 * k + 1)}"/>`
        + `<path class="sb" d="${ring(cx, cy, rx, ry, tilt, true)}" fill="none" stroke-width="3"/>`
        + keyline(door);
    },
    gravity(r) {
      // A dot screen pushed outward around a moon, as if the grid were bent by its pull.
      const cx = between(r, 22, 138), cy = between(r, 18, 66), R = between(r, 8, 13), pull = 20 * R;
      let d = '';
      for (let py = -6; py < H + 8; py += 7) {
        for (let px = -6; px < W + 8; px += 7) {
          const dx = px - cx, dy = py - cy, dd = Math.hypot(dx, dy) || 1;
          if (dd < 8) continue;
          const nd = dd + pull / dd, nx = cx + (dx / dd) * nd, ny = cy + (dy / dd) * nd;
          if (nx >= 0 && nx <= W && ny >= 0 && ny <= H) d += dot(nx, ny, nd < R * 3.6 ? 1.5 : 0.95);
        }
      }
      const a = r() * 6.28, lit = side(r), orbit = R * between(r, 1.7, 2.3);
      return `${paper}<path class="aa" d="${d}"/><circle class="ac" cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}"/><circle class="ab" cx="${n(cx - lit * 3)}" cy="${n(cy - 3)}" r="${n(R)}"/>`
        + `<circle class="ax" cx="${n(cx + orbit * Math.cos(a))}" cy="${n(cy + orbit * Math.sin(a))}" r="${n(between(r, 2.8, 4))}"/>`;
    },
    doorway(r) {
      // A dot field outside; through the door, a starfield knocked out of the dark.
      const cx = between(r, 24, 136), w = between(r, 40, 64), h = between(r, 58, 80);
      let out = '', inside = '';
      for (let py = 4; py < H; py += 6) {
        for (let px = 4; px < W; px += 6) {
          if (!inArch(px, py, cx, w, h)) out += dot(px, py, 0.75);
          else if (r() < 0.35) inside += dot(px + r() * 3 - 1.5, py + r() * 3 - 1.5, Math.round((0.5 + r() * 1.1) * 10) / 10);
        }
      }
      const door = archPath(cx, w, h);
      return `${paper}<path class="ab" d="${out}"/><path class="ac" d="${door}"/><path class="ap" d="${inside}"/>`
        + `<circle class="ax" cx="${n(cx + side(r) * w * between(r, 0.08, 0.24))}" cy="${n(H - h + w * between(r, 0.35, 0.6))}" r="${n(between(r, 3.5, 5.5))}"/>`
        + `<rect class="aa" x="${n(cx - w / 2 - 4)}" y="${H - 5}" width="${n(w + 8)}" height="5"/>`
        + keyline(door);
    },
  };

  const NAMES = Object.keys(MOTIFS);
  const COUNT = INKS.length * NAMES.length;
  const parts = (style) => ({ ink: INKS[style % INKS.length], motif: NAMES[Math.floor(style / INKS.length) % NAMES.length] });

  /**
   * Styles for a portal's sources, in display order. Each source takes the free style
   * that repeats the fewest ink sets and motifs used so far, never the motif of the portal
   * just before it; ties go to the style its key hashes to (then the next ones after it).
   * So the first eight sources get eight ink sets and the first five get all five motifs,
   * and adding a portal never restyles the ones before it.
   */
  function styles(keys) {
    const taken = new Set(), inkUse = INKS.map(() => 0), motifUse = NAMES.map(() => 0);
    let previous = -1;
    return keys.map((key) => {
      const preferred = hash(key) % COUNT;
      let best = preferred, bestCost = Infinity;
      for (let k = 0; k < COUNT; k++) {
        const style = (preferred + k) % COUNT;
        if (taken.has(style)) continue;
        const ink = style % INKS.length, motif = Math.floor(style / INKS.length);
        const cost = inkUse[ink] + motifUse[motif] + (motif === previous ? COUNT : 0);
        if (cost < bestCost) { best = style; bestCost = cost; }
      }
      if (taken.size >= COUNT - 1) taken.clear();   // more sources than styles: start another round
      taken.add(best);
      inkUse[best % INKS.length]++;
      previous = Math.floor(best / INKS.length);
      motifUse[previous]++;
      return best;
    });
  }

  /** The scene for one item: the source's style, placed by the item's key. */
  function draw(style, itemKey) {
    const { ink: [p, a, b, c, accent], motif } = parts(style);
    const body = MOTIFS[motif](random(hash(`${style}\n${itemKey}`)));
    return `<svg xmlns="http://www.w3.org/2000/svg" class="art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" style="--mp-art-ink-p:${p};--mp-art-ink-a:${a};--mp-art-ink-b:${b};--mp-art-ink-c:${c};--mp-art-ink-x:${accent}">${body}</svg>`;
  }

  /** A style's lead ink (its set's first ink after paper): the source's colour in the room. */
  const leadOf = (style) => INKS[style % INKS.length][1];

  return { styles, draw, leadOf, motifOf: (style) => parts(style).motif, inkOf: (style) => style % INKS.length };
})();
