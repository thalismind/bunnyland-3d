"""Projection helpers consumed by the standalone 3D web client."""

from __future__ import annotations

from .components import (
    Collider3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
)


def vector_view(vector: Vector3) -> dict[str, float]:
    return {"x": vector.x, "y": vector.y, "z": vector.z}


def entity_3d_view(entity) -> dict:
    view: dict = {"id": str(entity.id)}
    if entity.has_component(Transform3DComponent):
        transform = entity.get_component(Transform3DComponent)
        view["transform3d"] = {
            "position": vector_view(transform.position),
            "rotation": vector_view(transform.rotation),
            "scale": vector_view(transform.scale),
        }
    if entity.has_component(Collider3DComponent):
        collider = entity.get_component(Collider3DComponent)
        view["collider3d"] = {
            "shape": collider.shape,
            "size": vector_view(collider.size),
            "radius": collider.radius,
            "solid": collider.solid,
            "static": collider.static,
            "trigger": collider.trigger,
        }
    if entity.has_component(Render3DComponent):
        render = entity.get_component(Render3DComponent)
        view["render3d"] = {
            "shape": render.shape,
            "color": render.color,
            "emissive": render.emissive,
            "opacity": render.opacity,
            "label": render.label,
            "visible": render.visible,
        }
    if entity.has_component(RoomBounds3DComponent):
        bounds = entity.get_component(RoomBounds3DComponent)
        view["bounds3d"] = {
            "origin": vector_view(bounds.origin),
            "size": vector_view(bounds.size),
        }
    return view


def world_3d_view(world) -> dict:
    entities = world.query().with_any(
        [Transform3DComponent, Render3DComponent, RoomBounds3DComponent]
    ).execute_entities()
    return {"schema_version": 1, "entities": [entity_3d_view(entity) for entity in entities]}


__all__ = ["entity_3d_view", "vector_view", "world_3d_view"]
