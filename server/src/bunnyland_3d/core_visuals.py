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
                    attachments=(
                        VisualAttachment(
                            key=f"{OWNER}/fire-state",
                            model_key=f"{OWNER}/fire",
                            anchor="state-indicator",
                            semantic_role=True,
                        ),
                    ),
                ),
            ),
        ),
    )


__all__ = ["install_core_entity_visuals"]
