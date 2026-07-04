"""Bunnyland plugin entrypoint for the out-of-tree 3D extension."""

from __future__ import annotations

from bunnyland.plugins import ContentContribution, EcsContribution, Plugin

from .components import (
    Collider3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Velocity3DComponent,
)
from .enrichment import Worldgen3DHook
from .systems import Movement3DSystem

PLUGIN_ID = "bunnyland.3d"


def plugin() -> Plugin:
    return Plugin(
        id=PLUGIN_ID,
        name="Bunnyland 3D",
        version="0.1.0",
        default_enabled=True,
        ecs=EcsContribution(
            components=(
                Transform3DComponent,
                Velocity3DComponent,
                Collider3DComponent,
                Render3DComponent,
                RoomBounds3DComponent,
            ),
            systems=(Movement3DSystem,),
        ),
        content=ContentContribution(worldgen_hooks=(Worldgen3DHook,)),
    )


def bunnyland_plugins() -> list[Plugin]:
    return [plugin()]


__all__ = ["PLUGIN_ID", "bunnyland_plugins", "plugin"]
