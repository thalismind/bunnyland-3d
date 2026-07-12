"""Small shared visual rules derived from core gameplay state."""

from bunnyland.core import ContainerComponent, DoorComponent, HealthComponent, LockableComponent
from bunnyland.foundation.environment.mechanics import FireComponent

from .assets import (
    ModelAsset,
    ModelTransform,
    PrimitivePart3D,
    ProceduralModelSource,
    VisualMaterial3D,
    register_models,
)
from .visuals import (
    EntityVisualContribution,
    EntityVisualRule,
    VisualAttachment,
    VisualNodePatch,
    VisualParticleEffect,
    register_entity_visuals,
)

OWNER = "bunnyland.3d"


def _component(entity, component_type):
    return entity.get_component(component_type) if entity.has_component(component_type) else None


def install_core_entity_visuals(actor) -> None:
    register_models(
        actor,
        OWNER,
        (
            ModelAsset(
                key=f"{OWNER}/lock",
                source=ProceduralModelSource(
                    parts=(
                        PrimitivePart3D(
                            "body",
                            "box",
                            size=(0.24, 0.24, 0.1),
                            transform=ModelTransform(translation=(0, 0.05, 0)),
                            material=VisualMaterial3D(color="#d7b85c", metallic=0.7),
                        ),
                        PrimitivePart3D(
                            "shackle",
                            "torus",
                            radius=0.12,
                            tube_radius=0.025,
                            transform=ModelTransform(
                                rotation=(1.5708, 0, 0), translation=(0, 0.17, 0)
                            ),
                            material=VisualMaterial3D(color="#d7b85c", metallic=0.7),
                        ),
                    )
                ),
            ),
            ModelAsset(
                key=f"{OWNER}/fire",
                source=ProceduralModelSource(
                    parts=(
                        PrimitivePart3D(
                            "flame",
                            "cone",
                            radius=0.16,
                            height=0.45,
                            transform=ModelTransform(translation=(0, 0.22, 0)),
                            material=VisualMaterial3D(color="#ff8a32", emissive="#ff4a00"),
                        ),
                    )
                ),
            ),
            ModelAsset(
                key=f"{OWNER}/showcase-prop",
                source=ProceduralModelSource(
                    parts=(
                        PrimitivePart3D(
                            "body",
                            "box",
                            size=(1.0, 0.8, 0.7),
                            transform=ModelTransform(translation=(0, 0.55, 0)),
                            material=VisualMaterial3D(color="#704626", metallic=0.05),
                            roles=("damageable",),
                        ),
                        PrimitivePart3D(
                            "lid",
                            "box",
                            size=(0.96, 0.12, 0.68),
                            transform=ModelTransform(translation=(0, 1.0, -0.28)),
                            material=VisualMaterial3D(color="#8b5a32", metallic=0.05),
                            roles=("openable",),
                        ),
                        PrimitivePart3D(
                            "indicator",
                            "sphere",
                            radius=0.09,
                            transform=ModelTransform(translation=(0.3, 0.72, 0.36)),
                            material=VisualMaterial3D(color="#88d8c0", emissive="#163d34"),
                            roles=("state-indicator",),
                        ),
                        PrimitivePart3D(
                            "handle",
                            "capsule",
                            radius=0.035,
                            height=0.28,
                            transform=ModelTransform(
                                rotation=(0, 0, 1.5708), translation=(0, 0.76, 0.39)
                            ),
                            material=VisualMaterial3D(
                                color="#d7b85c", metallic=0.75, roughness=0.28
                            ),
                        ),
                        PrimitivePart3D(
                            "lock_anchor",
                            "sphere",
                            radius=0.02,
                            transform=ModelTransform(translation=(0, 0.55, 0.36)),
                            material=VisualMaterial3D(opacity=0.0),
                            roles=("lock-anchor",),
                        ),
                    ),
                    required_roles=(
                        "damageable",
                        "openable",
                        "lock-anchor",
                        "state-indicator",
                    ),
                ),
            ),
        ),
    )
    register_entity_visuals(
        actor,
        OWNER,
        (
            EntityVisualRule(
                key=f"{OWNER}/health-critical",
                priority=30,
                predicate=lambda entity: (
                    (health := _component(entity, HealthComponent)) is not None
                    and health.maximum > 0
                    and health.current / health.maximum <= 0.25
                ),
                contribution=EntityVisualContribution(
                    patches=(
                        VisualNodePatch("damageable", semantic_role=True, color_multiply="#b84040"),
                    )
                ),
            ),
            EntityVisualRule(
                key=f"{OWNER}/health-wounded",
                priority=20,
                predicate=lambda entity: (
                    (health := _component(entity, HealthComponent)) is not None
                    and health.maximum > 0
                    and 0.25 < health.current / health.maximum < 0.75
                ),
                contribution=EntityVisualContribution(
                    patches=(
                        VisualNodePatch("damageable", semantic_role=True, color_multiply="#d89a70"),
                    )
                ),
            ),
            EntityVisualRule(
                key=f"{OWNER}/open",
                priority=20,
                predicate=lambda entity: (
                    ((door := _component(entity, DoorComponent)) is not None and door.open)
                    or (
                        (container := _component(entity, ContainerComponent)) is not None
                        and container.open
                    )
                ),
                contribution=EntityVisualContribution(
                    patches=(
                        VisualNodePatch(
                            "openable",
                            semantic_role=True,
                            transform=ModelTransform(rotation=(-1.2, 0, 0)),
                        ),
                    )
                ),
            ),
            EntityVisualRule(
                key=f"{OWNER}/locked",
                priority=20,
                predicate=lambda entity: (
                    ((lock := _component(entity, LockableComponent)) is not None and lock.locked)
                    or (
                        (container := _component(entity, ContainerComponent)) is not None
                        and container.locked
                    )
                ),
                contribution=EntityVisualContribution(
                    attachments=(
                        VisualAttachment(
                            key=f"{OWNER}/lock-state",
                            model_key=f"{OWNER}/lock",
                            anchor="lock-anchor",
                            semantic_role=True,
                            transform=ModelTransform(translation=(0, -0.04, 0.14)),
                        ),
                    )
                ),
            ),
            EntityVisualRule(
                key=f"{OWNER}/fire-state",
                priority=40,
                predicate=lambda entity: entity.has_component(FireComponent),
                contribution=EntityVisualContribution(
                    patches=(
                        VisualNodePatch("state-indicator", semantic_role=True, emissive="#ff5a16"),
                    ),
                    particle_effects=(
                        VisualParticleEffect(
                            key=f"{OWNER}/fire-state",
                            anchor="state-indicator",
                            semantic_role=True,
                            seed=3187,
                            count=28,
                            bounds=(0.34, 0.62, 0.34),
                            color="#ff7a24",
                            size=0.09,
                            speed=0.78,
                            opacity=0.92,
                            transform=ModelTransform(translation=(0, 0.05, 0)),
                        ),
                    ),
                ),
            ),
        ),
    )


__all__ = ["install_core_entity_visuals"]
