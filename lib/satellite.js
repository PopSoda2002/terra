import * as THREE from 'three';
import {
  ancestorTile,
  imageryBounds,
  imageryRequests,
  IMAGE_SIZE,
  MAX_IMAGE_LEVEL,
  IMAGERY_SOURCE,
  IMAGERY_RESOLUTION_METERS,
} from './imagery-tiles.mjs';
import {
  planMercator,
  MERCATOR_LIMIT,
  maptilerError,
  tileURL,
} from './maptiler-tiles.mjs';

async function loadImage(tile, signal) {
  const bounds = imageryBounds(tile),
    canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext('2d');
  await Promise.all(
    imageryRequests(bounds).map(async (part) => {
      const response = await fetch(part.url, { signal, credentials: 'omit' });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('image/')
      )
        throw new Error('Satellite source unavailable');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        context.drawImage(bitmap, part.x, 0, part.width, IMAGE_SIZE);
      } finally {
        bitmap.close();
      }
    }),
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return {
    texture,
    bounds,
    dispose() {
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

export function createMapTilerLoader(key, metadata) {
  const controller = new AbortController(),
    cache = new Map();
  let stopped = false;
  async function blobFor(part) {
    if (stopped) throw new DOMException('Stopped', 'AbortError');
    const id = `${part.z}/${part.x}/${part.y}`;
    let pending = cache.get(id);
    if (pending) {
      cache.delete(id);
      cache.set(id, pending);
      return pending;
    }
    pending = fetch(tileURL(metadata.template, key, part), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      credentials: 'omit',
    })
      .then(async (response) => {
        if (!response.ok || response.status === 204) {
          const error = maptilerError(response.status);
          if (error.pauseImagery) {
            stopped = true;
            controller.abort();
          }
          throw error;
        }
        if (!response.headers.get('content-type')?.includes('image/'))
          throw maptilerError(500);
        return response.blob();
      })
      .catch((error) => {
        cache.delete(id);
        throw error;
      });
    cache.set(id, pending);
    // Compressed tiles are shared by neighboring cube patches, in memory only.
    while (cache.size > 128) cache.delete(cache.keys().next().value);
    return pending;
  }
  const loader = async (tile, signal) => {
    const geographic = imageryBounds(tile);
    // Mercator has no polar coverage. Keep EOX for patches crossing that limit.
    if (
      geographic.south < -MERCATOR_LIMIT ||
      geographic.south + geographic.height > MERCATOR_LIMIT
    )
      return loadImage(tile, signal);
    const plan = planMercator(geographic, metadata.maxZoom, metadata.tileSize);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = IMAGE_SIZE;
    const context = canvas.getContext('2d');
    for (const part of plan.parts) {
      signal.throwIfAborted();
      const blob = await blobFor(part);
      signal.throwIfAborted();
      const bitmap = await createImageBitmap(blob);
      try {
        context.drawImage(bitmap, part.dx, part.dy, part.width, part.height);
      } finally {
        bitmap.close();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return {
      texture,
      bounds: plan.bounds,
      projection: 2,
      dispose() {
        texture.dispose();
        canvas.width = canvas.height = 1;
      },
    };
  };
  loader.dispose = () => {
    stopped = true;
    controller.abort();
    cache.clear();
  };
  return loader;
}

// Bounded, demand-driven cache. Coarse ancestors are requested first and remain
// usable while detailed tiles load. At most four WMS image jobs run at a time.
export class SatelliteImagery {
  constructor(onChange, loader = loadImage, limit = 160, options = {}) {
    this.onChange = onChange;
    this.loader = loader;
    this.limit = limit;
    this.entries = new Map();
    this.targets = new Map();
    this.required = new Set();
    this.pinned = new Set();
    this.queue = [];
    this.active = 0;
    this.clock = 0;
    this.revision = 0;
    this.disposed = false;
    this.covered = 0;
    this.maxLevel = options.maxLevel ?? MAX_IMAGE_LEVEL;
    this.source = options.source ?? IMAGERY_SOURCE;
    this.resolutionMeters =
      options.resolutionMeters ?? IMAGERY_RESOLUTION_METERS;
    this.paused = '';
  }
  update(leaves) {
    let bias = 1,
      targets;
    do {
      targets = new Map(
        leaves.map((tile) => [
          tile.id,
          ancestorTile(
            tile,
            Math.max(0, Math.min(this.maxLevel, tile.level - bias)),
          ),
        ]),
      );
      if (new Set([...targets.values()].map((t) => t.id)).size <= 96) break;
      bias++;
    } while (bias <= this.maxLevel + 2);
    this.targets = targets;
    const needed = new Map();
    for (const target of targets.values()) {
      if (this.entries.get(target.id)?.state === 'ready') continue;
      for (let level = 0; level < target.level; level += 2) {
        const tile = ancestorTile(target, level);
        needed.set(tile.id, tile);
      }
      needed.set(target.id, target);
    }
    this.required = new Set(needed.keys());
    this.queue = [];
    for (const tile of [...needed.values()].sort((a, b) => a.level - b.level)) {
      let entry = this.entries.get(tile.id);
      if (
        entry?.state === 'ready' ||
        entry?.state === 'loading' ||
        (entry?.state === 'error' && Date.now() < entry.retryAt)
      )
        continue;
      if (!entry) {
        entry = { id: tile.id, tile, state: 'queued', lastUsed: ++this.clock };
        this.entries.set(tile.id, entry);
      }
      entry.state = 'queued';
      this.queue.push(entry);
    }
    for (const [id, entry] of this.entries)
      if (entry.state === 'queued' && !needed.has(id)) this.entries.delete(id);
    this.pinned = new Set();
    this.covered = 0;
    for (const tile of leaves) {
      const image = this.resolve(tile);
      if (image) {
        this.pinned.add(image.id);
        this.covered++;
      }
    }
    this.trim();
    this.pump();
  }
  resolve(tile) {
    const target = this.targets.get(tile.id);
    if (!target) return null;
    for (let level = target.level; level >= 0; level--) {
      const key = ancestorTile(target, level).id,
        entry = this.entries.get(key);
      if (entry?.state === 'ready') {
        entry.lastUsed = ++this.clock;
        return entry;
      }
    }
    return null;
  }
  pump() {
    if (this.disposed || this.paused) return;
    while (this.active < 4 && this.queue.length) {
      const entry = this.queue.shift();
      if (entry.state !== 'queued' || !this.required.has(entry.id)) continue;
      entry.state = 'loading';
      entry.controller = new AbortController();
      this.active++;
      const timer = setTimeout(() => entry.controller.abort(), 18000);
      Promise.resolve()
        .then(() => this.loader(entry.tile, entry.controller.signal))
        .then((asset) => {
          if (this.disposed) {
            asset.dispose();
            return;
          }
          entry.asset = asset;
          entry.state = 'ready';
          entry.lastUsed = ++this.clock;
          this.revision++;
        })
        .catch((error) => {
          entry.controller?.abort();
          if (!this.disposed) {
            entry.state = 'error';
            entry.retryAt = Date.now() + 30000;
            if (error.pauseImagery) this.paused = error.message;
          }
        })
        .finally(() => {
          clearTimeout(timer);
          this.active--;
          entry.controller = null;
          if (!this.disposed) {
            this.onChange();
            this.pump();
          }
        });
    }
  }
  trim() {
    const ready = [...this.entries.values()].filter((e) => e.state === 'ready');
    let remove = ready.length - this.limit;
    for (const entry of ready.sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (remove <= 0) break;
      if (this.pinned.has(entry.id)) continue;
      entry.material?.dispose();
      entry.asset.dispose();
      this.entries.delete(entry.id);
      remove--;
    }
    for (const [id, entry] of this.entries)
      if (entry.state === 'error' && !this.required.has(id))
        this.entries.delete(id);
  }
  stats() {
    const targets = new Set([...this.targets.values()].map((t) => t.id));
    const ready = [...targets].filter(
      (id) => this.entries.get(id)?.state === 'ready',
    ).length;
    const failed = [...this.required].filter(
      (id) => this.entries.get(id)?.state === 'error',
    ).length;
    return {
      ready,
      total: targets.size,
      covered: this.covered,
      loading: this.active + this.queue.length,
      failed,
      cached: [...this.entries.values()].filter((e) => e.state === 'ready')
        .length,
      source: this.source,
      resolutionMeters: this.resolutionMeters,
      paused: this.paused,
    };
  }
  retry() {
    for (const entry of this.entries.values())
      if (entry.state === 'error') entry.retryAt = 0;
    this.onChange();
  }
  dispose() {
    this.disposed = true;
    this.loader.dispose?.();
    this.queue = [];
    for (const entry of this.entries.values()) {
      entry.controller?.abort();
      entry.material?.dispose();
      entry.asset?.dispose();
    }
    this.entries.clear();
  }
}
