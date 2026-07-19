# Bunnyland 3D administration

The 3D add-on contributes a server plugin plus a static web client bundle. The server plugin
adds optional 3D ECS data and simulation. The web bundle adds `/3d/`, `/3d/player.html`, and
`/3d/admin.html` pages to the Bunnyland website.

Use this guide to install the add-on package, deploy the client, and verify the
admin inspector.

## Server plugin

The Python package declares `bunnyland.3d` in the `bunnyland.plugins` entry-point group.

When loaded, it contributes:

- `Transform3DComponent` for room-local position and orientation;
- `Velocity3DComponent` for per-tick motion;
- `Collider3DComponent` for collision metadata;
- `Render3DComponent` for bundled asset, variant, shape, color, and visibility hints;
- `RoomBounds3DComponent` for room dimensions;
- `Environment3DComponent` for surfaces, atmosphere, roof state, and skyboxes;
- grouped prop, light, particle, and decoration-source components linked to rooms by
  `HasDecoration3D` presentation edges;
- `Movement3DSystem` for movement and bounds clamping;
- `Worldgen3DHook` for seeding generated worlds with 3D metadata.

Install the addon wheel into the stock Bunnyland server environment:

```bash
uv pip install --python .venv/bin/python dist/bunnyland_3d-*.whl
bunnyland serve
```

The plugin is `default_enabled=True`, so no separate `--plugin` flag is required once the
package is installed. If startup uses an explicit plugin list, include `--plugin bunnyland.3d`
and its required plugins. Do not add source paths or runtime module-import flags.

## Web routes

The web image copies the built client into `/usr/share/nginx/html/3d`.

| Route | Purpose |
|-------|---------|
| `/3d/` | Welcome page and entry-point picker. |
| `/3d/player.html` | Player-facing 3D client. |
| `/3d/admin.html` | Admin inspector for rooms, entities, and 3D projections. |

The player client uses play-scoped controller and projection APIs. The admin inspector
uses the admin-scoped world and 3D surfaces. The server's authorization-zone middleware
protects both; serving the static client does not grant API access.

The player checks 3D capability metadata and loads the current room from the play 3D
surface. The room response follows the same visible-entity boundary as the player room
projection and adds only presentation metadata. Scene schema v3 includes outdoor
environments and decoration groups. Deploy matching server and web
images together. Consult OpenAPI for concrete operations and payload schemas.

## Outdoor decoration

Select an outdoor room in `/3d/admin.html` and use **Preview** before **Apply**. Recipes are
available for meadow, forest, garden, marsh, desert, and wasteland rooms; other rooms with
`indoor=false` use a restrained fallback. **Reroll** changes generated placement while
preserving instance exclusions and manual overrides. **Apply to all outdoor rooms** is
idempotent and skips every room with `indoor=true`.

The roof checkbox is independent of the biome and indoor flag. A room without a roof renders
a skybox; a roofed room uses the enclosed-room path. Ground albedo, normal maps, and
equirectangular skyboxes accept PNG, JPEG, or WebP files through the existing media store.
Uploads can target the selected room or become the default for its biome. Take a world
snapshot before a whole-world apply, because these controls create persistent ECS entities.

## Build the images

Build the server image from the add-on repo:

```bash
docker build -f Dockerfile.server \
  --build-arg BUNNYLAND_SERVER_IMAGE=ghcr.io/thalismind/bunnyland-server@sha256:0ad1f0b64e0c8d9a5dd0d847df44ba10fd2494bf591068f7828f72c34909a8d2 \
  -t bunnyland-3d-server .
```

Build the web image with the published shared UI image as a build context:

```bash
docker build -f Dockerfile.web \
  --build-context bunnyland-ui-web=docker-image://ghcr.io/thalismind/bunnyland-ui-web:main \
  --build-arg BUNNYLAND_WEB_IMAGE=ghcr.io/thalismind/bunnyland-web@sha256:c5e760b57b8d5948b803f6366601f194151e5a655fb60eafe2c90c2556e04088 \
  -t bunnyland-3d-web .
```

The server image installs the Python plugin into the base server virtualenv. The web image
extends the stock Bunnyland web image and adds only the `/3d/` static bundle.

## Local checks

Run the web and browser checks from the repo root:

```bash
scripts/test-web
```

For server checks, install the exact validated Bunnyland wheel and the addon into an
isolated environment. Installing the addon with `--no-deps` ensures its generic dependency
cannot replace the wheel under test:

```bash
uv venv /tmp/bunnyland-3d-test
uv pip install --python /tmp/bunnyland-3d-test/bin/python \
  "${BUNNYLAND_WHEEL}[server]" pytest httpx trimesh
uv pip install --python /tmp/bunnyland-3d-test/bin/python --no-deps ./server
/tmp/bunnyland-3d-test/bin/python -m pytest server/tests
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
5. Open `/3d/player.html`, claim a test character, walk with WASD, confirm an exit prompt,
   submit a cheap action, and cancel a queued action.
6. Capture a canvas PNG and confirm it is not blank.

If the player reports an incompatible scene, confirm the addon wheel is installed, its
`bunnyland.3d` entry point is discovered, and the generated or loaded world contains 3D
components. The admin inspector may use deterministic layout for entities without explicit
3D state; the player fails closed when the required scene schema is unavailable.

## Operational notes

The 3D add-on is presentation and movement metadata layered on top of the shared ECS world.
It should compose with content packs and controller plugins. The normal action pipeline still
owns permissions, reachability, costs, queueing, and rejection messages.

Keep generated artifacts, screenshots, and `node_modules` out of commits unless the repo's
ignore rules explicitly call for them.
