# Building Out-of-Tree Bunnyland Plugins

This repository is the reference pattern for a Bunnyland plugin that lives outside the
main `bunnyland-server` tree.

## Repository Layout

- `server/` is a Python package. It declares its plugin through package metadata.
- `web/` is a standalone Vite client. It consumes Bunnyland HTTP APIs and optional 3D
  projection fields from the plugin.
- `scripts/` runs local checks across both halves.

Keep plugin code out of `bunnyland-server` and client code out of `bunnyland-web`.

## Plugin Entry Point

Bunnyland discovers installed plugins through the `bunnyland.plugins` entry-point group:

```toml
[project.entry-points."bunnyland.plugins"]
"vendor.forest" = "vendor_forest.plugin:plugin"
```

The target returns a `Plugin` with a globally stable id:

```python
def plugin() -> Plugin:
    return Plugin(id="vendor.forest", name="Forest Visuals")
```

The server selects and orders discovered plugins from their declared dependencies.

## ECS Contributions

Contribute ECS types through `EcsContribution`:

```python
Plugin(
    id="bunnyland.3d",
    name="Bunnyland 3D",
    ecs=EcsContribution(
        components=(Transform3DComponent, Velocity3DComponent),
        systems=(Movement3DSystem,),
    ),
)
```

The main server does not need to import these classes directly. Once the plugin is
loaded, Bunnyland persistence, schemas, patches, and systems can discover the types from
the plugin contribution list.

## Local Development

Build Bunnyland once at the exact server commit under test and pass that wheel artifact to
every addon checkout. Install the wheel and addon in an isolated environment; do not add a
server source checkout to Python's import path:

```bash
export BUNNYLAND_WHEEL=/artifacts/bunnyland-0.2.0-py3-none-any.whl
uv venv /tmp/vendor-forest-test
uv pip install --python /tmp/vendor-forest-test/bin/python \
  "${BUNNYLAND_WHEEL}[server]" pytest httpx
uv pip install --python /tmp/vendor-forest-test/bin/python --no-deps ./server
/tmp/vendor-forest-test/bin/python -m pytest server/tests
```

Using `--no-deps` for the addon install is intentional: the separately installed wheel is
the server contract being tested. Ruff and the complete addon coverage suite should run in
that same environment.

Vite clients should depend on shared web UI through `@bunnyland/ui-web` instead of
copying assets from `bunnyland-web`. Use narrow imports such as `@bunnyland/ui-web/api`,
`@bunnyland/ui-web/play`, `@bunnyland/ui-web/theme`, `@bunnyland/ui-web/player-widgets`,
and `@bunnyland/ui-web/admin-widgets` so bundlers can tree shake player-only and
admin-only surfaces independently.

## Registering 3D Models

Visual plugins can publish models without changing the 3D addon or its web bundle. Declare
`bunnyland.3d` as a dependency and register assets from an integration factory, which runs
after the model registry is ready:

```python
from pathlib import Path

from bunnyland.plugins import DependencyContribution, Plugin, RuntimeContribution
from bunnyland_3d import AssetSource, ModelAsset, register_models

ASSETS = Path(__file__).with_name("assets")

def install_visuals(actor):
    register_models(actor, "vendor.forest", [
        ModelAsset(
            key="vendor.forest/oak",
            source=AssetSource(root=ASSETS, path="oak.stl"),
            default_color="#628b4a",
            instanced=True,
            license="CC0-1.0",
        ),
    ])

def plugin() -> Plugin:
    return Plugin(
        id="vendor.forest",
        name="Forest Visuals",
        dependencies=DependencyContribution(requires=("bunnyland.3d",)),
        runtime=RuntimeContribution(integration_factories=(install_visuals,)),
    )
```

GLB, glTF (including local sidecars), OBJ/MTL, and ASCII or binary STL are accepted. The
server validates plugin-owned roots, converts non-GLB inputs to content-addressed GLB, and
publishes safe URLs through `GET /3d/v2/assets/manifest`. STL has no material convention, so
set `default_color` when appearance matters. Use `instanced=True` only for static models;
animated, skinned, and interactive props should remain individual ECS entities.

## Docker Packaging

An out-of-tree plugin should ship extension images, not forks of the main server and web
repos. This repo provides that pattern with:

- `Dockerfile.server`, which starts from `ghcr.io/thalismind/bunnyland-server:main` by
  default and installs the plugin package into the existing server virtualenv.
- `Dockerfile.web`, which starts from `ghcr.io/thalismind/bunnyland-web:main` by default
  and adds the built 3D welcome page, inspector, and player clients under `/3d/`.

Build the server image from this repo as the Docker context:

```bash
docker build -f Dockerfile.server -t bunnyland-3d-server .
```

Build the web image with the shared UI package supplied as a named BuildKit context:

```bash
docker build -f Dockerfile.web \
  --build-context bunnyland-ui-web=docker-image://ghcr.io/thalismind/bunnyland-ui-web:main \
  -t bunnyland-3d-web .
```

Installing the Python package makes its entry-point plugin discoverable. A
`default_enabled=True` addon is applied automatically unless startup selects an explicit
plugin subset; in that case include its stable plugin id. Do not add a module import flag or
source path.
The 3D web image serves the client index at `/3d/`, the admin inspector at
`/3d/admin.html`, and the playable client at `/3d/player.html`.

## CI

The included workflow builds its plugin test/runtime image from the published Bunnyland
server image and explicitly pulls the fresh base. It installs the addon into the existing
server virtualenv with `--no-deps`, runs the complete plugin suite, and publishes the
composite only after tests pass. It never imports a sibling server checkout.

The web job builds the standalone client and captures 3D/2D screenshots with Playwright.
It stores both downloaded canvas PNGs and full-page screenshots so the toolbar and side
panel are visible in CI artifacts.

## Design Rules

- Do not edit `bunnyland-server` for plugin components, systems, or tests.
- Do not edit `bunnyland-web` for this client.
- Do not vendor shared web UI assets; import them from `@bunnyland/ui-web`.
- Model singleton state as components.
- Model repeatable relationships as edges in Bunnyland, not multiple components of the
  same type on one entity.
- Keep collision and projection helpers pure where possible so out-of-tree tests do not
  need a running HTTP server.
