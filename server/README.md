# Bunnyland 3D Server Plugin

Out-of-tree Bunnyland plugin that contributes 3D presentation components plus movement and collision systems.

The plugin entrypoint is `bunnyland_3d.bunnyland_plugins()`. When loaded by Bunnyland's plugin loader, it contributes:

- `Transform3DComponent`
- `Velocity3DComponent`
- `Collider3DComponent`
- `Render3DComponent`
- `RoomBounds3DComponent`
- `Movement3DSystem`

The code intentionally lives outside `bunnyland-server` to exercise and document the out-of-tree plugin path.
