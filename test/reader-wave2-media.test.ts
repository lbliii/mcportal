import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { BoundaryError } from '../src/lib/safe-fetch.ts';
import { thumbnail } from '../src/thumbnails.ts';
import { MAX_THUMB_BYTES, type Fetcher } from '../src/types.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const URL = 'https://images.example.com/picture.png';
const image = (url: string, bytes = PNG, truncated = false) => ({ status: 200, url, contentType: 'image/png', text: bytes.toString('base64'), truncated });

test('image timeouts, 429s and 5xx remain recoverable while blocked, missing and non-raster pictures are cached safely', async () => {
  for (const failure of ['timeout', '429', '503', 'blocked', '404', 'svg']) {
    let recovering = false, calls = 0;
    const fetcher: Fetcher = async (url, options) => {
      calls++;
      assert.equal(options?.binary, true);
      assert.equal(options?.maxBytes, MAX_THUMB_BYTES);
      assert.equal(options?.timeoutMs, 6000);
      assert.doesNotMatch(options?.headers?.accept ?? '', /svg|avif/);
      if (recovering) return image(url);
      if (failure === 'timeout' || failure === 'blocked') throw new BoundaryError(failure, failure === 'timeout' ? 'fetch_timeout' : 'fetch_blocked');
      if (failure === 'svg') return image(url, Buffer.from('<svg><script>evil()</script></svg>'));
      return { ...image(url), status: Number(failure) };
    };
    const deps = { fetcher, cache: new TtlCache() };
    assert.equal(await thumbnail(URL, deps), null);
    recovering = true;
    const transient = ['timeout', '429', '503'].includes(failure);
    assert.equal(await thumbnail(URL, deps), transient ? `data:image/png;base64,${PNG.toString('base64')}` : null);
    assert.equal(calls, transient ? 2 : 1, failure);
  }
});

test('truncated or oversized binary results never bypass the image byte cap and safely try the existing smaller rendition', async () => {
  for (const truncated of [true, false]) {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      if (!url.includes('?w=480')) return image(url, truncated ? PNG : Buffer.concat([PNG, Buffer.alloc(MAX_THUMB_BYTES)]), truncated);
      return image(url);
    };
    assert.equal(await thumbnail(URL, { fetcher, cache: new TtlCache() }), `data:image/png;base64,${PNG.toString('base64')}`);
    assert.deepEqual(calls, [URL, `${URL}?w=480`]);
  }
});
