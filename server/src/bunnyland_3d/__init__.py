"""Out-of-tree Bunnyland 3D plugin package."""

from .components import (
    Collider3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
    Velocity3DComponent,
)
from .plugin import PLUGIN_ID, bunnyland_plugins, plugin
from .systems import Movement3DSystem, step_entities

__all__ = [
    "PLUGIN_ID",
    "Collider3DComponent",
    "Movement3DSystem",
    "Render3DComponent",
    "RoomBounds3DComponent",
    "Transform3DComponent",
    "Vector3",
    "Velocity3DComponent",
    "bunnyland_plugins",
    "plugin",
    "step_entities",
]
