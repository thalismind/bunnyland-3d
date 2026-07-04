# Bunnyland 3D

Out-of-tree [Bunnyland](https://github.com/thalismind/bunnyland-server) plugin that
adds 3D presentation state, movement/collision simulation, worldgen enrichment, and
standalone Three.js clients.

The package has two halves:

- **Server plugin** - contributes 3D ECS components, a movement system, collision helpers,
  projection helpers, and a worldgen hook that seeds generated rooms/entities with 3D layout
  metadata.
- **Web clients** - build a playable 3D client and an admin 3D inspector that can run beside
  the stock Bunnyland web UI under `/3d/`.

This repo intentionally keeps all 3D work outside the main `bunnyland-server` and
`bunnyland-web` repos so it exercises the same out-of-tree plugin path used by optional
content packs.

## Layout

- `server/` - Python Bunnyland plugin package with 3D ECS components, movement, collision,
  projection helpers, worldgen enrichment, and tests.
- `web/` - standalone Vite/Three.js welcome page, admin inspector, and playable client.
- `docs/out-of-tree-plugins.md` - guide for building and testing OOT Bunnyland plugins.
- `scripts/test-server` - runs Python tests against a sibling `bunnyland-server` checkout.
- `scripts/test-web` - runs the web checks.
- `scripts/check` - runs both server and web checks.
- `Dockerfile.server` - extends the published Bunnyland server image with the 3D plugin.
- `Dockerfile.web` - extends the published Bunnyland web image with `/3d/` static assets.

## Server Plugin

The plugin exposes `bunnyland_3d.bunnyland_plugins()` and contributes:

- `Transform3DComponent` - entity position and orientation in room-local 3D space.
- `Velocity3DComponent` - per-tick motion state.
- `Collider3DComponent` - collision radius/height metadata.
- `Render3DComponent` - client-facing model, color, and scale hints.
- `RoomBounds3DComponent` - room dimensions used by simulation and clients.
- `Movement3DSystem` - advances velocity/transform state and clamps movement through the
  collision/bounds helpers.
- `Worldgen3DHook` - enriches generated worlds with default 3D room bounds, transforms,
  colliders, and render hints.

`default_enabled=True`, so loading the module is enough for Bunnyland to register the plugin.
The `bunnyland_3d` package must be importable by the server, either installed into the server
environment or available on `PYTHONPATH`.

## Running

Load the server plugin with the stock Bunnyland server:

```bash
bunnyland serve --module bunnyland_3d
```

The plugin is designed to compose with other modules. For example, the RL plugin can be loaded
alongside it:

```bash
bunnyland serve --module bunnyland_3d --module bunnyland_rl
```

If a deployment overrides the container command, keep `--module bunnyland_3d` in the server
arguments so the 3D components, worldgen hook, and system are loaded.

Run server tests against a sibling `bunnyland-server` checkout:

```bash
BUNNYLAND_SERVER_PATH=../bunnyland-server scripts/test-server
```

## Web Client

The web app is a Vite/Three.js project that depends on the sibling `@bunnyland/ui-web`
package for shared theme tokens, browser API helpers, player action helpers, and reusable
widgets while remaining out-of-tree.

```bash
cd web
npm install
npm run dev
```

Open the printed Vite URL for the 3D welcome page, then choose the player or admin
client. Set the Bunnyland API server to `/api/` or a full server URL.

`admin.html` is a 3D inspector. It renders `/world/overview`, loads `/world/snapshot` for
3D component state, and fetches selected room contents from `/world/room/{id}`. If the
server plugin is installed and projections include 3D fields, the client uses them; otherwise
it falls back to deterministic room layout. The inspector supports room/entity selection, 2D
and 3D modes, automatic or manual camera control, theme selection, and canvas PNG capture.

`player.html` is the playable 3D view. It claims a character through the public
web-controller API, follows the current room with animated camera focus, shows searchable
actions, displays queued commands with click-to-cancel controls, and can request server scene
images. Remembered rooms are stored in browser `localStorage` per server and character, so
fogged rooms remain visible after refresh while their contents stay hidden until revisited.

The camera capture button downloads the current canvas as a PNG. Playwright smoke tests also
save full-page screenshots with the toolbar/sidebar visible under `web/artifacts/`.

Do not copy shared UI assets into this repo; import them from `@bunnyland/ui-web`.

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

`Dockerfile.web` builds both 3D clients and copies them into the extended web image at
`/usr/share/nginx/html/3d`. The welcome page is available at `/3d/`, the inspector is
available at `/3d/admin.html`, and the playable client is available at `/3d/player.html`.

## Development

Run all checks from the repo root:

```bash
scripts/check
```

For focused server work:

```bash
BUNNYLAND_SERVER_PATH=../bunnyland-server scripts/test-server
```

For focused web work:

```bash
scripts/test-web
```

See [`server/README.md`](server/README.md) for the server plugin summary and
[`docs/out-of-tree-plugins.md`](docs/out-of-tree-plugins.md) for the broader out-of-tree
plugin workflow.

## Contributing & Conduct

This plugin follows the Bunnyland project's [contribution guidelines](CONTRIBUTING.md) and
[code of conduct](CODE_OF_CONDUCT.md), which point back to the `bunnyland-server`
repository.

## License

Licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
