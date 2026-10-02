  // room/bridge.js: host bridge: JSON-RPC over postMessage, host requests/notifications, tool calls, display mode
  // ------------------------------------------------------------ host bridge (MCP Apps, postMessage JSON-RPC)
  /** Requests sent to the host, by JSON-RPC id, waiting for its answer. */
  /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
  const pending = new Map();
  let nextId = 1;
  let displayMode = 'inline';
  let canFullscreen = false;
  /** What the host said it supports (ui/initialize): serverTools, openLinks, message, … */
  /** @type {Record<string, unknown>} */
  let hostCapabilities = {};
  let gotInitialResult = false;
  let toolRunning = false;
  // /preview with a static token: the user pastes it once; it lives only in this tab.
  /** @type {string | null} */
  let devToken = null;
  try { devToken = DEV && DEV.needsToken ? sessionStorage.getItem('mcportal-token') : null; } catch { devToken = null; }
  /** The room load in flight, so two never run at once. @type {Promise<void> | null} */
  let loading = null;
  /** @type {string | null} */
  let articleUrl = null;   // set when this view belongs to a read_article call (a reader card)
  /** @type {string | null} */
  let spaceHandle = null;  // set when this view belongs to an open_space call; '' for your own
  /** @type {string | null} */
  let clipId = null;       // set when this view belongs to a get_clip or get_share call (a card); share ids start with "s"

  /**
   * A JSON-RPC request to the host, answered through `message` events.
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @returns {Promise<any>} the host's result (host data: check before use)
   */
  function hostRequest(method, params, timeoutMs = 30000) {
    /** @type {Record<string, string>} */
    const needs = { 'tools/call': 'serverTools', 'ui/open-link': 'openLinks', 'ui/message': 'message', 'ui/update-model-context': 'updateModelContext' };
    const capability = needs[method];
    if (capability && !hostCapabilities[capability]) return Promise.reject(new Error(`This host does not support ${method}. Ask your agent to perform this action.`));
    if (method === 'ui/request-display-mode' && !canFullscreen) return Promise.reject(new Error('Fullscreen is not available here'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  /** @param {string} method @param {Record<string, unknown>} params */
  function hostNotify(method, params) {
    if (!DEV) window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  }
  window.addEventListener('message', (event) => {
    if (DEV || event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.method === undefined && msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id); clearTimeout(p.timer);
      msg.error ? p.reject(new Error(msg.error.message || 'Host error')) : p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined) {   // request from host
      const ok = msg.method === 'ping' || msg.method === 'ui/resource-teardown';
      window.parent.postMessage(ok ? { jsonrpc: '2.0', id: msg.id, result: {} }
        : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }, '*');
      return;
    }
    try {
      onHostNotification(msg.method, msg.params || {});
    } catch (error) {
      showAppError('Could not display the tool result', error);
    }
  });

  /**
   * A notification from the host: tool input and result, theme and display changes.
   * @param {string} method
   * @param {Record<string, any>} params host data, checked field by field below
   */
  function onHostNotification(method, params) {
    if (method === 'ui/notifications/tool-input' || method === 'ui/notifications/tool-input-partial') {
      toolRunning = true;   // the host is running our tool: wait for its result
      const args = params.arguments || {};
      if (typeof args.docs === 'string' || (typeof args.portalId === 'string' && typeof args.url !== 'string')) { docsArgs = typeof args.docs === 'string' ? { docs: args.docs } : { portalId: args.portalId }; root.classList.add('article-view'); }
      else if (typeof args.url === 'string') { articleUrl = args.url; root.classList.add('article-view'); }
      else if (typeof args.id === 'string') { clipId = args.id; root.classList.add('article-view'); }
      else if (typeof args.handle === 'string') { spaceHandle = args.handle; root.classList.add('article-view'); }
      setStatus('Stand by…');
    } else if (method === 'ui/notifications/tool-result') {
      toolRunning = false;
      const data = params.structuredContent;
      pendingHandoff = data && data.handoff && typeof data.handoff.url === 'string' ? data.handoff : null;   // open_handoff: open at the sent place
      if (params.isError) {
        gotInitialResult = true;
        const message = (/** @type {Array<{ type?: string, text?: string }>} */ (params.content || [])).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
        showAppError('The tool could not open this view', new Error(message || 'No error details returned'));
      } else if (data && data.site && Array.isArray(data.site.sections)) { gotInitialResult = true; showDocsCard(data); }
      else if (data && data.space && data.space.handle) { gotInitialResult = true; showSpaceCard(data.space); }
      else if (data && data.share && data.share.id) { gotInitialResult = true; if (Array.isArray(data.labs)) state.labs = data.labs; showShareCard(data.share, data.rebloggers); }
      else if (data && data.clip && data.clip.data) { gotInitialResult = true; showClipCard(data.clip); }
      else if (data && data.highlights && Array.isArray(data.highlights.picks)) { gotInitialResult = true; showHighlightsCard(data.highlights); }
      else if (data && data.article) { gotInitialResult = true; showArticleCard(data.article, data.saved); }
      else if (data && data.profile && data.portals) { gotInitialResult = true; renderRoom(data); }
      else {
        gotInitialResult = true;
        showAppError('Could not display the tool result', new Error('The result has no supported view data'));
      }
    } else if (method === 'ui/notifications/host-context-changed') {
      applyHostContext(params);
    } else if (method === 'ui/notifications/tool-cancelled') {
      setStatus('Cancelled');
    }
  }

  /** @param {string} context @param {unknown} error */
  function showAppError(context, error) {
    gotInitialResult = true;
    toolRunning = false;
    console.error(`[mcportal] ${context}`, error);
    $('grid').hidden = true;
    $('welcome').hidden = true;
    const reader = $('reader');
    reader.hidden = false;
    reader.replaceChildren(el('div', { class: 'error', role: 'alert' }, `${context}: ${errorText(error)}. Ask your agent to open it again.`));
    setStatus('View failed');
  }

  /**
   * Call one of our tools (through the host, or straight to /mcp in /preview) and
   * return its result, typed by the server's contract (src/tools/results.ts).
   * A tool error rejects with its message.
   * @template {AppTool} K
   * @param {K} name
   * @param {Record<string, unknown>} [args]
   * @returns {Promise<ToolResult<K>>}
   */
  async function callTool(name, args = {}) {
    /** @type {any} */
    let result;
    if (DEV) {
      /** @type {Record<string, string>} */
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (devToken) headers.authorization = `Bearer ${devToken}`;
      const res = await fetch('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
      });
      if (res.status === 401) throw Object.assign(new Error('This server needs its access token'), { needsToken: true });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      result = json.result;
    } else {
      result = await hostRequest('tools/call', { name, arguments: args });
    }
    if (result && result.isError) {
      const text = (/** @type {Array<{ text?: string }>} */ (result.content || [])).map((c) => c.text).filter(Boolean).join(' ');
      throw new Error(text || `${name} failed`);
    }
    return result || {};
  }

  /** @param {string} url */
  function isHttpUrl(url) {
    try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
  }

  /** Open a link through the host (it may ask the user), or show it to copy. @param {string} url */
  async function openLink(url) {
    if (!isHttpUrl(url)) { toast("That link isn't a web address"); return; }
    if (DEV) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    try {
      const result = await hostRequest('ui/open-link', { url });
      if (result && result.isError) throw new Error('Link opening declined');
    } catch { showLinkFallback(url); }
  }

  /** @param {string} url */
  function showLinkFallback(url) {
    const fallback = el('div', { class: 'error', role: 'status', style: 'position:fixed;bottom:16px;left:16px;right:16px;z-index:100;padding:12px;background:var(--mp-surface-canvas);border:1px solid var(--mp-border-control);border-radius:var(--mp-radius-card)' }, 'Open this address in your browser: ',
      el('input', { value: url, readonly: true, 'aria-label': 'Original web address', onclick: (/** @type {MouseEvent} */ e) => /** @type {HTMLInputElement} */ (e.target).select() }),
      el('button', { class: 'btn', onclick: () => fallback.remove() }, 'Dismiss'));
    document.body.append(fallback);
  }

  /** The host's theme and display context (ui/initialize, host-context-changed). @param {Record<string, any> | undefined} ctx */
  function applyHostContext(ctx) {
    if (!ctx) return;
    theme.update(ctx);
    if (Array.isArray(ctx.availableDisplayModes)) canFullscreen = ctx.availableDisplayModes.includes('fullscreen');
    if (ctx.displayMode) setDisplayMode(ctx.displayMode);
    $('btnExpand').hidden = !canFullscreen;
  }

  /** @param {string} mode */
  function setDisplayMode(mode) {
    const changed = displayMode !== mode;
    displayMode = mode;
    root.classList.toggle('fullscreen', mode === 'fullscreen');
    if (mode === 'fullscreen') root.style.height = '';
    root.classList.toggle('framed', mode === 'fullscreen' || Boolean(DEV));
    const full = mode === 'fullscreen';
    $('btnExpand').replaceChildren(icon(full ? 'collapse' : 'expand'));
    $('btnExpand').title = full ? 'Exit fullscreen' : 'Fullscreen: step all the way through';
    $('btnExpand').setAttribute('aria-label', $('btnExpand').title);
    if (changed && state.profile?.layout === 'river') redrawRiver();   // its page size and loading differ by mode
  }

  // Tell the host how tall we are so the inline frame fits the content. Measure the
  // body, not documentElement.scrollHeight: that never drops below the frame's current
  // height, so the frame could grow (reader view) but never shrink back. Inline, the page's
  // own height is written too: a host has been reported to read it instead of the message
  // (claude-ai-mcp issue #69). Fullscreen, the host sizes the frame.
  let lastHeight = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let sizeTimer;
  new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      root.style.height = DEV || displayMode === 'fullscreen' ? '' : `${height}px`;
      if (Math.abs(height - lastHeight) > 2) { lastHeight = height; hostNotify('ui/notifications/size-changed', { width: Math.ceil(window.innerWidth), height }); }
    }, 60);
  }).observe(document.body);
