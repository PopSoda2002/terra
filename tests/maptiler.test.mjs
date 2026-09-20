import test from 'node:test';
import assert from 'node:assert/strict';
import { Tile } from '../lib/quadtree.mjs';
import { imageryBounds } from '../lib/imagery-tiles.mjs';
import {
  planMercator,
  mercatorY,
  tileURL,
  readMapTilerMetadata,
  maptilerError,
} from '../lib/maptiler-tiles.mjs';
import { SatelliteImagery, createMapTilerLoader } from '../lib/satellite.js';

test('XYZ mosaics cover wrapped longitude and Mercator latitude without mirroring', () => {
  for (const bounds of [
    { west: 179.9, south: -0.1, span: 0.2, height: 0.2 },
    { west: -180, south: -80, span: 360, height: 160 },
    { west: 116.399, south: 39.899, span: 0.002, height: 0.002 },
    { west: -1, south: 84.9, span: 2, height: 0.1 },
  ]) {
    const plan = planMercator(bounds);
    assert.ok(plan.parts.length > 0 && plan.parts.length <= 9);
    for (const part of plan.parts) {
      assert.ok(part.x >= 0 && part.x < 2 ** part.z);
      assert.ok(part.y >= 0 && part.y < 2 ** part.z);
    }
    for (const x of [0.1, 128, 256, 511.9])
      for (const y of [0.1, 128, 256, 511.9])
        assert.ok(
          plan.parts.some(
            (p) =>
              x >= p.dx &&
              x <= p.dx + p.width &&
              y >= p.dy &&
              y <= p.dy + p.height,
          ),
        );
    const vSouth =
      (1 - mercatorY(bounds.south) - plan.bounds.south) / plan.bounds.height;
    const vNorth =
      (1 - mercatorY(bounds.south + bounds.height) - plan.bounds.south) /
      plan.bounds.height;
    assert.ok(Math.abs(vSouth) < 1e-8 && Math.abs(vNorth - 1) < 1e-8);
  }
  const dateLine = planMercator({
    west: 179.9,
    south: 0,
    span: 0.2,
    height: 0.2,
  });
  assert.ok(dateLine.parts.some((p) => p.x === 0));
  assert.ok(dateLine.parts.some((p) => p.x === 2 ** p.z - 1));
  assert.ok(
    planMercator({ west: 116.399, south: 39.899, span: 0.002, height: 0.002 })
      .zoom >= 17,
  );
});

test('metadata uses the user key, falls back only for a missing dataset, and rejects foreign tile hosts', async () => {
  const calls = [];
  const metadata = await readMapTilerMetadata(
    'test-only-key',
    undefined,
    async (url) => {
      calls.push(url);
      return calls.length === 1
        ? { status: 404, ok: false }
        : {
            ok: true,
            json: async () => ({
              tiles: [
                'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=old',
              ],
              maxzoom: 22,
            }),
          };
    },
  );
  assert.equal(calls.length, 2);
  const url = new URL(
    tileURL(metadata.template, 'test-only-key', { z: 18, x: 1, y: 2 }),
  );
  assert.equal(url.searchParams.get('key'), 'test-only-key');
  assert.ok(url.pathname.endsWith('/18/1/2.jpg'));
  assert.throws(() =>
    tileURL('https://foreign.example/tiles/{z}/{x}/{y}', 'private-key', {
      z: 0,
      x: 0,
      y: 0,
    }),
  );
  let deniedCalls = 0;
  await assert.rejects(
    readMapTilerMetadata('test-only-key', undefined, async () => {
      deniedCalls++;
      return { ok: false, status: 403 };
    }),
    /API key/,
  );
  assert.equal(deniedCalls, 1);
});

test('quota errors pause queued imagery work and do not expose a key in status', async () => {
  let calls = 0;
  const cache = new SatelliteImagery(
    () => {},
    async () => {
      calls++;
      throw maptilerError(429);
    },
    128,
    { source: 'MapTiler Satellite', maxLevel: 16, resolutionMeters: 2 },
  );
  const leaf = new Tile(5, 17, 50000, 80000);
  cache.update([leaf]);
  await new Promise(setImmediate);
  cache.update([leaf]);
  await new Promise(setImmediate);
  assert.ok(calls <= 4);
  assert.match(cache.stats().paused, /额度/);
  assert.equal(cache.targets.get(leaf.id).level, 16);
  assert.equal(cache.stats().resolutionMeters, 2);
  cache.dispose();
});

test('the MapTiler loader shares XYZ requests and returns Mercator textures', async (t) => {
  const originals = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
  };
  t.after(() => Object.assign(globalThis, originals));
  let requests = 0,
    closed = 0;
  const draws = [];
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage: (...args) => draws.push(args) }),
    }),
  };
  globalThis.createImageBitmap = async () => ({
    close() {
      closed++;
    },
  });
  globalThis.fetch = async () => {
    requests++;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      blob: async () => new Blob(['fixture']),
    };
  };
  const loader = createMapTilerLoader('test-only-key', {
    template: 'https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}',
    maxZoom: 22,
    tileSize: 256,
  });
  const tile = new Tile(5, 15, 12000, 20000);
  const parts = planMercator(imageryBounds(tile)).parts.length;
  const assets = await Promise.all([
    loader(tile, new AbortController().signal),
    loader(tile, new AbortController().signal),
  ]);
  assert.equal(requests, parts);
  assert.equal(draws.length, parts * 2);
  assert.equal(closed, draws.length);
  assert.ok(assets.every((a) => a.projection === 2));
  assets.forEach((a) => a.dispose());
  loader.dispose();
});
