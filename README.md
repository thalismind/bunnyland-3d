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
- `server/tests/` - Python plugin tests run against an installed Bunnyland artifact.
- `scripts/test-web` - runs the web checks.
- `Dockerfile.server` - extends the published Bunnyland server image with the 3D plugin.
- `Dockerfile.web` - extends the published Bunnyland web image with `/3d/` static assets.

## Server Plugin

The installed package declares plugin id `bunnyland.3d` in the canonical
`bunnyland.plugins` entry-point group and contributes:

- `Transform3DComponent` - entity position and orientation in room-local 3D space.
- `Velocity3DComponent` - per-tick motion state.
- `Collider3DComponent` - collision radius/height metadata.
- `Render3DComponent` - client-facing bundled asset, variant, shape, color, and visibility hints.
- `RoomBounds3DComponent` - room dimensions used by simulation and clients.
- outdoor environment, grouped-prop, light, particle-emitter, and recipe ownership components.
- `Movement3DSystem` - advances velocity/transform state and clamps movement through the
  collision/bounds helpers.
- `Worldgen3DHook` - enriches generated worlds with default 3D room bounds, transforms,
  colliders, and render hints.

`default_enabled=True`, so installing the wheel into the server environment is enough for
Bunnyland to discover and register the plugin. Source-checkout path injection and runtime
module aliases are not supported.

## Running

Install the addon wheel and start the stock Bunnyland server:

```bash
uv pip install --python .venv/bin/python dist/bunnyland_3d-*.whl
bunnyland serve
```

The plugin is designed to compose with other installed addons. When using an explicit plugin
selection, select their stable ids:

```bash
bunnyland serve --plugin bunnyland.3d --plugin bunnyland.rl
```

Run server tests against the exact validated wheel in an isolated environment:

```bash
uv venv /tmp/bunnyland-3d-test
uv pip install --python /tmp/bunnyland-3d-test/bin/python \
  "${BUNNYLAND_WHEEL}[server]" pytest httpx trimesh
uv pip install --python /tmp/bunnyland-3d-test/bin/python --no-deps ./server
/tmp/bunnyland-3d-test/bin/python -m pytest server/tests
```

## Web Client

The web app is a Vite/Three.js project that depends on `@bunnyland/ui-web` for shared theme
tokens, browser API helpers, player action helpers, and reusable widgets while remaining
out-of-tree. Local workspace development can resolve the file dependency; CI supplies the
published shared UI image as a named BuildKit context.

```bash
cd web
npm install
npm run dev
```

Open the printed Vite URL for the 3D welcome page, then choose the player or admin
client. Use the same-origin `/api/v1/` server setting; local development should proxy that
path to the API.

`admin.html` is a 3D inspector. It renders the admin overview and snapshot projections and
fetches selected room contents through the admin 3D surface. If the
server plugin is installed and projections include 3D fields, the client uses them; otherwise
it falls back to deterministic room layout. The inspector supports room/entity selection, 2D
and 3D modes, automatic or manual camera control, theme selection, and canvas PNG capture.

`player.html` is the playable 3D view. It requires scene schema v3 and
renders the current room at character scale with a third-person camera, local WASD roaming,
collision, animated bundled avatars, ECS-backed outdoor biome dressing, procedural or
uploaded terrain textures, roof-aware skyboxes, clickable targets, and proximity exit
prompts. Local roaming is presentation-only: confirmed exits and every other world change
still use normal server actions. Detailed actions, queues, activity, photos, and the remembered
map live in a collapsible HUD.

The plugin contributes separate play and admin HTTP surfaces. Its play room projection
adds 3D fields only to entities already admitted by Bunnyland's player room projection; it
does not expose raw or hidden ECS contents. The player refuses to start against an older
plugin instead of silently showing a misleading fallback scene.

Consult the server OpenAPI document for concrete API operations and payload schemas.

The camera capture button downloads the current canvas as a PNG. Playwright smoke tests also
save full-page screenshots with the toolbar/sidebar visible under `web/artifacts/`.

Generate deterministic 1080p screenshots for the itch page from the addon's own mock-world
browser workflow:

```bash
web/scripts/playwright-itch-screenshots --resolution 1080p --out-dir /tmp/bunnyland-itch-screenshots
```

Do not copy shared UI assets into this repo; import them from `@bunnyland/ui-web`.

## Docker Images

The root Dockerfiles extend the published Bunnyland images instead of replacing them:

```bash
docker build -f Dockerfile.server \
  --build-arg BUNNYLAND_SERVER_IMAGE=ghcr.io/thalismind/bunnyland-server@sha256:0ad1f0b64e0c8d9a5dd0d847df44ba10fd2494bf591068f7828f72c34909a8d2 \
  -t bunnyland-3d-server .

docker build -f Dockerfile.web \
  --build-context bunnyland-ui-web=docker-image://ghcr.io/thalismind/bunnyland-ui-web:main \
  --build-arg BUNNYLAND_WEB_IMAGE=ghcr.io/thalismind/bunnyland-web:main \
  -t bunnyland-3d-web .
```

`Dockerfile.server` installs the out-of-tree Python plugin into the base server virtualenv
without replacing the validated Bunnyland package. The installed entry point supplies the
plugin; deployment commands must not pass a runtime module-import flag.

`Dockerfile.web` builds both 3D clients and copies them into the extended web image at
`/usr/share/nginx/html/3d`. The welcome page is available at `/3d/`, the inspector is
available at `/3d/admin.html`, and the playable client is available at `/3d/player.html`.

## Development

Run the web and browser checks from the repo root:

```bash
scripts/test-web
```

For focused server work, use the isolated wheel procedure in [Running](#running). CI also
builds and tests the composite server image from a freshly pulled published base.

See [`server/README.md`](server/README.md) for the server plugin summary and
[`docs/out-of-tree-plugins.md`](docs/out-of-tree-plugins.md) for the broader out-of-tree
plugin workflow.

## Contributing & Conduct

This plugin follows the Bunnyland project's [contribution guidelines](CONTRIBUTING.md) and
[code of conduct](CODE_OF_CONDUCT.md), which point back to the `bunnyland-server`
repository.

## License

Licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
