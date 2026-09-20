'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Orbit,
  RotateCcw,
  Plus,
  Minus,
  ArrowUpRight,
  Layers3,
  Crosshair,
  MousePointer2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { registerGlobeTools } from '@/lib/webmcp.js';
import {
  COLORS,
  MAX_LEVEL,
  MIN_ALTITUDE_KM,
  MAX_ALTITUDE_KM,
} from '@/lib/quadtree.mjs';
import {
  IMAGERY_SOURCE,
  IMAGERY_RESOLUTION_METERS,
} from '@/lib/imagery-tiles.mjs';
type Stats = {
  count: number;
  min: number;
  max: number;
  altitude: number;
  lat: number;
  lon: number;
  histogram: number[];
  triangles: number;
  imagery: {
    ready: number;
    total: number;
    covered: number;
    loading: number;
    failed: number;
    cached: number;
    source: string;
    resolutionMeters: number;
    paused?: string;
  };
  selected: {
    id: string;
    level: number;
    face: number;
    x: number;
    y: number;
  } | null;
};
type Engine = {
  setZoom: (n: number) => void;
  setCamera: (lat: number, lon: number, altitude: number) => void;
  setMode: (s: string) => void;
  setGrid: (b: boolean) => void;
  flyTo: (lat: number, lon: number, alt: number) => void;
  zoomBy: (n: number) => void;
  dispose: () => void;
  retryImagery: () => void;
  enableMapTiler: (key: string) => Promise<void>;
  useEOX: () => void;
};
const INITIAL: Stats = {
  count: 0,
  min: 0,
  max: 0,
  altitude: 14000,
  lat: 28,
  lon: 110,
  histogram: Array(MAX_LEVEL + 1).fill(0),
  triangles: 0,
  imagery: {
    ready: 0,
    total: 0,
    covered: 0,
    loading: 0,
    failed: 0,
    cached: 0,
    source: IMAGERY_SOURCE,
    resolutionMeters: IMAGERY_RESOLUTION_METERS,
  },
  selected: null,
};
const altitudeToZoom = (h: number) =>
  Math.max(
    0,
    Math.min(
      100,
      (100 * Math.log(MAX_ALTITUDE_KM / h)) /
        Math.log(MAX_ALTITUDE_KM / MIN_ALTITUDE_KM),
    ),
  );
export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    engine = useRef<Engine | null>(null),
    latest = useRef(INITIAL),
    settings = useRef({ mode: 'map', showGrid: true });
  const [stats, setStats] = useState<Stats>(INITIAL),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [mode, setMode] = useState('map'),
    [grid, setGrid] = useState(true),
    [apiKey, setApiKey] = useState(''),
    [connecting, setConnecting] = useState(false),
    [keyError, setKeyError] = useState(''),
    [hdEnabled, setHdEnabled] = useState(false);
  useEffect(() => {
    let stopped = false;
    import('@/lib/globe.js')
      .then(({ Globe }) => {
        if (stopped || !mount.current) return;
        try {
          engine.current = new Globe(
            mount.current,
            (s: Stats) => {
              latest.current = s;
              setStats(s);
              setReady(true);
            },
            (m: string) => setError(m),
          );
          // Keep controls and the recreated renderer in sync during live updates.
          engine.current.setMode(settings.current.mode);
          engine.current.setGrid(settings.current.showGrid);
          if (latest.current.count > 0)
            engine.current.setCamera(
              latest.current.lat,
              latest.current.lon,
              latest.current.altitude,
            );
          let savedKey = '';
          try {
            savedKey = sessionStorage.getItem('terra.maptilerKey') || '';
          } catch {}
          if (savedKey) {
            setConnecting(true);
            engine.current
              .enableMapTiler(savedKey)
              .then(() => {
                if (!stopped) setHdEnabled(true);
              })
              .catch((e: Error) => {
                if (!stopped) setKeyError(e.message);
              })
              .finally(() => {
                if (!stopped) setConnecting(false);
              });
          }
        } catch {
          setError(
            '三维视图未能启动。请使用支持 WebGL 2 的浏览器，并开启硬件加速后重新打开。',
          );
        }
      })
      .catch(() => setError('三维模块加载失败，请刷新页面重试。'));
    return () => {
      stopped = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    settings.current = { mode, showGrid: grid };
  }, [mode, grid]);
  useEffect(
    () =>
      registerGlobeTools(
        () => ({
          ready: latest.current.count > 0,
          ...latest.current,
          ...settings.current,
        }),
        (input: { altitudeKm?: number; mode?: string; showGrid?: boolean }) => {
          if (input.altitudeKm !== undefined)
            engine.current?.setZoom(input.altitudeKm);
          if (input.mode !== undefined) {
            setMode(input.mode);
            engine.current?.setMode(input.mode);
          }
          if (input.showGrid !== undefined) {
            setGrid(input.showGrid);
            engine.current?.setGrid(input.showGrid);
          }
        },
      ),
    [],
  );
  const histogramMax = Math.max(1, ...stats.histogram);
  async function connectMapTiler(event: React.FormEvent) {
    event.preventDefault();
    if (!engine.current || connecting) return;
    setConnecting(true);
    setKeyError('');
    try {
      const key = apiKey.trim();
      await engine.current.enableMapTiler(key);
      try {
        sessionStorage.setItem('terra.maptilerKey', key);
      } catch {}
      setApiKey('');
      setHdEnabled(true);
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : '连接失败，请重试。');
    } finally {
      setConnecting(false);
    }
  }
  function disconnectMapTiler() {
    engine.current?.useEOX();
    try {
      sessionStorage.removeItem('terra.maptilerKey');
    } catch {}
    setHdEnabled(false);
    setKeyError('');
    setApiKey('');
  }
  const visibleLevels = stats.histogram
    .map((n, i) => ({ n, i }))
    .filter(
      ({ n, i }) =>
        n > 0 ||
        (i >= Math.max(0, stats.max - 8) && i <= Math.max(8, stats.max)),
    );
  return (
    <main className="observatory dark">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Terra 四叉树地球首页">
          <Orbit size={29} strokeWidth={1.4} />
          <span>
            TERRA<span className="brand-divider">/</span>
            <span className="brand-title">四叉树地球</span>
          </span>
        </a>
        <div className="top-meta">
          <span className="live-dot" />
          交互实验<span className="edition">03</span>
        </div>
      </header>
      <div className="workspace">
        <section
          className={`viewport${hdEnabled ? ' with-attribution' : ''}`}
          aria-label="可交互三维地球"
        >
          <div className="viewport-heading">
            <span className="eyebrow">PLANET EXPLORER</span>
            <h1>四叉树的球面世界</h1>
          </div>
          <div className="globe-mount" ref={mount} />
          {hdEnabled && (
            <div className="map-attribution" aria-label="地图来源">
              <a
                href="https://www.maptiler.com/"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src="https://api.maptiler.com/resources/logo.svg"
                  alt="MapTiler logo"
                  width="100"
                  height="26"
                />
              </a>
              <div className="map-copyright">
                <a
                  href="https://www.maptiler.com/copyright/"
                  target="_blank"
                  rel="noreferrer"
                >
                  © MapTiler
                </a>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  © OpenStreetMap contributors
                </a>
              </div>
            </div>
          )}
          {(!ready || error) && (
            <div className="scene-message" role={error ? 'alert' : 'status'}>
              {error || '正在展开地球…'}
            </div>
          )}
          <div className="view-actions">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="放大"
              onClick={() => engine.current?.zoomBy(0.65)}
              disabled={!ready}
            >
              <Plus />
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="缩小"
              onClick={() => engine.current?.zoomBy(1.5)}
              disabled={!ready}
            >
              <Minus />
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="回到初始视角"
              onClick={() => engine.current?.flyTo(28, 110, 14000)}
              disabled={!ready}
            >
              <RotateCcw />
            </Button>
          </div>
          <div className="view-bottom">
            <div className="view-location">
              <Crosshair size={15} />
              <span>
                {Math.abs(stats.lat).toFixed(1)}°{stats.lat >= 0 ? 'N' : 'S'}
                <span className="coordinate-gap" />
                {Math.abs(stats.lon).toFixed(1)}°{stats.lon >= 0 ? 'E' : 'W'}
              </span>
              <span className="coordinate-label">视点</span>
            </div>
            <div className="altitude-control">
              <div className="control-label">
                <label id="altitude-label">观察高度</label>
                <span>
                  <b>
                    {stats.altitude < 10
                      ? stats.altitude.toFixed(1)
                      : Math.round(stats.altitude).toLocaleString()}
                  </b>{' '}
                  km
                </span>
              </div>
              <Slider
                value={[altitudeToZoom(stats.altitude)]}
                min={0}
                max={100}
                step={0.1}
                aria-labelledby="altitude-label"
                disabled={!ready}
                onValueChange={(v) =>
                  engine.current?.setZoom(
                    MAX_ALTITUDE_KM *
                      Math.pow(
                        MIN_ALTITUDE_KM / MAX_ALTITUDE_KM,
                        (Array.isArray(v) ? v[0] : v) / 100,
                      ),
                  )
                }
              />
              <div className="range-captions">
                <span>远景</span>
                <span>近地 · 500 m</span>
              </div>
            </div>
            <div className="gestures">
              <MousePointer2 size={14} />
              <span>拖动旋转 · 滚轮缩放 · 点击查看图块</span>
            </div>
          </div>
        </section>
        <aside className="inspector">
          <div className="inspector-heading">
            <Layers3 size={18} />
            <h2>细节观察台</h2>
            <span className="live-tag">实时</span>
          </div>
          <div className="metrics">
            <div>
              <span>绘制图块</span>
              <strong>{ready ? stats.count.toLocaleString() : '—'}</strong>
            </div>
            <div>
              <span>最细层级</span>
              <strong>
                {ready ? (
                  <>
                    <small>L</small>
                    {stats.max}
                  </>
                ) : (
                  '—'
                )}
              </strong>
            </div>
          </div>
          <section className="control-section">
            <div className="section-label">显示方式</div>
            <ToggleGroup
              value={[mode]}
              onValueChange={(v) => {
                if (v.length) {
                  setMode(v[0]);
                  engine.current?.setMode(v[0]);
                }
              }}
              className="mode-picker"
              spacing={0}
              aria-label="地球显示方式"
            >
              <ToggleGroupItem value="map">卫星影像</ToggleGroupItem>
              <ToggleGroupItem value="levels">层级着色</ToggleGroupItem>
            </ToggleGroup>
            <div className="switch-row">
              <label htmlFor="grid-switch">四叉树边界</label>
              <Switch
                id="grid-switch"
                checked={grid}
                onCheckedChange={(v) => {
                  setGrid(v);
                  engine.current?.setGrid(v);
                }}
              />
            </div>
          </section>
          <section
            className="control-section imagery-setup"
            aria-label="高清卫星影像"
          >
            <div className="section-label">
              高清卫星影像<span>{hdEnabled ? 'MapTiler' : '待连接'}</span>
            </div>
            {hdEnabled ? (
              <>
                <p>已启用 · 清晰度因地区而异</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnectMapTiler}
                >
                  切回 EOX / 移除 key
                </Button>
              </>
            ) : (
              <form onSubmit={connectMapTiler}>
                <label className="sr-only" htmlFor="maptiler-key">
                  MapTiler API key
                </label>
                <Input
                  id="maptiler-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="粘贴 MapTiler API key"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyError('');
                  }}
                  disabled={connecting}
                  aria-describedby="key-help"
                />
                <div className="key-actions">
                  <a
                    href="https://cloud.maptiler.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    免费注册 / 获取 key ↗
                  </a>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!ready || !apiKey.trim() || connecting}
                  >
                    {connecting ? '连接中…' : '启用高清'}
                  </Button>
                </div>
                <p id="key-help">
                  选择 Free 套餐。key 仅保留在当前浏览器会话，随影像请求发送至
                  MapTiler。
                </p>
              </form>
            )}
            {keyError && (
              <p className="key-error" role="alert">
                {keyError}
              </p>
            )}
          </section>
          <section className="control-section">
            <div className="section-label">
              当前层级分布<span>图块数</span>
            </div>
            <div className="level-bars" aria-label="各层级可见图块数量">
              {visibleLevels.map(({ n, i }) => (
                <div className={`level-row ${n ? '' : 'empty-level'}`} key={i}>
                  <span>L{i}</span>
                  <div className="bar-track">
                    <div
                      style={{
                        width: `${(n / histogramMax) * 100}%`,
                        background: `#${COLORS[i].toString(16).padStart(6, '0')}`,
                      }}
                    />
                  </div>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="selected-section">
            <div className="section-label">
              图块探针
              <Crosshair size={14} />
            </div>
            {stats.selected ? (
              <>
                <code className="tile-id">{stats.selected.id}</code>
                <div className="tile-facts">
                  <span>面 {stats.selected.face + 1}</span>
                  <span>层级 {stats.selected.level}</span>
                  <span>
                    x {stats.selected.x} · y {stats.selected.y}
                  </span>
                </div>
                <p>
                  {stats.selected.level === MAX_LEVEL
                    ? '已到达这一版的最细层级。'
                    : '继续放大，这一块会由四个子块接替。'}
                </p>
              </>
            ) : (
              <p>点击地球上的任意位置，查看它所在图块的地址。</p>
            )}
          </section>
          <Button
            className="approach-button"
            variant="outline"
            onClick={() =>
              engine.current?.flyTo(39.9, 116.4, hdEnabled ? 1 : 8)
            }
            disabled={!ready}
          >
            靠近北京
            <ArrowUpRight size={16} />
          </Button>
          <p className="footnote">
            {hdEnabled
              ? 'MapTiler · 全球约 2 米，部分地区更细'
              : 'EOX Sentinel-2 · 约 10 米 / 像素'}
            <br />
            {hdEnabled
              ? '非实时影像 · 未加载区域暂用 EOX'
              : '2025 年合成影像，非实时；放大按需加载。'}
            <br />
            个人非商业使用免费 · 保留来源署名
          </p>
          <div className="imagery-status" role="status" aria-live="polite">
            {stats.imagery.paused ? (
              <span>{stats.imagery.paused} 可切回 EOX 继续浏览。</span>
            ) : stats.imagery.failed ? (
              <>
                <span>部分影像暂未加载，先显示较粗底图。</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => engine.current?.retryImagery()}
                >
                  重试
                </Button>
              </>
            ) : stats.imagery.ready < stats.imagery.total ||
              !stats.imagery.total ? (
              <span>
                影像加载中 · {stats.imagery.ready} / {stats.imagery.total}
              </span>
            ) : (
              <span>当前区域影像已加载 · {stats.imagery.ready} 块</span>
            )}
          </div>
        </aside>
      </div>
      <footer className="footer">
        <span>
          CUBE SPHERE <span className="footer-dot">·</span>6 个根面 / 最深 L
          {MAX_LEVEL}
        </span>
        <span>
          <a href="https://cloudless.eox.at/" target="_blank" rel="noreferrer">
            EOxCloudless
          </a>
          {' by '}
          <a href="https://eox.at/" target="_blank" rel="noreferrer">
            EOX IT Services GmbH
          </a>
          {' (Contains modified Copernicus Sentinel data 2025) · '}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-NC-SA 4.0
          </a>
          {' · '}备用轮廓{' '}
          <a
            href="https://www.naturalearthdata.com/"
            target="_blank"
            rel="noreferrer"
          >
            Natural Earth
          </a>
        </span>
      </footer>
    </main>
  );
}
