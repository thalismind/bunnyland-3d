# Bunnyland 3D administration

The 3D add-on contributes a server plugin plus a static web client bundle. The server plugin
adds optional 3D ECS data and simulation. The web bundle adds `/3d/`, `/3d/player.html`, and
`/3d/admin.html` pages to the Bunnyland website.

Use this guide to install the add-on, load the module, deploy the client, and verify the
admin inspector.

## Server plugin

The Python package exposes `bunnyland_3d.bunnyland_plugins()` and registers plugin id
`bunnyland.3d`.

When loaded, it contributes:

- `Transform3DComponent` for room-local position and orientation;
- `Velocity3DComponent` for per-tick motion;
- `Collider3DComponent` for collision metadata;
- `Render3DComponent` for client-facing model, color, and scale hints;
- `RoomBounds3DComponent` for room dimensions;
- `Movement3DSystem` for movement and bounds clamping;
- `Worldgen3DHook` for seeding generated worlds with 3D metadata.

Load it with the stock Bunnyland server:

```bash
bunnyland serve --module bunnyland_3d
```

The plugin is `default_enabled=True`, so no separate `--plugin` flag is required once the
module is importable. If a container or supervisor overrides the server command, keep
`--module bunnyland_3d` in the final arguments.

## Web routes

The web image copies the built client into `/usr/share/nginx/html/3d`.

| Route | Purpose |
|-------|---------|
| `/3d/` | Welcome page and entry-point picker. |
| `/3d/player.html` | Player-facing 3D client. |
| `/3d/admin.html` | Admin inspector for rooms, entities, and 3D projections. |

The player client uses public controller and projection APIs. The admin inspector loads
admin world data such as `/world/overview` and `/world/snapshot`; protect the API the same
way you protect the rest of `/admin/*` and world inspection surfaces.

## Build the images

Build the server image from the add-on repo:

```bash
docker build -f Dockerfile.server \
  --build-arg BUNNYLAND_SERVER_IMAGE=ghcr.io/thalismind/bunnyland-server:main \
  -t bunnyland-3d-server .
```

Build the web image with the sibling shared UI package as a build context:

```bash
docker build -f Dockerfile.web \
  --build-context bunnyland-ui-web=../bunnyland-ui-web \
  --build-arg BUNNYLAND_WEB_IMAGE=ghcr.io/thalismind/bunnyland-web:main \
  -t bunnyland-3d-web .
```

The server image installs the Python plugin into the base server virtualenv. The web image
extends the stock Bunnyland web image and adds only the `/3d/` static bundle.

## Local checks

Run all add-on checks from the repo root:

```bash
scripts/check
```

Run only the server plugin checks:

```bash
BUNNYLAND_SERVER_PATH=../bunnyland-server scripts/test-server
```

Run only the web checks:

```bash
scripts/test-web
```

The web smoke tests save screenshots under `web/artifacts/`, including 2D, 3D, canvas, and
player views. Use those images to catch blank canvases, broken framing, and missing shared UI
assets before deploying.

## Verify a deployment

After deployment:

1. Open `/3d/` and confirm the welcome page loads.
2. Open `/3d/admin.html`, set the server to `/api`, and load the world overview.
3. Select a room and confirm room contents appear.
4. Toggle 2D/3D mode and automatic/manual camera.
5. Open `/3d/player.html`, claim a test character, submit a cheap action, and cancel a queued
   action.
6. Capture a canvas PNG and confirm it is not blank.

If the view falls back to deterministic layout, confirm the server was started with
`--module bunnyland_3d` and that the generated or loaded world contains 3D components.

## Operational notes

The 3D add-on is presentation and movement metadata layered on top of the shared ECS world.
It should compose with content packs and controller plugins. The normal action pipeline still
owns permissions, reachability, costs, queueing, and rejection messages.

Keep generated artifacts, screenshots, and `node_modules` out of commits unless the repo's
ignore rules explicitly call for them.
