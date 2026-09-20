import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { geographicPoint, geographicCoordinates } from '../lib/geography.mjs';

test('north-up views put east to the right and north above, including near the date line', () => {
  for (const [lat, lon] of [
    [0, 0],
    [39.9, 116.4],
    [-33.9, 151.2],
    [20, 179],
    [-20, -179],
  ]) {
    const camera = new PerspectiveCamera(42, 1, 0.001, 30);
    camera.position.fromArray(geographicPoint(lat, lon, 3));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const screen = (a, b) =>
      new Vector3(...geographicPoint(a, b)).project(camera);
    const center = screen(lat, lon);
    assert.ok(
      screen(lat, lon + 2).x > center.x,
      `east appears right at ${lat},${lon}`,
    );
    assert.ok(
      screen(lat, lon - 2).x < center.x,
      `west appears left at ${lat},${lon}`,
    );
    assert.ok(screen(lat + 2, lon).y > center.y, 'north appears above');
  }
});

test('camera coordinates round-trip across hemispheres and altitude changes', () => {
  for (const lat of [-80, -35, 0, 39.9, 80])
    for (const lon of [-179, -90, 0, 116.4, 179])
      for (const radius of [1, 1.01, 4]) {
        const actual = geographicCoordinates(geographicPoint(lat, lon, radius));
        assert.ok(Math.abs(actual.lat - lat) < 1e-9);
        assert.ok(Math.abs(actual.lon - lon) < 1e-9);
      }
});
