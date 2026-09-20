// Six root faces; each tile splits into four children. Units: Earth radii.
export const MAX_LEVEL = 17;
export const EARTH_KM = 6371;
export const MIN_ALTITUDE_KM = 0.5;
export const MAX_ALTITUDE_KM = 24000;
export const COLORS = [
  0x5d7189, 0x689ccc, 0x5bbed8, 0x5cd6bb, 0xa4db88, 0xe1d67d, 0xe6ad69,
  0xe78068, 0xd880b0, 0xbe8edc, 0x9f9bea, 0x80b4ed, 0x68d5dc, 0x89e1b6,
  0xd4e992, 0xefcf86, 0xecaa93, 0xd99cce,
];
export const normalize = (p) => {
  const r = Math.hypot(...p);
  return p.map((v) => v / r);
};
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function cubePoint(face, u, v) {
  return normalize(
    [
      [1, v, -u],
      [-1, v, u],
      [u, 1, -v],
      [u, -1, v],
      [u, v, 1],
      [-u, v, -1],
    ][face],
  );
}
export function faceUV(p) {
  const [x, y, z] = p,
    a = p.map(Math.abs),
    max = Math.max(...a);
  if (a[0] === max)
    return x > 0
      ? { face: 0, u: -z / max, v: y / max }
      : { face: 1, u: z / max, v: y / max };
  if (a[1] === max)
    return y > 0
      ? { face: 2, u: x / max, v: -z / max }
      : { face: 3, u: x / max, v: z / max };
  return z > 0
    ? { face: 4, u: x / max, v: y / max }
    : { face: 5, u: -x / max, v: y / max };
}
export class Tile {
  constructor(face, level = 0, x = 0, y = 0) {
    Object.assign(this, { face, level, x, y });
    this.id = `F${face + 1}/L${level}/${x}/${y}`;
    this.size = 2 / 2 ** level;
    this.u = -1 + x * this.size;
    this.v = -1 + y * this.size;
    this.center = cubePoint(
      face,
      this.u + this.size / 2,
      this.v + this.size / 2,
    );
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([a, b]) =>
      cubePoint(face, this.u + a * this.size, this.v + b * this.size),
    );
    this.angle =
      Math.max(
        ...corners.map((p) =>
          Math.acos(Math.min(1, Math.max(-1, dot(p, this.center)))),
        ),
      ) + 0.00001;
    this.radius = 2 * Math.sin(this.angle / 2);
    this.children = null;
  }
  split() {
    if (!this.children)
      this.children = [0, 1, 2, 3].map(
        (i) =>
          new Tile(
            this.face,
            this.level + 1,
            this.x * 2 + (i % 2),
            this.y * 2 + Math.floor(i / 2),
          ),
      );
    return this.children;
  }
}
export function selectTiles(
  roots,
  camera,
  focalPixels,
  budget,
  intersects = () => true,
  previous = new Set(),
) {
  const distance = Math.hypot(...camera),
    direction = normalize(camera),
    horizon = Math.acos(1 / distance),
    leaves = [],
    split = new Set();
  function visit(tile) {
    const angle = Math.acos(
      Math.max(-1, Math.min(1, dot(direction, tile.center))),
    );
    if (angle - tile.angle > horizon + 0.01 || !intersects(tile)) return;
    const separation = Math.hypot(...camera.map((v, i) => v - tile.center[i]));
    const projected =
      (tile.radius * 2 * focalPixels) /
      Math.max(distance - 1, separation - tile.radius * 0.5);
    const threshold = budget * (previous.has(tile.id) ? 0.85 : 1.1);
    if (tile.level < MAX_LEVEL && (tile.level < 1 || projected > threshold)) {
      split.add(tile.id);
      tile.split().forEach(visit);
    } else leaves.push(tile);
  }
  roots.forEach(visit);
  return { leaves, split };
}
