# Terra

A satellite globe built with Three.js and React. The public site shows only the interactive planet and imagery credits. The local development app retains the quadtree inspector.

**Live demo:** https://popsoda2002.github.io/terra/

## Run

Use Node 22.13+ and pnpm. `pnpm dev` starts the local preview; `pnpm build` makes the production build. `node --test tests/*.test.mjs` checks orientation, coverage, refinement, culling, image bounds, loading and cache behavior.

## GitHub Pages

`pnpm build:pages` builds the minimal public app (`components/terra.tsx`) as a static site in `dist/pages`, with the `/terra/` base path. `pnpm preview:pages` serves that production build locally. Source lives on `main`; the compiled website lives on `gh-pages`. In repository Settings → Pages, use **Deploy from a branch → gh-pages → / (root)**. No server or paid hosting is needed.

After testing a change, commit and push its source to `main`, then run `npm run deploy:pages`. This builds the site and updates `gh-pages` with a normal Git push; it requires repository write access but no workflow permission. The script uses a temporary checkout and preserves existing deployment history. GitHub Pages publishes the branch automatically after each deployment push.

New visitors see EOX imagery without any setup. The public app also restores an existing MapTiler key from this tab's session, if present, and falls back to EOX when unavailable. It has no key form, controls, tile inspection, grids, or debug panels. Localhost session storage does not carry over to the published site. Keys are never part of the repository or build.

## Interaction

On the public site, drag or use arrow keys to rotate; scroll, pinch, or press +/− to zoom. The planet fits both landscape and portrait screens. The following extra controls belong to the local development app only.

Drag or use arrow keys to orbit. Scroll, pinch, press +/− or use the altitude slider to zoom. Click the globe to inspect a tile. Toggle satellite imagery / LOD colors. Tile density is selected automatically as you zoom. Altitude is limited to 0.5–24,000 km; the tree is capped at L17. The Beijing button flies to 1 km with MapTiler or 8 km with EOX. Rotation and zoom slow near the surface.

## Algorithm

`lib/quadtree.mjs` owns six face trees and screen-size-based recursive selection. Horizon and view-frustum culling remove invisible patches. Separate split/merge thresholds reduce oscillation. `lib/globe.js` builds a mesh from the selected leaves, uses skirts to bridge LOD seams, and shares a single shader/material across patches. Three.js supplies rendering and camera controls; it does not choose the quadtree tiles.

The displayed tile counter is the number of selected leaves, not GPU draw calls. Geometry sharing the same image is batched into one material group. The globe remains a sphere without a terrain elevation model.

## Satellite imagery

The default layer is EOX `s2cloudless-2025`, a Sentinel-2 cloudless composite at approximately 10 m per pixel. It is not live imagery or street-level photography. No API key is needed. The public EOX service is rate limited and provided without an availability guarantee.

`lib/imagery-tiles.mjs` computes geographic bounds for cube patches, including poles and date-line wrapping. `lib/satellite.js` retrieves 512-pixel WMS images from EOX directly in the browser, with four concurrent jobs, timeouts, retry handling, ancestor fallback and a 160-image LRU cache. Date-line patches use two legal WMS bounding boxes. The image selection caps target patches at 96 and image level at L12; geometry may reach L17. Fine imagery replaces its loaded ancestors as it arrives. Increasing geometry detail beyond the source resolution cannot create additional image information.

EOX imagery is used for this personal, non-commercial educational prototype under CC BY-NC-SA 4.0. Keep the visible attribution and links: **EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH https://eox.at (Contains modified Copernicus Sentinel data 2025)**. Commercial use requires a separate EOX license. See https://cloudless.eox.at/documentation/license and https://maps.eox.at/ for terms and public-service limits.

Natural Earth land data, redistributed by world-atlas 2.0.2 (https://github.com/topojson/world-atlas), remains the lightweight fallback while the first satellite images load or if the service is unavailable.

### Optional MapTiler layer

Create your own Free account at https://cloud.maptiler.com/ and copy an API key from **API keys**. Paste it into **高清卫星影像 → 启用高清** in the app. No payment or account creation is performed by this app. The key is held in tab-scoped `sessionStorage` and sent only to MapTiler; **切回 EOX / 移除 key** removes it. It is never included in source, server logs, or WebMCP state. For a restricted key, allow the preview origin `http://localhost:3001` in MapTiler's settings.

`lib/maptiler-tiles.mjs` reads the Satellite TileJSON (current `satellite-v4`, with `satellite-v2` fallback only on 404), validates the tile host, and plans XYZ mosaics. `lib/satellite.js` shares compressed XYZ responses in a 128-entry memory cache and builds Mercator textures. The renderer computes local UVs in double precision to retain detail at close zoom. Up to L16 image patches replace their ancestors; EOX remains visible while loading and supplies polar coverage beyond Web Mercator's ±85.05° limit. Auth/quota errors pause new MapTiler work; reconnect or use EOX to recover.

The provider advertises about 2 m global satellite coverage and finer aerial imagery in selected areas. Actual resolution and imagery dates vary by location; zooming cannot add source detail. Preserve the MapTiler logo and copyright links and EOX attribution. See https://docs.maptiler.com/schema-raster/satellite/, https://docs.maptiler.com/cloud/api/tiles/ and https://www.maptiler.com/cloud/pricing/. This is a personal noncommercial prototype; choose Free in the provider dashboard. Live MapTiler imagery must be verified with the owner's valid key; unit tests use synthetic responses and never shared/demo keys.

Optional browser WebMCP tools: `get_globe_state` and `configure_globe`. There is no app-owned account or analytics. Only the optional MapTiler key is remembered for the current browser session.
