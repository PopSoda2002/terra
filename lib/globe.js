import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoEquirectangular, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/land-110m.json';
import { geographicPoint, geographicCoordinates } from './geography.mjs';
import { SatelliteImagery, createMapTilerLoader } from './satellite.js';
import {
  readMapTilerMetadata,
  MAPTILER_SOURCE,
  mercatorY,
} from './maptiler-tiles.mjs';
import {
  Tile,
  cubePoint,
  selectTiles,
  faceUV,
  EARTH_KM,
  COLORS,
  MAX_LEVEL,
  MIN_ALTITUDE_KM,
  MAX_ALTITUDE_KM,
} from './quadtree.mjs';
const SEGMENTS = 8;
function earthTexture(showGrid = true) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d'),
    projection = geoEquirectangular()
      .scale(2048 / (2 * Math.PI))
      .translate([1024, 512]),
    path = geoPath(projection, ctx);
  ctx.fillStyle = '#102b43';
  ctx.fillRect(0, 0, 2048, 1024);
  if (showGrid) {
    ctx.beginPath();
    path(geoGraticule10());
    ctx.strokeStyle = '#193c53';
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
  ctx.beginPath();
  path(feature(world, world.objects.land));
  ctx.fillStyle = '#347e80';
  ctx.fill();
  ctx.strokeStyle = '#6cb4b2';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}
const vertexShader = `attribute vec2 tileUV;attribute vec2 imageUV;attribute float level;varying vec2 vTileUV;varying vec2 vImageUV;varying vec3 vPoint;varying float vLevel;
void main(){vTileUV=tileUV;vImageUV=imageUV;vPoint=normalize(position);vLevel=level;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragmentShader = `uniform sampler2D earth;uniform float satellite;uniform vec4 imageBounds;uniform float grid;uniform float mode;uniform vec3 eye;uniform vec3 palette[${COLORS.length}];varying vec2 vTileUV;varying vec2 vImageUV;varying vec3 vPoint;varying float vLevel;
void main(){
vec3 n=normalize(vPoint);vec2 uv=vec2(atan(-n.z,n.x)/6.28318530718+0.5,asin(clamp(n.y,-1.0,1.0))/3.14159265359+0.5);
if(satellite>1.5){uv=clamp(vImageUV,vec2(0.001),vec2(0.999));}
else if(satellite>0.5){float lon=(uv.x-0.5)*360.0;float lat=(uv.y-0.5)*180.0;float delta=lon-imageBounds.x;if(delta<0.0)delta+=360.0;uv=vec2(delta/imageBounds.z,(lat-imageBounds.y)/imageBounds.w);uv=clamp(uv,vec2(0.001),vec2(0.999));}
vec3 base=texture2D(earth,uv).rgb;int index=int(clamp(vLevel,0.0,${MAX_LEVEL}.0));vec3 levelColor=palette[index];base=mix(base,levelColor*0.64,mode);
float light=0.38+0.62*max(dot(n,normalize(eye+vec3(-0.9,1.3,0.5))),0.0);base*=light;
vec2 d=min(vTileUV,1.0-vTileUV)/max(fwidth(vTileUV),vec2(0.00001));float edge=1.0-smoothstep(0.0,1.1,min(d.x,d.y));
base=mix(base,mix(vec3(.48,.74,.77),levelColor,mode),edge*grid*.70);gl_FragColor=vec4(base,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
function buildGeometry(
  leaves,
  materialIndices = null,
  imageAssets = new Map(),
) {
  const positions = [],
    uvs = [],
    imageUVs = [],
    levels = [],
    indices = [];
  const groups = [];
  for (const tile of leaves) {
    const groupStart = indices.length;
    const offset = positions.length / 3;
    const image = imageAssets.get(tile.id);
    function vertex(a, b, r = 1) {
      const p = cubePoint(
        tile.face,
        tile.u + a * tile.size,
        tile.v + b * tile.size,
      );
      positions.push(...p.map((v) => v * r));
      uvs.push(a, b);
      // Double-precision local UVs avoid losing meters in global float longitude.
      if (image?.projection === 2) {
        const { lat, lon } = geographicCoordinates(p),
          bounds = image.bounds;
        imageUVs.push(
          ((lon - bounds.west + 360) % 360) / bounds.span,
          (1 - mercatorY(lat) - bounds.south) / bounds.height,
        );
      } else imageUVs.push(0, 0);
      levels.push(tile.level);
    }
    for (let y = 0; y <= SEGMENTS; y++)
      for (let x = 0; x <= SEGMENTS; x++) vertex(x / SEGMENTS, y / SEGMENTS);
    for (let y = 0; y < SEGMENTS; y++)
      for (let x = 0; x < SEGMENTS; x++) {
        const a = offset + y * (SEGMENTS + 1) + x,
          b = a + 1,
          c = a + SEGMENTS + 1,
          d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    // Skirts cover cracks where adjacent tiles have different detail levels.
    const border = [];
    for (let x = 0; x < SEGMENTS; x++) border.push([x / SEGMENTS, 0]);
    for (let y = 0; y < SEGMENTS; y++) border.push([1, y / SEGMENTS]);
    for (let x = SEGMENTS; x > 0; x--) border.push([x / SEGMENTS, 1]);
    for (let y = SEGMENTS; y > 0; y--) border.push([0, y / SEGMENTS]);
    const start = positions.length / 3,
      depth = Math.max(0.000003, tile.size * tile.size * 0.008);
    for (const [a, b] of border) {
      vertex(a, b);
      vertex(a, b, 1 - depth);
    }
    for (let i = 0; i < border.length; i++) {
      const a = start + i * 2,
        b = start + ((i + 1) % border.length) * 2;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    if (materialIndices) {
      const index = materialIndices.get(tile.id),
        last = groups[groups.length - 1];
      if (last && last.materialIndex === index)
        last.count += indices.length - groupStart;
      else
        groups.push({
          start: groupStart,
          count: indices.length - groupStart,
          materialIndex: index,
        });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('tileUV', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'imageUV',
    new THREE.Float32BufferAttribute(imageUVs, 2),
  );
  geometry.setAttribute('level', new THREE.Float32BufferAttribute(levels, 1));
  geometry.setIndex(indices);
  for (const group of groups)
    geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  return geometry;
}
export class Globe {
  constructor(container, onUpdate, onError, { presentation = false } = {}) {
    Object.assign(this, {
      container,
      onUpdate,
      onError,
      disposed: false,
      roots: Array.from({ length: 6 }, (_, i) => new Tile(i)),
      split: new Set(),
      leaves: [],
      signature: '',
      detail: 45,
      selection: null,
      lastBuild: 0,
      lastStats: 0,
      dirty: true,
      flight: null,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.000005, 30);
    this.setCamera(28, 110, 14000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x080e15, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.setAttribute(
      'aria-label',
      presentation
        ? '地球：拖动或使用方向键旋转，滚轮、双指或加减键缩放'
        : '交互地球：方向键旋转，加减键缩放；鼠标拖动旋转，点击查看图块',
    );
    canvas.tabIndex = 0;
    container.appendChild(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1 + MIN_ALTITUDE_KM / EARTH_KM;
    this.controls.maxDistance = 1 + MAX_ALTITUDE_KM / EARTH_KM;
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });
    this.controls.addEventListener('start', () => {
      this.flight = null;
    });
    this.texture = earthTexture(!presentation);
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        earth: { value: this.texture },
        satellite: { value: 0 },
        imageBounds: { value: new THREE.Vector4(-180, -90, 360, 180) },
        grid: { value: presentation ? 0 : 1 },
        mode: { value: 0 },
        eye: { value: this.camera.position },
        palette: { value: COLORS.map((c) => new THREE.Color(c)) },
      },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.imagery = new SatelliteImagery(() => {
      this.dirty = true;
    });
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.selectionLine = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xffd095,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.selectionLine.visible = false;
    this.selectionLine.renderOrder = 3;
    this.scene.add(this.selectionLine);
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.bound = new THREE.Sphere();
    this.raycaster = new THREE.Raycaster();
    this.down = null;
    this.pointerDown = (e) => {
      this.down = [e.clientX, e.clientY];
    };
    this.pointerUp = (e) => {
      if (
        !presentation &&
        this.down &&
        Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 5
      )
        this.pick(e);
      this.down = null;
    };
    this.contextLost = (e) => {
      e.preventDefault();
      this.onError('图形上下文已中断，请刷新页面恢复地球。');
    };
    this.keyDown = (e) => {
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '=',
          '-',
        ].includes(e.key)
      )
        e.preventDefault();
      else return;
      if (['+', '=', '-'].includes(e.key)) {
        this.zoomBy(e.key === '-' ? 1.35 : 0.75);
        return;
      }
      const { lat, lon } = this.location();
      const step = Math.min(
        3,
        (((this.altitude() / EARTH_KM) * 180) / Math.PI) * 0.25,
      );
      this.flyTo(
        Math.max(
          -85,
          Math.min(
            85,
            lat +
              (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0),
          ),
        ),
        lon +
          (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
        this.altitude(),
      );
    };
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('keydown', this.keyDown);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.resize = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      if (presentation) {
        // Fit the whole planet on portrait screens without changing zoom distance.
        this.camera.fov = THREE.MathUtils.radToDeg(
          2 *
            Math.atan(
              Math.tan(THREE.MathUtils.degToRad(21)) / Math.min(1, w / h),
            ),
        );
      }
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.dirty = true;
    });
    this.resize.observe(container);
    this.tick = this.tick.bind(this);
    this.frame = requestAnimationFrame(this.tick);
  }
  setCamera(lat, lon, altitude) {
    this.camera.position.fromArray(
      geographicPoint(lat, lon, 1 + altitude / EARTH_KM),
    );
    this.camera.lookAt(0, 0, 0);
  }
  location() {
    return geographicCoordinates(this.camera.position.toArray());
  }
  altitude() {
    return (this.camera.position.length() - 1) * EARTH_KM;
  }
  setZoom(value) {
    this.flight = null;
    this.camera.position.setLength(
      1 +
        Math.max(MIN_ALTITUDE_KM, Math.min(MAX_ALTITUDE_KM, value)) / EARTH_KM,
    );
    this.controls.update();
    this.dirty = true;
  }
  zoomBy(scale) {
    const { lat, lon } = this.location();
    this.flyTo(lat, lon, this.altitude() * scale);
  }
  setMode(value) {
    this.material.uniforms.mode.value = value === 'levels' ? 1 : 0;
  }
  setGrid(value) {
    this.material.uniforms.grid.value = value ? 1 : 0;
  }
  retryImagery() {
    this.imagery.retry();
    this.hdImagery?.retry();
  }
  async enableMapTiler(key) {
    this.keyRequest?.abort();
    const request = new AbortController();
    this.keyRequest = request;
    const timer = setTimeout(() => request.abort(), 15000);
    try {
      const metadata = await readMapTilerMetadata(key.trim(), request.signal);
      request.signal.throwIfAborted();
      if (this.disposed) return;
      this.hdImagery?.dispose();
      this.hdImagery = new SatelliteImagery(
        () => {
          this.dirty = true;
        },
        createMapTilerLoader(key.trim(), metadata),
        128,
        { maxLevel: 16, source: MAPTILER_SOURCE, resolutionMeters: 2 },
      );
      this.signature = '';
      this.dirty = true;
    } catch (error) {
      if (error.name === 'AbortError')
        throw new Error('连接超时或已取消，请重试。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  useEOX() {
    this.keyRequest?.abort();
    this.hdImagery?.dispose();
    this.hdImagery = null;
    this.signature = '';
    this.dirty = true;
  }
  flyTo(lat, lon, altitude) {
    const direction = new THREE.Vector3(...geographicPoint(lat, lon));
    this.flight = {
      start: performance.now(),
      from: this.camera.position.clone(),
      rotation: new THREE.Quaternion().setFromUnitVectors(
        this.camera.position.clone().normalize(),
        direction,
      ),
      radius:
        1 +
        Math.max(MIN_ALTITUDE_KM, Math.min(MAX_ALTITUDE_KM, altitude)) /
          EARTH_KM,
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setCamera(
        lat,
        lon,
        Math.max(MIN_ALTITUDE_KM, Math.min(MAX_ALTITUDE_KM, altitude)),
      );
      this.flight = null;
      this.dirty = true;
    }
  }
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const point = this.raycaster.ray.intersectSphere(
      new THREE.Sphere(new THREE.Vector3(), 1),
      new THREE.Vector3(),
    );
    this.selection = point ? faceUV(point.toArray()) : null;
    this.updateSelection();
    this.lastStats = 0;
  }
  selectedTile() {
    if (!this.selection) return null;
    const { face, u, v } = this.selection;
    return (
      this.leaves.find(
        (t) =>
          t.face === face &&
          u >= t.u - 1e-9 &&
          u <= t.u + t.size + 1e-9 &&
          v >= t.v - 1e-9 &&
          v <= t.v + t.size + 1e-9,
      ) || null
    );
  }
  updateSelection() {
    const tile = this.selectedTile();
    this.selectionLine.visible = Boolean(tile);
    if (!tile) return;
    const points = [];
    for (let edge = 0; edge < 4; edge++)
      for (let i = 0; i < 24; i++) {
        const t = i / 24,
          [a, b] = [
            [t, 0],
            [1, t],
            [1 - t, 1],
            [0, 1 - t],
          ][edge];
        points.push(
          new THREE.Vector3(
            ...cubePoint(
              tile.face,
              tile.u + a * tile.size,
              tile.v + b * tile.size,
            ),
          ).multiplyScalar(1.00002),
        );
      }
    this.selectionLine.geometry.dispose();
    this.selectionLine.geometry = new THREE.BufferGeometry().setFromPoints(
      points,
    );
  }
  rebuild() {
    this.camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.matrix);
    const focal =
        this.container.clientHeight /
        (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
      budget = 260 * Math.pow(50 / 260, this.detail / 100);
    const result = selectTiles(
      this.roots,
      this.camera.position.toArray(),
      focal,
      budget,
      (tile) => {
        this.bound.center.fromArray(tile.center);
        this.bound.radius = tile.radius;
        return this.frustum.intersectsSphere(this.bound);
      },
      this.split,
    );
    this.split = result.split;
    this.leaves = result.leaves;
    this.hdImagery?.update(this.leaves);
    this.imagery.update(
      this.leaves.filter((tile) => !this.hdImagery?.resolve(tile)),
    );
    const batches = new Map();
    for (const tile of this.leaves) {
      const hd = this.hdImagery?.resolve(tile),
        entry = hd || this.imagery.resolve(tile),
        key = entry ? (hd ? 'hd:' : 'eox:') + entry.id : 'outline';
      if (!batches.has(key)) batches.set(key, { entry, tiles: [] });
      batches.get(key).tiles.push(tile);
    }
    const signature = [...batches]
      .map(([key, batch]) => key + ':' + batch.tiles.map((t) => t.id).join(','))
      .join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      const materials = [],
        materialIndices = new Map(),
        imageAssets = new Map(),
        ordered = [];
      for (const { entry, tiles } of batches.values()) {
        if (entry && !entry.material) {
          const b = entry.asset.bounds;
          entry.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
              ...this.material.uniforms,
              earth: { value: entry.asset.texture },
              satellite: { value: entry.asset.projection || 1 },
              imageBounds: {
                value: new THREE.Vector4(b.west, b.south, b.span, b.height),
              },
            },
            side: THREE.DoubleSide,
          });
          entry.asset.texture.anisotropy = Math.min(
            4,
            this.renderer.capabilities.getMaxAnisotropy(),
          );
        }
        const index = materials.length;
        materials.push(entry?.material || this.material);
        for (const tile of tiles) {
          ordered.push(tile);
          materialIndices.set(tile.id, index);
          if (entry) imageAssets.set(tile.id, entry.asset);
        }
      }
      const geometry = buildGeometry(ordered, materialIndices, imageAssets);
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
      this.mesh.material = materials;
      this.updateSelection();
    }
  }
  tick(now) {
    if (this.disposed) return;
    if (this.flight) {
      const f = this.flight,
        t = Math.min(1, (now - f.start) / 1200),
        e = t * t * (3 - 2 * t),
        direction = f.from
          .clone()
          .normalize()
          .applyQuaternion(new THREE.Quaternion().slerp(f.rotation, e)),
        r =
          Math.exp(
            Math.log(f.from.length() - 1) * (1 - e) +
              Math.log(f.radius - 1) * e,
          ) + 1;
      this.camera.position.copy(direction.multiplyScalar(r));
      this.dirty = true;
      if (t === 1) this.flight = null;
    }
    this.controls.rotateSpeed = Math.max(
      0.0001,
      Math.min(0.65, (this.camera.position.length() - 1) * 0.32),
    );
    // OrbitControls dollies relative to Earth's center; slow it near the
    // surface so a wheel step does not jump hundreds of kilometers.
    this.controls.zoomSpeed = Math.min(
      1,
      (3 * (this.camera.position.length() - 1)) / this.camera.position.length(),
    );
    this.controls.update();
    if (this.dirty && now - this.lastBuild > 65) {
      this.rebuild();
      this.lastBuild = now;
      this.dirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    if (now - this.lastStats > 180) {
      const histogram = Array(MAX_LEVEL + 1).fill(0);
      for (const t of this.leaves) histogram[t.level]++;
      const levels = this.leaves.map((t) => t.level),
        s = this.selectedTile();
      this.onUpdate({
        count: this.leaves.length,
        min: levels.length ? Math.min(...levels) : 0,
        max: levels.length ? Math.max(...levels) : 0,
        altitude: this.altitude(),
        ...this.location(),
        histogram,
        imagery: (this.hdImagery || this.imagery).stats(),
        triangles: this.mesh.geometry.index
          ? this.mesh.geometry.index.count / 3
          : 0,
        selected: s
          ? { id: s.id, level: s.level, face: s.face, x: s.x, y: s.y }
          : null,
      });
      this.lastStats = now;
    }
    this.frame = requestAnimationFrame(this.tick);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown);
    canvas.removeEventListener('pointerup', this.pointerUp);
    canvas.removeEventListener('keydown', this.keyDown);
    canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.mesh.geometry.dispose();
    this.imagery.dispose();
    this.keyRequest?.abort();
    this.hdImagery?.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.selectionLine.geometry.dispose();
    this.selectionLine.material.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
