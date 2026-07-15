"""Bunnyland plugin entrypoint for the out-of-tree 3D extension."""

from __future__ import annotations

from bunnyland.plugins import (
    ContentContribution,
    DependencyContribution,
    EcsContribution,
    HttpContribution,
    HttpZone,
    Plugin,
    RuntimeContribution,
)

from .api import install_3d_admin_routes, install_3d_play_routes
from .assets import install_model_registry
from .components import (
    BiomeStyle3DComponent,
    Collider3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    HasDecoration3D,
    HasVisualEffect3D,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Velocity3DComponent,
    VisualEffectInstance3DComponent,
)
from .core_visuals import install_core_entity_visuals
from .effects import install_environment_effect_registry
from .enrichment import Generation3DEnricher
from .entity_effects import install_visual_effect_registry
from .systems import Movement3DSystem
from .visuals import install_entity_visual_registry

PLUGIN_ID = "bunnyland.3d"
PLUGIN_VERSION = "0.3.0"


def plugin() -> Plugin:
    return Plugin(
        id=PLUGIN_ID,
        name="Bunnyland 3D",
        version=PLUGIN_VERSION,
        default_enabled=True,
        dependencies=DependencyContribution(requires=("bunnyland.media",)),
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
                VisualEffectInstance3DComponent,
            ),
            edges=(HasDecoration3D, HasVisualEffect3D),
            systems=(Movement3DSystem,),
        ),
        content=ContentContribution(generation_enrichers=(Generation3DEnricher(),)),
        runtime=RuntimeContribution(
            service_factories=(
                install_model_registry,
                install_environment_effect_registry,
                install_visual_effect_registry,
                install_entity_visual_registry,
                install_core_entity_visuals,
            ),
            http=(
                HttpContribution(zone=HttpZone.PLAY, registrars=(install_3d_play_routes,)),
                HttpContribution(zone=HttpZone.ADMIN, registrars=(install_3d_admin_routes,)),
            ),
        ),
    )


def bunnyland_plugins() -> list[Plugin]:
    return [plugin()]


__all__ = ["PLUGIN_ID", "PLUGIN_VERSION", "bunnyland_plugins", "plugin"]
