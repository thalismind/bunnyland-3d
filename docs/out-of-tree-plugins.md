# Building Out-of-Tree Bunnyland Plugins

This repository is the reference pattern for a Bunnyland plugin that lives outside the
main `bunnyland-server` tree.

## Repository Layout

- `server/` is a Python package. It exposes `bunnyland_plugins()` from `bunnyland_3d`.
- `web/` is a standalone Vite client. It consumes Bunnyland HTTP APIs and optional 3D
  projection fields from the plugin.
- `scripts/` runs local checks across both halves.

Keep plugin code out of `bunnyland-server` and client code out of `bunnyland-web`.

## Plugin Entry Point

Bunnyland's plugin loader imports a Python module and looks for:

```python
def bunnyland_plugins() -> list[Plugin]:
    return [plugin()]
```

The module can be loaded by name:

```python
from bunnyland.plugins import load_and_apply

load_and_apply(actor, modules=["bunnyland_3d"])
```

When the loader imports an out-of-tree module, it qualifies plugin ids with the module
name. This plugin's local id is `bunnyland_3d`; loaded from module `bunnyland_3d`, the
qualified id is `bunnyland_3d.bunnyland_3d`.

## ECS Contributions

Contribute ECS types through `EcsContribution`:

```python
Plugin(
    id="bunnyland_3d",
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

Use a sibling checkout of `bunnyland-server`:

```bash
repo/
  bunnyland-server/
  bunnyland-3d/
```

Run all checks:

```bash
cd bunnyland-3d
scripts/check
```

Run only server tests:

```bash
BUNNYLAND_SERVER_PATH=../bunnyland-server scripts/test-server
```

The server test script sets `PYTHONPATH` to both `server/src` and the Bunnyland server
checkout. If `uv` is available, it runs tests inside the Bunnyland server project
environment using `uv run --project ../bunnyland-server -m pytest ...`.

Vite clients should depend on shared web UI through `@bunnyland/ui-web` instead of
copying assets from `bunnyland-web`. Use narrow imports such as `@bunnyland/ui-web/api`,
`@bunnyland/ui-web/play`, `@bunnyland/ui-web/theme`, `@bunnyland/ui-web/player-widgets`,
and `@bunnyland/ui-web/admin-widgets` so bundlers can tree shake player-only and
admin-only surfaces independently.

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
  --build-context bunnyland-ui-web=../bunnyland-ui-web \
  -t bunnyland-3d-web .
```

When extending the server command in compose or Kubernetes, include
`--module bunnyland_3d`. Installing the Python package makes the module importable, but
the Bunnyland server only applies out-of-tree plugins that are requested at startup.
The 3D web image serves the client index at `/3d/`, the admin inspector at
`/3d/admin.html`, and the playable client at `/3d/player.html`.

## CI

The included workflow checks out this repo and a separate Bunnyland server repo, then
runs the plugin tests against the server source. Set repository variable
`BUNNYLAND_SERVER_REPOSITORY` if your server repo is not `ssube/bunnyland-server`.

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
