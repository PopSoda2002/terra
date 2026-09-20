import { useEffect, useRef, useState } from 'react';

export default function Terra() {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [hdEnabled, setHdEnabled] = useState(false);

  useEffect(() => {
    let stopped = false;
    let globe: import('../lib/globe.js').Globe | undefined;

    import('../lib/globe.js')
      .then(({ Globe }) => {
        if (stopped || !mount.current) return;
        globe = new Globe(
          mount.current,
          (state: { imagery: { paused?: string } }) => {
            if (stopped) return;
            setReady(true);
            if (state.imagery.paused) {
              globe?.useEOX();
              setHdEnabled(false);
            }
          },
          (message: string) => {
            if (!stopped) setError(message);
          },
          { presentation: true },
        );

        // This read-only browser key is intentionally included in the public
        // build, so every visitor gets HD without a per-tab setup step.
        let key = import.meta.env.VITE_MAPTILER_KEY?.trim() || '';
        if (!key) {
          try {
            key = sessionStorage.getItem('terra.maptilerKey') || '';
          } catch {}
        }
        if (key) {
          globe
            .enableMapTiler(key)
            .then(() => {
              if (!stopped) setHdEnabled(true);
            })
            .catch(() => {
              /* EOX remains available if MapTiler cannot be reached. */
            });
        }
      })
      .catch(() => {
        if (!stopped)
          setError('地球暂时无法加载，请刷新页面或使用支持 WebGL 2 的浏览器。');
      });

    return () => {
      stopped = true;
      globe?.dispose();
    };
  }, []);

  return (
    <main className="terra" aria-label="Terra">
      <div className="terra-globe" ref={mount} />
      {!ready && !error && (
        <div
          className="terra-loading"
          role="status"
          aria-label="正在加载地球"
        />
      )}
      {error && (
        <p className="terra-error" role="alert">
          {error}
        </p>
      )}
      <footer className="terra-attribution" aria-label="影像来源">
        {hdEnabled && (
          <span className="terra-provider">
            <a
              href="https://www.maptiler.com/"
              target="_blank"
              rel="noreferrer"
            >
              <img
                src="https://api.maptiler.com/resources/logo.svg"
                alt="MapTiler logo"
                width="82"
                height="22"
              />
            </a>
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
          </span>
        )}
        <span>
          <a href="https://cloudless.eox.at/" target="_blank" rel="noreferrer">
            EOxCloudless
          </a>
          {' by '}
          <a href="https://eox.at/" target="_blank" rel="noreferrer">
            EOX IT Services GmbH
          </a>
          {' · Contains modified Copernicus Sentinel data 2025 · '}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-NC-SA 4.0
          </a>
        </span>
      </footer>
    </main>
  );
}
