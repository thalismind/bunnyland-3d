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

Open the printed Vite URL for the 3D welcome page, then choose the player or admin
client. Set the Bunnyland API server to `/api/` or a full server URL. The
`admin.html` client is a 3D inspector: it renders `/world/overview`, then loads
selected room contents from `/world/room/{id}`. If the server plugin is installed and
projections include 3D fields, the client uses them; otherwise it falls back to
deterministic room layout.

The `player.html` client is the playable 3D view. It claims a character through the
public web-controller API, follows the current room with the same animated camera focus,
shows searchable actions, and displays queued commands with click-to-cancel controls.
Remembered rooms are stored in browser `localStorage` per server and character, so fogged
rooms remain visible after refresh while their contents stay hidden until revisited.

The camera capture button downloads the current canvas as a PNG. Playwright smoke tests
also save full-page screenshots with the toolbar/sidebar visible under `web/artifacts/`.

The web client depends on the sibling `@bunnyland/ui-web` package for shared theme
tokens, browser helpers, player action helpers, and reusable widgets while remaining
out-of-tree. Do not copy shared UI assets into this repo.

## Docker Images

The root Dockerfiles extend the published Bunnyland images instead of replacing them:

```bash
docker build -f Dockerfile.server \
  --build-arg BUNNYLAND_SERVER_IMAGE=ghcr.io/thalismind/bunnyland-server:main \
  -t bunnyland-3d-server .

docker build -f Dockerfile.web \
  --build-context bunnyland-ui-web=../bunnyland-ui-web \
  --build-arg BUNNYLAND_WEB_IMAGE=ghcr.io/thalismind/bunnyland-web:main \
  -t bunnyland-3d-web .
```

`Dockerfile.server` installs the out-of-tree Python plugin into the base server
virtualenv and uses a default `bunnyland serve --module bunnyland_3d ...` command.
If a deployment overrides the container command, keep `--module bunnyland_3d` in the
server arguments so the plugin components, projections, and systems are loaded.

`Dockerfile.web` builds both 3D clients and copies them into the extended web image at
`/usr/share/nginx/html/3d`. The welcome page is available at `/3d/`, the inspector is
available at `/3d/admin.html`, and the playable client is available at `/3d/player.html`.

## Full Check

```bash
scripts/check
```
