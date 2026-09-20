import test from 'node:test';
import assert from 'node:assert/strict';
import { Tile, cubePoint } from '../lib/quadtree.mjs';
import {
  ancestorTile,
  imageryBounds,
  imageryUV,
  imageryRequests,
  EOX_LAYER,
  EOX_WMS,
  MAX_IMAGE_LEVEL,
} from '../lib/imagery-tiles.mjs';
import { SatelliteImagery } from '../lib/satellite.js';

test('image bounds cover every cube face, including date-line and polar patches', () => {
  for (let face = 0; face < 6; face++)
    for (let level = 0; level <= 3; level++)
      for (let y = 0; y < 2 ** level; y++)
        for (let x = 0; x < 2 ** level; x++) {
          const tile = new Tile(face, level, x, y),
            bounds = imageryBounds(tile);
          for (let row = 0; row <= 8; row++)
            for (let col = 0; col <= 8; col++) {
              const point = cubePoint(
                face,
                tile.u + (tile.size * col) / 8,
                tile.v + (tile.size * row) / 8,
              );
              const [u, v] = imageryUV(point, bounds);
              if (Math.abs(point[1]) < 0.999999999)
                assert.ok(
                  u >= -1e-8 && u <= 1 + 1e-8,
                  `${tile.id}: longitude outside image (${u})`,
                );
              assert.ok(
                v >= -1e-8 && v <= 1 + 1e-8,
                `${tile.id}: latitude outside image (${v})`,
              );
            }
        }
});

test('date-line images split into legal WMS requests with continuous pixel coverage', () => {
  const bounds = imageryBounds(new Tile(1));
  const requests = imageryRequests(bounds);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].x, 0);
  assert.equal(requests[1].x, requests[0].width);
  assert.equal(
    requests.reduce((n, p) => n + p.width, 0),
    512,
  );
  for (const piece of requests) {
    const u = new URL(piece.url),
      b = u.searchParams.get('BBOX').split(',').map(Number);
    assert.equal(u.origin + u.pathname, EOX_WMS);
    assert.equal(u.searchParams.get('LAYERS'), EOX_LAYER);
    assert.equal(u.searchParams.get('VERSION'), '1.1.1');
    assert.ok(b[0] >= -180 && b[2] <= 180 && b[0] < b[2]);
    assert.ok(b[1] >= -90 && b[3] <= 90 && b[1] < b[3]);
  }
  assert.equal(ancestorTile(new Tile(4, 8, 230, 120), 6).id, 'F5/L6/57/30');
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
test('city imagery reaches the new source resolution and deeper patches stay inside their image', async () => {
  const cache = new SatelliteImagery(
    () => {},
    async (tile) => ({ bounds: imageryBounds(tile), dispose() {} }),
  );
  try {
    const leaf = new Tile(5, 14, 7000, 12000);
    cache.update([leaf]);
    await flush();
    await flush();
    cache.update([leaf]);
    const image = cache.resolve(leaf);
    assert.equal(image.tile.level, MAX_IMAGE_LEVEL);
    assert.ok((image.asset.bounds.height * 111195) / 512 < 10);
    assert.equal(cache.stats().resolutionMeters, 10);
    assert.equal(cache.stats().ready, 1);
    for (const level of [8, 12, 14]) {
      const size = 2 ** level;
      for (let face = 0; face < 6; face++)
        for (const x of [0, size / 2 - 1, size / 2, size - 1])
          for (const y of [0, size / 2 - 1, size / 2, size - 1]) {
            const tile = new Tile(face, level, x, y),
              bounds = imageryBounds(tile);
            for (const a of [0, 0.5, 1])
              for (const b of [0, 0.5, 1]) {
                const point = cubePoint(
                  face,
                  tile.u + a * tile.size,
                  tile.v + b * tile.size,
                );
                const [u, v] = imageryUV(point, bounds);
                if (Math.abs(point[1]) < 0.999999999)
                  assert.ok(u >= -1e-8 && u <= 1 + 1e-8, tile.id);
                assert.ok(v >= -1e-8 && v <= 1 + 1e-8, tile.id);
              }
          }
    }
  } finally {
    cache.dispose();
  }
});

test('coarse image remains visible until detail arrives and loading is bounded', async () => {
  const jobs = [];
  const cache = new SatelliteImagery(
    () => {},
    (tile, signal) =>
      new Promise((resolve, reject) => {
        jobs.push({ tile, resolve });
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  try {
    const leaf = new Tile(4, 7, 50, 50);
    cache.update([leaf]);
    await flush();
    assert.ok(jobs.length <= 4);
    assert.equal(cache.resolve(leaf), null);
    const root = jobs.find((j) => j.tile.level === 0);
    root.resolve({ bounds: imageryBounds(root.tile), dispose() {} });
    await flush();
    cache.update([leaf]);
    assert.equal(cache.resolve(leaf).tile.level, 0);
    const detailed = jobs.find((j) => j.tile.level === 6);
    detailed.resolve({ bounds: imageryBounds(detailed.tile), dispose() {} });
    await flush();
    cache.update([leaf]);
    assert.equal(cache.resolve(leaf).tile.level, 6);
    assert.equal(cache.stats().ready, 1);
  } finally {
    cache.dispose();
    await flush();
  }
});

test('load failures keep the coarse image and retries recover', async () => {
  let fail = true;
  const cache = new SatelliteImagery(
    () => {},
    async (tile) => {
      if (tile.level > 0 && fail) throw new Error('offline');
      return { bounds: imageryBounds(tile), dispose() {} };
    },
  );
  try {
    const leaf = new Tile(4, 3, 4, 4);
    cache.update([leaf]);
    await flush();
    await flush();
    cache.update([leaf]);
    assert.equal(cache.resolve(leaf).tile.level, 0);
    assert.ok(cache.stats().failed > 0);
    fail = false;
    cache.retry();
    cache.update([leaf]);
    await flush();
    await flush();
    cache.update([leaf]);
    assert.equal(cache.stats().ready, 1);
    assert.equal(cache.stats().failed, 0);
    assert.equal(cache.resolve(leaf).tile.level, 2);
  } finally {
    cache.dispose();
  }
});

test('pinned visible textures survive LRU eviction and all assets are disposed', async () => {
  let freed = 0;
  const cache = new SatelliteImagery(
    () => {},
    async (tile) => ({
      bounds: imageryBounds(tile),
      dispose() {
        freed++;
      },
    }),
    2,
  );
  for (const leaf of [new Tile(4, 3, 1, 1), new Tile(0, 3, 6, 6)]) {
    cache.update([leaf]);
    await flush();
    await flush();
    cache.update([leaf]);
    assert.equal(cache.resolve(leaf).tile.level, 2);
    assert.ok(cache.stats().cached <= 2);
  }
  assert.ok(freed > 0);
  cache.dispose();
  assert.equal(cache.entries.size, 0);
});
