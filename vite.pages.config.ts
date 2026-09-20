import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// The globe runs entirely in the browser; Pages needs no server bundle.
export default defineConfig(({ command, mode, isPreview }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, root, 'VITE_');
  const key = process.env.VITE_MAPTILER_KEY || env.VITE_MAPTILER_KEY;
  if (command === 'build' && !isPreview && !key?.trim()) {
    throw new Error(
      'Set VITE_MAPTILER_KEY in .env.production.local before building the public HD site.',
    );
  }
  return {
    base: '/terra/',
    plugins: [react()],
    resolve: { alias: { '@': root } },
    css: { postcss: { plugins: [tailwindcss()] } },
    build: { outDir: 'dist/pages' },
  };
});
