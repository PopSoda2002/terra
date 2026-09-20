import { MIN_ALTITUDE_KM, MAX_ALTITUDE_KM } from './quadtree.mjs';

export function registerGlobeTools(readState, configure) {
  const context = document.modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools = [
    {
      name: 'get_globe_state',
      title: '读取地球分块状态',
      description:
        'Read the current camera altitude, tile counts, LOD histogram, satellite-image loading and cache status, display settings and selected tile.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (input && Object.keys(input).length)
          throw new Error('No arguments expected');
        return readState();
      },
    },
    {
      name: 'configure_globe',
      title: '调整地球观察参数',
      description:
        'Set camera altitude, satellite imagery (map) or LOD coloring (levels), and tile boundaries in the visible globe. Imagery loads asynchronously; read back image status with get_globe_state.',
      inputSchema: {
        type: 'object',
        properties: {
          altitudeKm: {
            type: 'number',
            minimum: MIN_ALTITUDE_KM,
            maximum: MAX_ALTITUDE_KM,
          },
          mode: { type: 'string', enum: ['map', 'levels'] },
          showGrid: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      async execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('Expected a settings object');
        for (const key of Object.keys(input))
          if (!['altitudeKm', 'mode', 'showGrid'].includes(key))
            throw new Error('Unknown setting: ' + key);
        for (const [key, min, max] of [
          ['altitudeKm', MIN_ALTITUDE_KM, MAX_ALTITUDE_KM],
        ])
          if (
            key in input &&
            (!Number.isFinite(input[key]) ||
              input[key] < min ||
              input[key] > max)
          )
            throw new Error(`${key} must be between ${min} and ${max}`);
        if ('mode' in input && !['map', 'levels'].includes(input.mode))
          throw new Error('Invalid display mode');
        if ('showGrid' in input && typeof input.showGrid !== 'boolean')
          throw new Error('showGrid must be boolean');
        if (!readState().ready) throw new Error('Globe is not ready');
        configure(input);
        await new Promise((resolve) => setTimeout(resolve, 350));
        return readState();
      },
    },
  ];
  for (const tool of tools)
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Browser does not support this experimental API. */
    }
  return () => lifecycle.abort();
}
