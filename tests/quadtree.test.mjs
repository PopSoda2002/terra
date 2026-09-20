import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geographicPoint } from '../lib/geography.mjs';
import {
  Tile,
  cubePoint,
  faceUV,
  selectTiles,
  normalize,
  dot,
  MAX_LEVEL,
  EARTH_KM,
  MIN_ALTITUDE_KM,
} from '../lib/quadtree.mjs';
const roots = () => Array.from({ length: 6 }, (_, i) => new Tile(i));
test('cube face projection is normalized and reverses correctly', () => {
  for (let f = 0; f < 6; f++)
    for (const u of [-0.9, -0.3, 0.2, 0.9])
      for (const v of [-0.8, 0.1, 0.8]) {
        const p = cubePoint(f, u, v);
        assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-12);
        const back = faceUV(p);
        assert.equal(back.face, f);
        assert.ok(Math.abs(back.u - u) < 1e-12);
        assert.ok(Math.abs(back.v - v) < 1e-12);
      }
});
test('four children exactly partition their parent, with stable addresses', () => {
  const p = new Tile(2, 4, 5, 8),
    c = p.split();
  assert.equal(new Set(c.map((t) => t.id)).size, 4);
  assert.equal(
    c.reduce((a, t) => a + t.size ** 2, 0),
    p.size ** 2,
  );
  assert.ok(
    c.every(
      (t) =>
        t.u >= p.u &&
        t.u + t.size <= p.u + p.size &&
        t.v >= p.v &&
        t.v + t.size <= p.v + p.size,
    ),
  );
  assert.equal(p.split(), c);
});
test('approaching refines; retreating coarsens; no parent and child drawn together', () => {
  const tree = roots(),
    far = selectTiles(tree, [0, 0, 4], 900, 120),
    near = selectTiles(tree, [0, 0, 1.02], 900, 120, () => true, far.split),
    back = selectTiles(tree, [0, 0, 4], 900, 120, () => true, near.split);
  assert.ok(
    Math.max(...near.leaves.map((t) => t.level)) >
      Math.max(...far.leaves.map((t) => t.level)),
  );
  assert.ok(back.leaves.length < near.leaves.length);
  for (const a of near.leaves)
    for (const b of near.leaves) {
      if (a === b || a.face !== b.face) continue;
      const overlap =
        Math.min(a.u + a.size, b.u + b.size) - Math.max(a.u, b.u) > 1e-9 &&
        Math.min(a.v + a.size, b.v + b.size) - Math.max(a.v, b.v) > 1e-9;
      assert.equal(overlap, false);
    }
  assert.ok(near.leaves.every((t) => t.level <= MAX_LEVEL));
});
test('visible surface samples stay covered across camera directions and heights', () => {
  for (const direction of [
    [0, 0, 1],
    [1, 0, 0],
    [1, 1, 1],
    [-0.3, 0.6, -1],
  ])
    for (const height of [0.008, 0.1, 2]) {
      const dir = normalize(direction),
        distance = 1 + height,
        result = selectTiles(
          roots(),
          dir.map((v) => v * distance),
          700,
          130,
        );
      for (let f = 0; f < 6; f++)
        for (let x = 0; x < 16; x++)
          for (let y = 0; y < 16; y++) {
            const u = -1 + (x + 0.5) / 8,
              v = -1 + (y + 0.5) / 8,
              p = cubePoint(f, u, v);
            if (dot(dir, p) < 1 / distance) continue;
            assert.ok(
              result.leaves.some(
                (t) =>
                  t.face === f &&
                  u >= t.u &&
                  u <= t.u + t.size &&
                  v >= t.v &&
                  v <= t.v + t.size,
              ),
            );
          }
    }
});
test('viewport culling can eliminate all nodes and higher detail increases workload', () => {
  assert.equal(
    selectTiles(roots(), [0, 0, 3], 700, 100, () => false).leaves.length,
    0,
  );
  const low = selectTiles(roots(), [0, 0, 3], 700, 260),
    high = selectTiles(roots(), [0, 0, 3], 700, 50);
  assert.ok(high.leaves.length > low.leaves.length);
});

test('500 m city views have bounded visible tiles and no coverage gaps', () => {
  for (const [lat, lon] of [
    [39.9, 116.4],
    [0, 179.999],
    [89.99, 0],
  ]) {
    const camera = new THREE.PerspectiveCamera(42, 1.5, 0.000005, 30);
    camera.position.fromArray(
      geographicPoint(lat, lon, 1 + MIN_ALTITUDE_KM / EARTH_KM),
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const result = selectTiles(
      roots(),
      camera.position.toArray(),
      800,
      120,
      (tile) =>
        frustum.intersectsSphere(
          new THREE.Sphere(new THREE.Vector3(...tile.center), tile.radius),
        ),
    );
    assert.ok(result.leaves.some((t) => t.level >= 12));
    assert.ok(result.leaves.length < 1000);
    assert.ok(result.leaves.every((t) => t.level <= MAX_LEVEL));
    const ray = new THREE.Raycaster(),
      sphere = new THREE.Sphere(new THREE.Vector3(), 1);
    for (let x = -1; x <= 1; x += 0.25)
      for (let y = -1; y <= 1; y += 0.25) {
        ray.setFromCamera(new THREE.Vector2(x, y), camera);
        const point = ray.ray.intersectSphere(sphere, new THREE.Vector3());
        assert.ok(point);
        const uv = faceUV(point.toArray());
        assert.ok(
          result.leaves.some(
            (t) =>
              t.face === uv.face &&
              uv.u >= t.u - 1e-9 &&
              uv.u <= t.u + t.size + 1e-9 &&
              uv.v >= t.v - 1e-9 &&
              uv.v <= t.v + t.size + 1e-9,
          ),
        );
      }
  }
});
