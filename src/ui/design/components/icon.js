  /** @type {Record<string, { d: string, dot?: number[], state?: boolean }>} */
  const definitions = ICONS;
  /** An icon from the generated set, drawn in currentColor. @param {string} name */
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('stroke-width', String(ICON_STROKE));
    const { d, dot, state: hasState } = definitions[name] ?? (() => { throw new Error('Unknown icon: ' + name); })();
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d);
    svg.append(path);
    if (dot) {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', String(dot[0])); circle.setAttribute('cy', String(dot[1])); circle.setAttribute('r', String(dot[2]));
      circle.setAttribute('fill', 'currentColor'); circle.setAttribute('stroke', 'none');
      if (hasState) circle.setAttribute('class', 'icon-state');   // shown only while its button is pressed
      svg.append(circle);
    }
    return svg;
  }
