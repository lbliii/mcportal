import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const DATA = 'data:image/png;base64,iVBORw0KGgo=';
const source = await readFile(new URL('../src/ui/room/room.js', import.meta.url), 'utf8');
const picturesSource = source.slice(source.indexOf('  /** @type {Map<string, string>} */'), source.indexOf('  // Each portal gets its own fallback'));

class Picture {
  isConnected = false;
  inReader = false;
  tagName = 'DIV';
  dataset: { img: string };
  classes = new Set<string>();
  classList = { add: (s: string) => this.classes.add(s), remove: (s: string) => this.classes.delete(s), contains: (s: string) => this.classes.has(s) };
  img = { src: '', classList: { add: (_s: string) => {} } };
  constructor(url: string) { this.dataset = { img: url }; }
}
type Images = Record<string, string | null>;
type Entry = { target: Picture; isIntersecting: boolean };

/** Run the actual browser fragment with controllable visibility, DOM removal and time. */
function harness(fetchImages: (urls: string[]) => Promise<Images>) {
  let now = 0, timerId = 0;
  const timers = new Map<number, { at: number; run: () => unknown }>();
  const observers: Observer[] = [];
  const mutations: (() => void)[] = [];
  const calls: string[][] = [];
  const reader = { contains: (node: Picture) => node.isConnected && node.inReader };
  class Observer {
    nodes = new Set<Picture>();
    callback: (entries: Entry[]) => void;
    options: { root?: object; rootMargin: string };
    constructor(callback: (entries: Entry[]) => void, options: { root?: object; rootMargin: string }) { this.callback = callback; this.options = options; observers.push(this); }
    observe(node: Picture) { this.nodes.add(node); }
    unobserve(node: Picture) { this.nodes.delete(node); }
    emit(node: Picture, isIntersecting = true) { this.callback([{ target: node, isIntersecting }]); }
  }
  const api = vm.runInNewContext(`${picturesSource}; ({ watchPicture, primePictures, watches: pictureWatches, pictures })`, {
    root: {},
    $: () => reader,
    $first: (_selector: string, node: Picture) => node.img,
    $$: (_selector: string, nodes: Picture[]) => nodes,
    IntersectionObserver: Observer,
    MutationObserver: class { constructor(callback: () => void) { mutations.push(callback); } observe() {} },
    clearTimeout: (id: number) => timers.delete(id),
    setTimeout: (run: () => unknown, delay: number) => { timers.set(++timerId, { at: now + delay, run }); return timerId; },
    Date: { now: () => now },
    callTool: async (_name: string, args: { urls: string[] }) => { calls.push(Array.from(args.urls)); return { structuredContent: { images: await fetchImages(Array.from(args.urls)) } }; },
  }) as { watchPicture: (node: Picture) => Picture; primePictures: (nodes: Picture[], count?: number) => void; watches: Map<Picture, unknown>; pictures: Map<string, string> };
  const mutate = () => mutations.forEach((m) => m());
  function attach(url: string, inReader = true) {
    const node = api.watchPicture(new Picture(url));
    node.isConnected = true; node.inReader = inReader; mutate();
    return node;
  }
  async function next() {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
    assert.ok(timer && id !== undefined, 'a picture load is scheduled');
    timers.delete(id); now = timer.at;
    await timer.run();
  }
  return { ...api, observers, calls, timers, mutate, attach, next, reader };
}

test('reader pictures bind to the article scroller after insertion and preload only its near-visible figures', async () => {
  const h = harness(async (urls) => Object.fromEntries(urls.map((u) => [u, DATA])));
  const detached = h.watchPicture(new Picture('https://images.example.com/near.png'));
  assert.ok(h.observers[0]!.nodes.has(detached));
  detached.isConnected = true; detached.inReader = true; h.mutate();
  assert.equal(h.observers[0]!.nodes.size, 0);
  assert.ok(h.observers[1]!.nodes.has(detached));
  assert.equal(h.observers[1]!.options.root, h.reader);
  assert.equal(h.observers[1]!.options.rootMargin, '200px');
  const far = h.attach('https://images.example.com/far.png');
  h.observers[1]!.emit(far, false);
  h.observers[1]!.emit(detached);
  await h.next();
  assert.deepEqual(h.calls, [[detached.dataset.img]]);
  assert.equal(detached.img.src, DATA);
  assert.equal(far.img.src, '');
  h.observers[1]!.emit(far);
  await h.next();
  assert.equal(far.img.src, DATA);
  assert.equal(h.watches.size, 0);
});

test('picture requests deduplicate URLs, serialize 24-image batches and bound the positive browser cache', async () => {
  const h = harness(async (urls) => Object.fromEntries(urls.map((u) => [u, DATA])));
  const nodes = Array.from({ length: 80 }, (_, i) => h.attach(`https://images.example.com/${i}.png`, false));
  nodes.push(h.attach(nodes[0]!.dataset.img, false));
  nodes.forEach((n) => h.observers[0]!.emit(n));
  await h.next(); await h.next(); await h.next(); await h.next();
  assert.deepEqual(h.calls.map((c) => c.length), [24, 24, 24, 8]);
  assert.equal(new Set(h.calls.flat()).size, 80);
  assert.equal(h.pictures.size, 64);
  assert.ok(nodes.every((n) => n.img.src === DATA));
  assert.equal(h.timers.size, 0);
});

test('navigation prunes queued and observed nodes and stale responses never modify detached or replacement figures', async () => {
  let release!: (images: Images) => void;
  const h = harness(() => new Promise<Images>((resolve) => { release = resolve; }));
  const queued = h.attach('https://images.example.com/queued.png');
  h.observers[1]!.emit(queued);
  queued.isConnected = false; h.mutate();
  assert.equal(h.watches.size, 0);
  assert.equal(h.observers[1]!.nodes.size, 0);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, []);
  const old = h.attach('https://images.example.com/old.png');
  h.observers[1]!.emit(old);
  const pending = h.next();
  old.isConnected = false; h.mutate();
  const replacement = h.attach('https://images.example.com/replacement.png');
  release({ [old.dataset.img]: DATA }); await pending;
  assert.equal(old.img.src, '');
  assert.equal(replacement.img.src, '');
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.watches.size, 1, 'only the replacement remains observed');
});

test('transient nulls recover once while permanent failures stop after two attempts and can recover on a later opening', async () => {
  let available = false;
  const h = harness(async (urls) => Object.fromEntries(urls.map((u) => [u, available ? DATA : null])));
  const transient = h.attach('https://images.example.com/transient.png');
  h.observers[1]!.emit(transient); await h.next();
  available = true; await h.next();
  assert.equal(transient.img.src, DATA);
  assert.equal(h.calls.length, 2);
  available = false;
  const permanent = h.attach('https://images.example.com/missing.png');
  h.observers[1]!.emit(permanent); await h.next(); await h.next();
  assert.equal(h.calls.length, 4);
  assert.equal(h.timers.size, 0);
  h.observers[1]!.emit(permanent, false); h.observers[1]!.emit(permanent);
  assert.equal(h.timers.size, 0, 'scrolling cannot create an unbounded retry loop');
  permanent.isConnected = false; h.mutate(); available = true;
  const reopened = h.attach(permanent.dataset.img);
  h.observers[1]!.emit(reopened); await h.next();
  assert.equal(reopened.img.src, DATA, 'a failure is not memoized for the life of the app');
});

test('leaving the viewport during a pending failure prevents a background retry', async () => {
  let release!: (images: Images) => void;
  const h = harness(() => new Promise<Images>((resolve) => { release = resolve; }));
  const node = h.attach('https://images.example.com/leaving.png');
  h.observers[1]!.emit(node); const pending = h.next();
  h.observers[1]!.emit(node, false); release({ [node.dataset.img]: null }); await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('host results cannot put publisher URLs or SVGs into browser image sources', async () => {
  const h = harness(async (urls) => ({ [urls[0]!]: 'https://publisher.example.com/tracker.png', [urls[1]!]: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  const nodes = [h.attach('https://images.example.com/a.png'), h.attach('https://images.example.com/b.png')];
  nodes.forEach((n) => h.observers[1]!.emit(n));
  await h.next(); await h.next();
  assert.ok(nodes.every((n) => !n.img.src));
  assert.equal(h.timers.size, 0);
  assert.equal(h.pictures.size, 0);
});


test('an interrupted tool request can recover and an empty image reply cannot stall the queue', async () => {
  let calls = 0;
  const h = harness(async (urls) => {
    calls++;
    if (calls === 1) throw new Error('temporary bridge failure');
    if (calls === 2) return undefined as unknown as Images;
    return Object.fromEntries(urls.map((u) => [u, DATA]));
  });
  const failed = h.attach('https://images.example.com/bridge.png');
  h.observers[1]!.emit(failed); await h.next(); await h.next();
  assert.equal(h.timers.size, 0);
  assert.equal(h.watches.size, 0, 'failed observations are released when retries are exhausted');
  const next = h.attach('https://images.example.com/next.png');
  h.observers[1]!.emit(next); await h.next();
  assert.equal(next.img.src, DATA);
  assert.equal(h.calls.length, 3);
});
