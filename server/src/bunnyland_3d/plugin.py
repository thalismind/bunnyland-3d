"""Bunnyland plugin entrypoint for the out-of-tree 3D extension."""

from __future__ import annotations

from bunnyland.plugins import ContentContribution, EcsContribution, Plugin, RuntimeContribution

from .api import install_3d_routes
from .components import (
    BiomeStyle3DComponent,
    Collider3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    HasDecoration3D,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Velocity3DComponent,
)
from .enrichment import Worldgen3DHook
from .systems import Movement3DSystem

PLUGIN_ID = "bunnyland.3d"
PLUGIN_VERSION = "0.3.0"


def plugin() -> Plugin:
    return Plugin(
        id=PLUGIN_ID,
        name="Bunnyland 3D",
        version=PLUGIN_VERSION,
        default_enabled=True,
        ecs=EcsContribution(
            components=(
                Transform3DComponent,
                Velocity3DComponent,
                Collider3DComponent,
                Render3DComponent,
                RoomBounds3DComponent,
                Environment3DComponent,
                BiomeStyle3DComponent,
                PropGroup3DComponent,
                Light3DComponent,
                ParticleEmitter3DComponent,
                DecorationSource3DComponent,
            ),
            edges=(HasDecoration3D,),
            systems=(Movement3DSystem,),
        ),
        content=ContentContribution(worldgen_hooks=(Worldgen3DHook,)),
        runtime=RuntimeContribution(server_routers=(install_3d_routes,)),
    )


def bunnyland_plugins() -> list[Plugin]:
    return [plugin()]


__all__ = ["PLUGIN_ID", "PLUGIN_VERSION", "bunnyland_plugins", "plugin"]
