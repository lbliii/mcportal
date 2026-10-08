/**
 * Headless Chrome for UI tests, driven over the DevTools protocol with Node's own
 * WebSocket: no Playwright or Puppeteer to install. Finds Chrome via CHROME_PATH,
 * the usual install locations, or PATH; findChrome() is undefined when there's none,
 * and tests skip.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChrome(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return CANDIDATES.find((p) => existsSync(p));
}

/** Something the page logged as an error, or threw without catching. */
export interface PageProblem {
  kind: 'exception' | 'console';
  text: string;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

/** One page in a fresh headless Chrome. */
export class Page {
  /** Uncaught exceptions and console.error/warn calls, in order. */
  readonly problems: PageProblem[] = [];
  private ws: WebSocket;
  private session: string;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private chrome: ChildProcess;
  private profileDir: string;

  private constructor(chrome: ChildProcess, profileDir: string, ws: WebSocket, session: string) {
    this.chrome = chrome;
    this.profileDir = profileDir;
    this.ws = ws;
    this.session = session;
  }

  /** `args`: extra Chrome flags, e.g. --host-resolver-rules to keep a test from reaching real sites. */
  static async open(chromePath: string, viewport = { width: 1280, height: 900 }, args: string[] = []): Promise<Page> {
    const profileDir = await mkdtemp(path.join(tmpdir(), 'mcportal-chrome-'));
    const chrome = spawn(chromePath, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-extensions', '--disable-background-networking', `--window-size=${viewport.width},${viewport.height}`, ...args, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise<string>((resolve, reject) => {
      let buffered = '';
      const timer = setTimeout(() => reject(new Error(`Chrome didn't start: ${buffered.slice(-500)}`)), 15_000);
      chrome.stderr!.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        const match = buffered.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]!); }
      });
      chrome.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${buffered.slice(-500)}`)); });
    });
    const ws = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('Could not connect to Chrome')); });
    const page = new Page(chrome, profileDir, ws, '');
    ws.onmessage = (event) => page.receive(JSON.parse(String(event.data)));
    const { targetId } = await page.send('Target.createTarget', { url: 'about:blank' }, false);
    const { sessionId } = await page.send('Target.attachToTarget', { targetId, flatten: true }, false);
    page.session = sessionId;
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    // The attached target is separate from Chrome's initial blank tab. Give it
    // foreground focus so native keyboard and pointer input reaches this page
    // consistently on headless Linux as well as macOS.
    await page.send('Page.bringToFront');
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  private receive(msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: any; sessionId?: string }): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.sessionId !== this.session) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.problems.push({ kind: 'exception', text: d.exception?.description ?? d.text });
    } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      this.problems.push({ kind: 'console', text: msg.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ') });
    }
  }

  /** A DevTools protocol command on this page (or on the browser, with `onPage` false). */
  send(method: string, params: Record<string, unknown> = {}, onPage = true): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(onPage ? { sessionId: this.session } : {}) }));
    });
  }

  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => {
      const previous = this.ws.onmessage;
      this.ws.onmessage = (event) => {
        previous?.call(this.ws, event);
        const msg = JSON.parse(String(event.data));
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === this.session) { this.ws.onmessage = previous; resolve(); }
      };
    });
    await this.send('Page.navigate', { url });
    await loaded;
  }

  /** Evaluate an expression (awaiting a promise) and return its value, which must be JSON. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`In the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value as T;
  }

  /** Wait until `expression` is truthy in the page; returns its value. */
  async waitFor<T = unknown>(expression: string, what: string, timeoutMs = 10_000): Promise<T> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.eval<T>(expression).catch(() => undefined);
      if (value) return value;
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}${this.problems.length ? `; page problems: ${JSON.stringify(this.problems)}` : ''}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Click the first element matching `selector`, the way a user would (a real mouse event at its center). */
  async click(selector: string): Promise<void> {
    // Only when the point really hits it (not hidden, covered or in a closed <details>).
    const box = await this.waitFor<{ x: number; y: number }>(`(() => {
      const n = document.querySelector(${JSON.stringify(selector)});
      if (!n) return null;
      n.scrollIntoView({ block: 'center', inline: 'center' });
      const r = n.getBoundingClientRect();
      const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const hit = r.width && r.height ? document.elementFromPoint(point.x, point.y) : null;
      return hit && (hit === n || n.contains(hit)) ? point : null;
    })()`, `a clickable ${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }

  async close(): Promise<void> {
    // Chrome can exit before acknowledging Browser.close. Bound that wait so an
    // otherwise passing browser test cannot leave its server and worker running.
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.send('Browser.close', {}, false), new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, 3000); })]);
    } catch { /* already gone */ }
    finally { clearTimeout(closeTimer); }
    this.ws.close();
    if (this.chrome.exitCode === null) await new Promise((r) => { this.chrome.once('exit', r); setTimeout(r, 3000); });
    this.chrome.kill('SIGKILL');
    await rm(this.profileDir, { recursive: true, force: true });
  }
}
