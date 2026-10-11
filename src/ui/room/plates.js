  // room/plates.js: an agent illustration as a card (show_plate, lab `plates`; docs/plans/plates.md)
  // ------------------------------------------------------------ plates
  // The agent supplies a checked spec; the room draws it with its own SVG and elements.
  // Labels are set as text, never markup. A plate is labeled as the agent's and cites refs.
  /** @typedef {ToolResults['show_plate']['plate']} Plate */
  /** @typedef {Plate['spec']} PlateSpec */

  const PLATE_SVG = 'http://www.w3.org/2000/svg';
  const PLATE_INKS = ['var(--mp-action-primary)', 'var(--mp-brand-mustard)', 'var(--mp-brand-brick)', 'var(--mp-web-text)'];
  const PLATE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PLATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * An SVG element. Text children become text nodes, never markup.
   * @param {string} tag @param {Record<string, string | number | null | undefined> | null} [attrs] @param {...(Node | string | number)} children
   * @returns {SVGElement}
   */
  function svgEl(tag, attrs, ...children) {
    const node = document.createElementNS(PLATE_SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  /** "Oct 5" for an ISO date, else the label. @param {string} x @param {boolean} [year] */
  function plateDate(x, year) {
    if (!PLATE_ISO.test(x)) return x;
    return `${PLATE_MONTHS[Number(x.slice(5, 7)) - 1]} ${Number(x.slice(8, 10))}${year ? `, ${x.slice(0, 4)}` : ''}`;
  }
  /** @param {string} iso */
  const plateDay = (iso) => Date.parse(`${iso}T00:00:00Z`);
  /** Round tick values covering lo..hi. @param {number} lo @param {number} hi */
  function plateTicks(lo, hi) {
    if (hi === lo) hi = lo + 1;
    const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= 4) || 10 * mag;
    /** @type {number[]} */
    const ticks = [];
    for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
    return ticks;
  }
  /** @param {number} n @param {string} [unit] */
  const plateNum = (n, unit = '') => (unit === '%' ? `${n}%` : `${unit}${n}`);

  /** @param {Extract<PlateSpec, { kind: 'series' }>} spec */
  function plateSeries(spec) {
    const W = 640, H = 260, L = 52, R = 56, T = 26, B = 34;
    const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))];
    const dated = xs.every((x) => PLATE_ISO.test(x));
    if (dated) xs.sort();
    const bands = spec.mark === 'bar' || !dated;
    const ys = spec.series.flatMap((s) => s.points.map((p) => p.y));
    // Bars measure from zero; a line shows change, so it fits the data's own range.
    const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
    const ticks = spec.mark === 'bar' ? plateTicks(Math.min(0, lo), Math.max(0, hi)) : plateTicks(lo - pad, hi + pad);
    const y0 = ticks[0] ?? 0, y1 = ticks.at(-1) ?? 1;
    const Y = (/** @type {number} */ v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const band = (W - L - R) / xs.length;
    const t0 = dated ? plateDay(xs[0] ?? '') : 0, t1 = dated ? plateDay(xs.at(-1) ?? '') : 1;
    const X = (/** @type {string} */ x) => bands ? L + band * (xs.indexOf(x) + 0.5) : L + (t1 === t0 ? 0.5 : (plateDay(x) - t0) / (t1 - t0)) * (W - L - R);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plate-svg', role: 'img', 'aria-label': `${spec.mark === 'bar' ? 'Bar' : 'Line'} chart of ${spec.series.map((s) => s.name).join(', ')}` });
    for (const v of ticks) {
      svg.append(svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'plate-grid' }));
      svg.append(svgEl('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'plate-tick' }, plateNum(v, spec.unit)));
    }
    const every = Math.max(1, Math.ceil(xs.length / 8));
    xs.forEach((x, i) => { if (i % every === 0 || i === xs.length - 1) svg.append(svgEl('text', { x: X(x), y: H - 12, 'text-anchor': 'middle', class: 'plate-tick' }, plateDate(x))); });
    for (const ev of spec.events || []) {
      if (!xs.includes(ev.at) && !(dated && !bands && plateDay(ev.at) >= t0 && plateDay(ev.at) <= t1)) continue;
      const x = X(ev.at);
      const right = x > W - R - 80;
      svg.append(svgEl('line', { x1: x, x2: x, y1: T - 6, y2: H - B, class: 'plate-event' }), svgEl('text', { x: right ? x - 4 : x + 4, y: T - 10, 'text-anchor': right ? 'end' : 'start', class: 'plate-event-label' }, ev.label));
    }
    const width = Math.min(28, (band * 0.8) / spec.series.length);
    spec.series.forEach((s, i) => {
      const ink = PLATE_INKS[i % PLATE_INKS.length];
      if (spec.mark === 'bar') {
        for (const p of s.points) {
          if (p.y === 0) continue;   // nothing to draw; the axis already says zero
          const x = X(p.x) - (width * spec.series.length) / 2 + width * i, top = Y(Math.max(0, p.y)), base = Y(Math.min(0, p.y));
          svg.append(svgEl('rect', { x, y: top, width: Math.max(1, width - 2), height: Math.max(1, base - top), fill: ink, class: 'plate-bar' }, svgEl('title', null, `${s.name}, ${plateDate(p.x, true)}: ${plateNum(p.y, spec.unit)}`)));
        }
        return;
      }
      const pts = dated ? [...s.points].sort((a, b) => a.x.localeCompare(b.x)) : s.points;
      const d = pts.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
      svg.append(svgEl('path', { d, fill: 'none', stroke: ink, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      for (const p of pts) svg.append(svgEl('circle', { cx: X(p.x), cy: Y(p.y), r: 3, fill: ink }, svgEl('title', null, `${s.name}, ${plateDate(p.x, true)}: ${plateNum(p.y, spec.unit)}`)));
      const last = pts.at(-1);
      if (last) svg.append(svgEl('circle', { cx: X(last.x), cy: Y(last.y), r: 6, fill: ink, class: 'plate-end' }), svgEl('text', { x: X(last.x) + 10, y: Y(last.y) + 4, class: 'plate-label-text' }, plateNum(last.y, spec.unit)));
    });
    const legend = spec.series.length > 1 ? el('div', { class: 'plate-legend' }, spec.series.map((s, i) => el('span', null, el('i', { style: `background:${PLATE_INKS[i % PLATE_INKS.length]}` }), s.name))) : null;
    return el('div', { class: 'plate-art' }, legend, svg);
  }

  /** @param {Extract<PlateSpec, { kind: 'timeline' }>} spec @param {Map<string, number>} refNo */
  function plateTimeline(spec, refNo) {
    const W = 640, L = 70, R = 70, axis = 0;
    const t0 = plateDay(spec.entries[0]?.at ?? ''), t1 = plateDay(spec.entries.at(-1)?.at ?? '');
    const X = (/** @type {string} */ at) => L + (t1 === t0 ? 0.5 : (plateDay(at) - t0) / (t1 - t0)) * (W - L - R);
    // Labels take the first lane where they don't overlap: above, below, then a row further out.
    const lanes = [-44, 50, -90, 96], ends = lanes.map(() => -Infinity);
    const placed = spec.entries.map((e, i) => {
      const x = X(e.at), meta = `${plateDate(e.at)}${e.ref ? ` · [${refNo.get(e.ref)}]` : ''}`;
      const width = Math.max(e.label.length * 7.2, meta.length * 6.4) + 12;
      const anchor = x - width / 2 < 8 ? 'start' : x + width / 2 > W - 8 ? 'end' : 'middle';
      const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
      let lane = lanes.findIndex((_, j) => j % 2 === i % 2 && left > (ends[j] ?? 0));
      if (lane < 0) lane = lanes.findIndex((_, j) => left > (ends[j] ?? 0));
      if (lane < 0) lane = ends.indexOf(Math.min(...ends));
      ends[lane] = left + width;
      return { e, x, meta, anchor, ly: axis + (lanes[lane] ?? 0) };
    });
    const top = Math.min(axis, ...placed.map((p) => p.ly)) - 28, bottom = Math.max(axis, ...placed.map((p) => p.ly)) + 26;
    const svg = svgEl('svg', { viewBox: `0 ${top} ${W} ${bottom - top}`, class: 'plate-svg', role: 'img', 'aria-label': `Timeline of ${spec.entries.length} entries` });
    svg.append(svgEl('line', { x1: 20, x2: W - 20, y1: axis, y2: axis, class: 'plate-axis' }));
    for (const { e, x, meta, anchor, ly } of placed) {
      const up = ly < axis;
      svg.append(svgEl('line', { x1: x, x2: x, y1: axis, y2: up ? ly + 6 : ly - 16, class: 'plate-leader' }));
      svg.append(svgEl('text', { x, y: up ? ly - 14 : ly, 'text-anchor': anchor, class: 'plate-label-text' }, e.label));
      svg.append(svgEl('text', { x, y: up ? ly + 2 : ly + 16, 'text-anchor': anchor, class: 'plate-tick' }, meta));
    }
    for (const { e, x } of placed) svg.append(svgEl('circle', { cx: x, cy: axis, r: 7, class: e.ref ? 'plate-dot cited' : 'plate-dot' }, svgEl('title', null, `${plateDate(e.at, true)}: ${e.label}${e.detail ? `. ${e.detail}` : ''}`)));
    const details = spec.entries.filter((e) => e.detail);
    return el('div', { class: 'plate-art' }, svg, details.length ? el('dl', { class: 'plate-details' }, details.flatMap((e) => [el('dt', null, `${plateDate(e.at)} · ${e.label}`), el('dd', null, e.detail)])) : null);
  }

  /** @param {Extract<PlateSpec, { kind: 'steps' }>} spec */
  function plateSteps(spec) {
    return el('div', { class: 'plate-art' }, el('ol', { class: 'plate-steps' }, spec.steps.map((s) => el('li', { class: s.emphasis ? 'key' : '' }, el('b', null, s.label), s.detail ? el('span', null, s.detail) : null))));
  }

  /** @param {Extract<PlateSpec, { kind: 'matrix' }>} spec @param {Map<string, number>} refNo */
  function plateMatrix(spec, refNo) {
    return el('div', { class: 'plate-art plate-scroll' }, el('table', { class: 'plate-matrix' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, ''), spec.columns.map((c) => el('th', { scope: 'col' }, c.label, c.ref ? ` [${refNo.get(c.ref)}]` : '')))),
      el('tbody', null, spec.rows.map((r) => el('tr', null, el('th', { scope: 'row' }, r.label), r.cells.map((c) => el('td', null, el('span', { class: `plate-cell ${c.mark}` }, c.mark === 'none' ? null : el('i', { 'aria-hidden': 'true' }), c.text, c.mark === 'none' ? null : el('span', { class: 'sr-only' }, ` (${c.mark})`)))))))));
  }

  /** The plate's figure: art, caption, label and evidence. @param {Plate} plate */
  function plateNode(plate) {
    const refNo = new Map(plate.refs.map((r, i) => [r.ref, i + 1]));
    const s = plate.spec;
    const art = s.kind === 'series' ? plateSeries(s) : s.kind === 'timeline' ? plateTimeline(s, refNo) : s.kind === 'steps' ? plateSteps(s) : plateMatrix(s, refNo);
    return el('figure', { class: 'plate' },
      el('div', { class: 'plate-head' }, el('span', { class: 'plate-kicker' }, `Plate · agent illustration · ${s.kind}`), el('span', { class: 'plate-badge' }, 'Temporary')),
      art,
      plate.caption ? el('figcaption', { class: 'plate-caption' }, plate.caption) : null,
      plate.refs.length ? el('ol', { class: 'plate-refs', 'aria-label': 'Evidence' }, plate.refs.map((r) => el('li', null,
        r.url && isHttpUrl(r.url) ? el('a', { onclick: () => openLink(r.url ?? '') }, r.title) : el('span', { class: r.missing ? 'error' : '' }, r.title)))) : null);
  }

  // This view belongs to a show_plate call: it is a plate card, not a room.
  /** @param {Plate} plate */
  function showPlateCard(plate) {
    root.classList.add('article-view');
    $('roomName').textContent = 'plate';
    $('welcome').hidden = true;
    $('grid').hidden = true;
    const reader = $('reader');
    reader.hidden = false; reader.scrollTop = 0;
    renderReader(readerTop('', false), el('h1', null, plate.title),
      el('div', { class: 'byline' }, `Drawn from your agent's spec · ${ago(plate.createdAt)}`),
      plateNode(plate));
    setStatus('');
  }
