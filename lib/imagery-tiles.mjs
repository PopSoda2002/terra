import { Tile, cubePoint } from './quadtree.mjs';
import { geographicCoordinates } from './geography.mjs';

export const IMAGE_SIZE = 512;
export const MAX_IMAGE_LEVEL = 12;
export const EOX_WMS = 'https://tiles.maps.eox.at/wms';
export const EOX_LAYER = 's2cloudless-2025';
export const IMAGERY_SOURCE = 'EOX / Sentinel-2 cloudless 2025';
export const IMAGERY_RESOLUTION_METERS = 10;

export function ancestorTile(tile, level) {
  const factor = 2 ** (tile.level - level);
  return new Tile(
    tile.face,
    level,
    Math.floor(tile.x / factor),
    Math.floor(tile.y / factor),
  );
}

// Find the smallest longitude interval, unwrapped across the date line.
// Polar root faces cover all longitudes; pole corners have no unique longitude.
export function imageryBounds(tile) {
  const longitudes = [],
    latitudes = [];
  for (let y = 0; y <= 4; y++)
    for (let x = 0; x <= 4; x++) {
      const { lat, lon } = geographicCoordinates(
        cubePoint(
          tile.face,
          tile.u + (x / 4) * tile.size,
          tile.v + (y / 4) * tile.size,
        ),
      );
      latitudes.push(lat);
      if (Math.abs(lat) < 89.99999) longitudes.push((lon + 360) % 360);
    }
  let west = -180,
    span = 360;
  if (!((tile.face === 2 || tile.face === 3) && tile.level === 0)) {
    longitudes.sort((a, b) => a - b);
    let gap = -1,
      start = 0;
    for (let i = 0; i < longitudes.length; i++) {
      const next = (i + 1) % longitudes.length;
      const size = longitudes[next] + (next === 0 ? 360 : 0) - longitudes[i];
      if (size > gap) {
        gap = size;
        start = longitudes[next];
      }
    }
    const padding = Math.max(0.00001, (360 - gap) / IMAGE_SIZE);
    west = ((start - padding + 540) % 360) - 180;
    span = Math.min(360, 360 - gap + 2 * padding);
  }
  const low = Math.min(...latitudes),
    high = Math.max(...latitudes);
  const padding = Math.max(0.00001, (high - low) / IMAGE_SIZE);
  const south = Math.max(-90, low - padding),
    north = Math.min(90, high + padding);
  return { west, south, span, height: north - south };
}

export function imageryRequests(bounds, size = IMAGE_SIZE) {
  const { west, south, span, height } = bounds;
  const east = west + span;
  const pieces =
    east <= 180 + 1e-9
      ? [{ west, east: Math.min(180, east), x: 0, width: size }]
      : (() => {
          const width = Math.max(
            1,
            Math.min(size - 1, Math.round((size * (180 - west)) / span)),
          );
          return [
            { west, east: 180, x: 0, width },
            { west: -180, east: east - 360, x: width, width: size - width },
          ];
        })();
  return pieces.map((piece) => {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: EOX_LAYER,
      STYLES: '',
      FORMAT: 'image/jpeg',
      SRS: 'EPSG:4326',
      BBOX: [piece.west, south, piece.east, south + height]
        .map((v) => v.toFixed(9))
        .join(','),
      WIDTH: String(piece.width),
      HEIGHT: String(size),
    });
    return { ...piece, url: `${EOX_WMS}?${params}` };
  });
}

export function imageryUV(point, bounds) {
  const { lat, lon } = geographicCoordinates(point);
  return [
    ((lon - bounds.west + 720) % 360) / bounds.span,
    (lat - bounds.south) / bounds.height,
  ];
}
