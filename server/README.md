# Bunnyland 3D Server Plugin

Out-of-tree Bunnyland plugin that contributes 3D presentation components plus movement and collision systems.

The plugin entrypoint is `bunnyland_3d.bunnyland_plugins()`. When loaded by Bunnyland's plugin loader, it contributes:

- `Transform3DComponent`
- `Velocity3DComponent`
- `Collider3DComponent`
- `Render3DComponent`
- `RoomBounds3DComponent`
- `Movement3DSystem`
- player-safe v2 capability and room-scene HTTP projections

`Render3DComponent.asset_key` and `variant_key` are validated logical keys, not remote
URLs. Core models come from the web bundle; other plugins can register GLB, glTF, OBJ, and
STL models through `ModelAssetRegistry`. The server converts them to immutable GLB media
and exposes `GET /3d/v2/assets/manifest`. The player negotiates
`GET /3d/v2/capabilities` and loads visible presentation state from
`GET /3d/v2/room/{room_id}`.

The code intentionally lives outside `bunnyland-server` to exercise and document the out-of-tree plugin path.
