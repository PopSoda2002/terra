export const MERCATOR_LIMIT = 85.0511287798066;
export const MAPTILER_SOURCE = 'MapTiler Satellite';

// Normalized XYZ coordinates: north is y=0, east increases x.
export function mercatorY(latitude) {
  const lat = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitude));
  return Math.max(
    0,
    Math.min(
      1,
      (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2,
    ),
  );
}

// Crop a small XYZ mosaic to the cube patch's bounds. Keeping the texture in
// Mercator coordinates lets the globe shader perform the exact reprojection.
export function planMercator(bounds, maxZoom = 22, tileSize = 256, size = 512) {
  const left = (bounds.west + 180) / 360;
  const top = mercatorY(bounds.south + bounds.height);
  const width = bounds.span / 360;
  const height = mercatorY(bounds.south) - top;
  if (height <= 0) return null;
  const zoom = Math.max(
    0,
    Math.min(
      maxZoom,
      Math.floor(Math.log2(size / (tileSize * Math.max(width, height)))),
    ),
  );
  const n = 2 ** zoom;
  const x0 = left * n,
    y0 = top * n,
    w = width * n,
    h = height * n;
  const parts = [];
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h - 1e-10); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w - 1e-10); x++) {
      if (y < 0 || y >= n) continue;
      parts.push({
        z: zoom,
        x: ((x % n) + n) % n,
        y,
        dx: ((x - x0) / w) * size,
        dy: ((y - y0) / h) * size,
        width: size / w,
        height: size / h,
      });
    }
  return {
    zoom,
    parts,
    bounds: {
      west: bounds.west,
      south: 1 - (top + height),
      span: bounds.span,
      height,
    },
  };
}

export function maptilerError(status) {
  const message = [401, 403].includes(status)
    ? 'API key 无效或有域名限制，请在 MapTiler 后台检查。'
    : [402, 429].includes(status)
      ? 'MapTiler 额度已用完或请求受限，已暂停高清加载。'
      : 'MapTiler 暂时无法连接，请稍后重试。';
  const error = new Error(message);
  error.pauseImagery = [401, 402, 403, 429].includes(status);
  return error;
}

export function tileURL(template, key, part) {
  const value = template
    .replace('{z}', part.z)
    .replace('{x}', part.x)
    .replace('{y}', part.y);
  const url = new URL(value);
  // Never send a user's key to a host supplied by remote metadata.
  if (
    url.origin !== 'https://api.maptiler.com' ||
    !url.pathname.startsWith('/tiles/')
  )
    throw new Error('MapTiler 返回了无法识别的影像地址。');
  url.searchParams.set('key', key);
  return url.href;
}

export async function readMapTilerMetadata(key, signal, request = fetch) {
  if (!/^[a-zA-Z0-9_-]{8,200}$/.test(key))
    throw new Error('请粘贴 MapTiler 后台的 API key。');
  // Both IDs are documented; prefer the current API version, then the older
  // dataset only when the service explicitly reports that v4 does not exist.
  let response;
  for (const id of ['satellite-v4', 'satellite-v2']) {
    response = await request(
      `https://api.maptiler.com/tiles/${id}/tiles.json?key=${encodeURIComponent(key)}`,
      { signal, credentials: 'omit' },
    );
    if (response.status !== 404) break;
  }
  if (!response.ok) throw maptilerError(response.status);
  const data = await response.json();
  const template = data.tiles?.[0];
  if (
    typeof template !== 'string' ||
    !['{z}', '{x}', '{y}'].every((t) => template.includes(t)) ||
    (data.scheme && data.scheme !== 'xyz')
  )
    throw new Error('MapTiler 返回的影像配置不可用。');
  tileURL(template, key, { z: 0, x: 0, y: 0 });
  return {
    template,
    maxZoom: Math.min(
      22,
      Math.max(0, Number.isFinite(data.maxzoom) ? data.maxzoom : 22),
    ),
    tileSize: data.tileSize === 512 ? 512 : 256,
  };
}
