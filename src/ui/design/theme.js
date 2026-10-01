/* Plain script: inlined into the room; Node tests evaluate this complete file. */
const MCPortalTheme = (() => {
  const HOST = Object.freeze({
    '--color-background-primary': 'surface-canvas',
    '--color-background-secondary': 'surface-inset',
    '--color-text-primary': 'text-primary',
    '--color-text-secondary': 'text-secondary',
    '--color-text-info': 'text-link',
    '--color-border-primary': 'border-control',
    '--font-sans': 'font-ui', '--font-mono': 'font-mono',
    '--border-radius-lg': 'radius-card',
  });
  const COLOR_KEYS = Object.keys(HOST).filter(k => k.startsWith('--color-'));
  function rgb(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    const hex = /^#([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(s);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
      if (h.length === 8 && h.slice(6).toLowerCase() !== 'ff') return null;
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(s);
    if (match && (match[4] === undefined || Number(match[4]) === 1)) {
      const channels = match.slice(1, 4).map(Number);
      if (channels.every(c => c >= 0 && c <= 255)) return channels;
    }
    return null;
  }
  const hex = channels => '#' + channels.map(c => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
  function luminance(value) {
    const channels = rgb(value);
    if (!channels) throw new Error('Expected resolved opaque sRGB colour');
    const linear = channels.map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  function mix(a, b, weight) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * weight + y[i] * (1 - weight))); }
  function normalize(value, resolveColor) {
    const direct = rgb(value);
    if (direct) return hex(direct);
    if (typeof value !== 'string' || /[;{}<>]|url\(|var\(/i.test(value)) return null;
    const resolved = resolveColor ? resolveColor(value) : null;
    return rgb(resolved) ? hex(rgb(resolved)) : null;
  }
  function resolve(scheme, variables = {}, resolveColor) {
    const house = MP_PALETTES[scheme === 'dark' ? 'dark' : 'light'];
    const palette = { ...house };
    const incoming = {};
    // Only references to known colour inputs are allowed; cycles and external names fail closed.
    function color(key, seen = new Set()) {
      if (!COLOR_KEYS.includes(key) || seen.has(key)) return null;
      const value = variables[key];
      if (typeof value !== 'string') return null;
      const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
      if (!alias) return normalize(value, resolveColor);
      seen.add(key); return color(alias[1], seen);
    }
    for (const key of COLOR_KEYS) { const c = color(key); if (c) incoming[HOST[key]] = c; }
    const canvas = incoming['surface-canvas'] || house['surface-canvas'];
    palette['surface-canvas'] = canvas;
    const primary = incoming['text-primary'] || house['text-primary'];
    const foreground = contrast(primary, canvas) >= 4.5 ? primary
      : contrast('#000000', canvas) >= contrast('#FFFFFF', canvas) ? '#000000' : '#FFFFFF';
    palette['text-primary'] = foreground;
    const surfaces = [canvas];
    for (const role of ['card', 'inset', 'raised', 'input', 'hover', 'pressed', 'selected']) {
      const name = `surface-${role}`;
      const candidate = incoming[name] || (incoming['surface-canvas']
        ? mix(foreground, canvas, ['hover', 'pressed', 'selected'].includes(role) ? .06 : .025)
        : house[name]);
      palette[name] = contrast(foreground, candidate) >= 4.5 ? candidate : canvas;
      surfaces.push(palette[name]);
    }
    function safe(candidate, fallback, minimum = 4.5) {
      for (const c of [candidate, fallback, foreground]) if (c && surfaces.every(bg => contrast(c, bg) >= minimum)) return c;
      return foreground;
    }
    palette['text-secondary'] = safe(incoming['text-secondary'], house['text-secondary']);
    palette['text-placeholder'] = palette['text-secondary'];
    palette['text-link'] = safe(incoming['text-link'], house['text-link']);
    palette['text-inverse'] = canvas;
    palette['border-control'] = safe(incoming['border-control'], mix(foreground, canvas, .6), 3);
    palette['border-divider'] = incoming['border-control'] || mix(foreground, canvas, .2);
    palette['action-primary'] = safe(house['action-primary'], palette['text-link']);
    palette['action-danger'] = safe(house['action-danger'], foreground);
    for (const role of ['primary', 'danger']) {
      const bg = palette[`action-${role}`], original = house[`action-on-${role}`];
      palette[`action-on-${role}`] = contrast(original, bg) >= 4.5 ? original
        : contrast('#000000', bg) >= contrast('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
    }
    palette['focus-ring'] = safe(house['focus-ring'], foreground, 3);
    palette['border-selected'] = palette['action-primary'];
    for (const name of Object.keys(house).filter(k => k.startsWith('status-') || k.startsWith('source-'))) palette[name] = safe(house[name], foreground);
    for (const key of ['--font-sans', '--font-mono']) {
      const v = variables[key];
      if (typeof v === 'string' && v.trim() && v.length <= 200 && !/[;{}<>\\\n\r]|url\(|var\(/i.test(v)) palette[HOST[key]] = v.trim();
    }
    const radius = variables['--border-radius-lg'];
    if (typeof radius === 'string' && /^\d+(?:\.\d+)?px$/.test(radius.trim()) && parseFloat(radius) <= 24) palette['radius-card'] = radius.trim();
    return palette;
  }
  function browserColorResolver(root) {
    const doc = root.ownerDocument;
    const context = doc && doc.createElement('canvas').getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    return value => {
      if (!context || !CSS.supports('color', value) || /currentcolor|inherit|initial|unset|revert|canvas|button|linktext|highlight/i.test(value)) return null;
      // CSS and canvas colour support can differ. An unsupported fillStyle is
      // silently ignored; two sentinels prevent reusing a previous host colour.
      context.fillStyle = '#010203'; context.fillStyle = value; const first = context.fillStyle;
      context.fillStyle = '#040506'; context.fillStyle = value;
      if (context.fillStyle !== first) return null;
      context.clearRect(0, 0, 1, 1); context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return pixel[3] === 255 ? hex([...pixel].slice(0, 3)) : null;
    };
  }
  function create(root, options = {}) {
    const media = options.matchMedia || (query => window.matchMedia(query));
    const system = media('(prefers-color-scheme: dark)');
    const resolveColor = options.resolveColor || browserColorResolver(root);
    let scheme = system.matches ? 'dark' : 'light', hostScheme = null;
    const variables = {}, applied = new Set();
    function paint() {
      const palette = resolve(scheme, variables, resolveColor);
      for (const prop of applied) root.style.removeProperty(prop);
      applied.clear();
      for (const [role, value] of Object.entries(palette)) {
        // Web brand variants are CSS-driven, not an input to room layout.
        if (role.startsWith('web-')) continue;
        const prop = `--mp-${role}`; root.style.setProperty(prop, value); applied.add(prop);
      }
      root.dataset.theme = scheme;
      return palette;
    }
    function update(ctx) {
      if (!ctx || typeof ctx !== 'object') return paint();
      const requested = ctx.theme === 'dark' || ctx.theme === 'light' ? ctx.theme : null;
      if (requested) {
        if (requested !== scheme) for (const key of COLOR_KEYS) delete variables[key];
        scheme = requested; hostScheme = requested;
      }
      const vars = ctx.styles && ctx.styles.variables;
      if (vars && typeof vars === 'object') for (const key of Object.keys(HOST)) {
        if (!Object.prototype.hasOwnProperty.call(vars, key)) continue;
        if (typeof vars[key] === 'string' && vars[key].trim()) variables[key] = vars[key].trim();
        else delete variables[key];
      }
      return paint();
    }
    const onSystemChange = () => {
      if (hostScheme) return;
      const next = system.matches ? 'dark' : 'light';
      if (next !== scheme) for (const key of COLOR_KEYS) delete variables[key];
      scheme = next; paint();
    };
    system.addEventListener?.('change', onSystemChange);
    paint();
    return { update, destroy: () => system.removeEventListener?.('change', onSystemChange) };
  }
  return { create, resolve, contrast, rgb, HOST };
})();
