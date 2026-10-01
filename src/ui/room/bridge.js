  // room/bridge.js: host bridge: JSON-RPC over postMessage, host requests/notifications, tool calls, display mode
  // ------------------------------------------------------------ host bridge (MCP Apps, postMessage JSON-RPC)
  const pending = new Map();
  let nextId = 1;
  let displayMode = 'inline';
  let canFullscreen = false;
  let hostCapabilities = {};
  let gotInitialResult = false;
  let toolRunning = false;
  // /preview with a static token: the user pastes it once; it lives only in this tab.
  let devToken = null;
  try { devToken = DEV && DEV.needsToken ? sessionStorage.getItem('mcportal-token') : null; } catch { devToken = null; }
  let loading = null;
  let articleUrl = null;   // set when this view belongs to a read_article call (a reader card)
  let spaceHandle = null;  // set when this view belongs to an open_space call; '' for your own
  let clipId = null;       // set when this view belongs to a get_clip or get_share call (a card); share ids start with "s"

  function hostRequest(method, params, timeoutMs = 30000) {
    const capability = { 'tools/call': 'serverTools', 'ui/open-link': 'openLinks', 'ui/message': 'message', 'ui/update-model-context': 'updateModelContext' }[method];
    if (capability && !hostCapabilities[capability]) return Promise.reject(new Error(`This host does not support ${method}. Ask your agent to perform this action.`));
    if (method === 'ui/request-display-mode' && !canFullscreen) return Promise.reject(new Error('Fullscreen is not available here'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
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
      if (params.isError) {
        gotInitialResult = true;
        const message = (params.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
        showAppError('The tool could not open this view', new Error(message || 'No error details returned'));
      } else if (data && data.site && Array.isArray(data.site.sections)) { gotInitialResult = true; showDocsCard(data); }
      else if (data && data.space && data.space.handle) { gotInitialResult = true; showSpaceCard(data.space); }
      else if (data && data.share && data.share.id) { gotInitialResult = true; showShareCard(data.share); }
      else if (data && data.clip && data.clip.data) { gotInitialResult = true; showClipCard(data.clip); }
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

  function showAppError(context, error) {
    gotInitialResult = true;
    toolRunning = false;
    console.error(`[mcportal] ${context}`, error);
    $('grid').hidden = true;
    $('welcome').hidden = true;
    const reader = $('reader');
    reader.hidden = false;
    reader.replaceChildren(el('div', { class: 'error', role: 'alert' }, `${context}: ${error.message || String(error)}. Ask your agent to open it again.`));
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
      const text = (result.content || []).map((c) => c.text).filter(Boolean).join(' ');
      throw new Error(text || `${name} failed`);
    }
    return result || {};
  }

  function isHttpUrl(url) {
    try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
  }

  async function openLink(url) {
    if (!isHttpUrl(url)) { toast("That link isn't a web address"); return; }
    if (DEV) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    try {
      const result = await hostRequest('ui/open-link', { url });
      if (result && result.isError) throw new Error('Link opening declined');
    } catch { showLinkFallback(url); }
  }

  function showLinkFallback(url) {
    const fallback = el('div', { class: 'error', role: 'status', style: 'position:fixed;bottom:16px;left:16px;right:16px;z-index:100;padding:12px;background:var(--mp-surface-canvas);border:1px solid var(--mp-border-control);border-radius:var(--mp-radius-card)' }, 'Open this address in your browser: ',
      el('input', { value: url, readonly: true, 'aria-label': 'Original web address', onclick: (e) => e.target.select() }),
      el('button', { class: 'btn', onclick: () => fallback.remove() }, 'Dismiss'));
    document.body.append(fallback);
  }

  function applyHostContext(ctx) {
    if (!ctx) return;
    theme.update(ctx);
    if (Array.isArray(ctx.availableDisplayModes)) canFullscreen = ctx.availableDisplayModes.includes('fullscreen');
    if (ctx.displayMode) setDisplayMode(ctx.displayMode);
    $('btnExpand').hidden = !canFullscreen;
  }

  function setDisplayMode(mode) {
    displayMode = mode;
    root.classList.toggle('fullscreen', mode === 'fullscreen');
    root.classList.toggle('framed', mode === 'fullscreen' || Boolean(DEV));
    const full = mode === 'fullscreen';
    $('btnExpand').replaceChildren(icon(full ? 'collapse' : 'expand'));
    $('btnExpand').title = full ? 'Exit fullscreen' : 'Fullscreen: step all the way through';
    $('btnExpand').setAttribute('aria-label', $('btnExpand').title);
  }

  // Tell the host how tall we are so the inline frame fits the content. Measure the
  // body, not documentElement.scrollHeight: that never drops below the frame's current
  // height, so the frame could grow (reader view) but never shrink back.
  let lastHeight = 0, sizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      if (Math.abs(height - lastHeight) > 2) { lastHeight = height; hostNotify('ui/notifications/size-changed', { width: Math.ceil(window.innerWidth), height }); }
    }, 60);
  }).observe(document.body);
