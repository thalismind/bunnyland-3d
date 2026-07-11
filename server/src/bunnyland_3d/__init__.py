"""Out-of-tree Bunnyland 3D plugin package."""

from .assets import (
    AssetSource,
    ModelAsset,
    ModelAssetError,
    ModelAssetRegistry,
    ModelTransform,
    register_model_importer,
    register_models,
    require_model_registry,
)
from .components import (
    BiomeStyle3DComponent,
    Collider3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    HasDecoration3D,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    PropInstanceOverride,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
    Velocity3DComponent,
)
from .decorations import RoomDecorationRule, register_room_decorations
from .plugin import PLUGIN_ID, bunnyland_plugins, plugin
from .systems import Movement3DSystem, step_entities

__all__ = [
    "PLUGIN_ID",
    "AssetSource",
    "BiomeStyle3DComponent",
    "Collider3DComponent",
    "DecorationSource3DComponent",
    "Environment3DComponent",
    "HasDecoration3D",
    "Light3DComponent",
    "Movement3DSystem",
    "ModelAsset",
    "ModelAssetError",
    "ModelAssetRegistry",
    "ModelTransform",
    "ParticleEmitter3DComponent",
    "PropGroup3DComponent",
    "PropInstanceOverride",
    "Render3DComponent",
    "RoomBounds3DComponent",
    "RoomDecorationRule",
    "Transform3DComponent",
    "Vector3",
    "Velocity3DComponent",
    "bunnyland_plugins",
    "plugin",
    "register_model_importer",
    "register_models",
    "register_room_decorations",
    "require_model_registry",
    "step_entities",
]
