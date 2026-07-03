# Bunnyland 3D

Out-of-tree Bunnyland 3D plugin and standalone Three.js client.

This repo intentionally keeps all 3D work outside the main `bunnyland-server` and
`bunnyland-web` repos.

## Layout

- `server/` - Python Bunnyland plugin package with 3D ECS components, movement, collision,
  projection helpers, and tests.
- `web/` - standalone Vite/Three.js admin viewer.
- `docs/out-of-tree-plugins.md` - guide for building and testing OOT Bunnyland plugins.
- `scripts/check` - runs server and web checks.

## Server Plugin

The plugin exposes `bunnyland_3d.bunnyland_plugins()` and contributes:

- `Transform3DComponent`
- `Velocity3DComponent`
- `Collider3DComponent`
- `Render3DComponent`
- `RoomBounds3DComponent`
- `Movement3DSystem`

Run server tests against a sibling `bunnyland-server` checkout:

```bash
BUNNYLAND_SERVER_PATH=../bunnyland-server scripts/test-server
```

## Web Client

```bash
cd web
npm install
npm run dev
```

Open the printed Vite URL and set the Bunnyland API server to `/api/` or a full server
URL. The client renders `/world/overview`, then loads selected room contents from
`/world/room/{id}`. If the server plugin is installed and projections include 3D fields,
the client uses them; otherwise it falls back to deterministic room layout.

The camera capture button downloads the current canvas as a PNG. Playwright smoke tests
also save full-page screenshots with the toolbar/sidebar visible under `web/artifacts/`.

The web client vendors `assets/bunnyland-ui.css` and `assets/bunnyland-ui.js` from
`bunnyland-web` so it can use the same theme names, CSS variables, and localStorage key
while remaining out-of-tree. Refresh those files from `bunnyland-web/assets` when the
shared UI theme contract changes.

## Full Check

```bash
scripts/check
```
