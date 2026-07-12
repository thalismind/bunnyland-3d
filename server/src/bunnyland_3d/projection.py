"""Projection helpers consumed by the standalone 3D web client."""

from __future__ import annotations

import random

from .components import (
    Collider3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
)
from .effects import require_environment_effect_registry
from .entity_effects import entity_effect_views


def vector_view(vector: Vector3) -> dict[str, float]:
    return {"x": vector.x, "y": vector.y, "z": vector.z}


def environment_3d_view(environment: Environment3DComponent, actor=None) -> dict:
    return {
        "sky_color": environment.sky_color,
        "fog_color": environment.fog_color,
        "fog_density": environment.fog_density,
        "ambient_color": environment.ambient_color,
        "ambient_intensity": environment.ambient_intensity,
        "sun_color": environment.sun_color,
        "sun_intensity": environment.sun_intensity,
        "has_roof": environment.has_roof,
        "skybox_preset": environment.skybox_preset,
        "skybox": (
            require_environment_effect_registry(actor).skybox_view(
                environment.skybox_preset
            )
            if actor is not None
            and hasattr(actor, "environment_effect_registry_3d")
            else None
        ),
        "surface_recipe": environment.surface_recipe,
        "albedo_url": environment.albedo_url,
        "normal_url": environment.normal_url,
        "skybox_url": environment.skybox_url,
        "texture_scale": environment.texture_scale,
    }


def _prop_instances(group: PropGroup3DComponent, bounds: RoomBounds3DComponent) -> list[dict]:
    randomizer = random.Random(group.seed)
    overrides = {item.instance_id: item for item in group.overrides}
    excluded = set(group.excluded_instance_ids)
    result = []
    width = max(0.0, bounds.size.x - group.margin * 2)
    depth = max(0.0, bounds.size.z - group.margin * 2)
    ground_cover = group.asset_key.rsplit(".", 1)[-1] in {
        "grass",
        "flower",
        "reed",
        "fern",
        "scrub",
    }
    for index in range(group.count):
        instance_id = f"i{index}"
        if ground_cover:
            x = bounds.origin.x + group.margin + randomizer.random() * width
            z = bounds.origin.z + group.margin + randomizer.random() * depth
        elif randomizer.random() < 0.5:
            x = bounds.origin.x + group.margin + randomizer.random() * width
            z = bounds.origin.z + (
                group.margin if randomizer.random() < 0.5 else bounds.size.z - group.margin
            )
        else:
            x = bounds.origin.x + (
                group.margin if randomizer.random() < 0.5 else bounds.size.x - group.margin
            )
            z = bounds.origin.z + group.margin + randomizer.random() * depth
        position = Vector3(x, bounds.origin.y, z)
        rotation_y = randomizer.random() * 6.283185307179586
        scale = group.min_scale + randomizer.random() * (group.max_scale - group.min_scale)
        if instance_id in excluded:
            continue
        override = overrides.get(instance_id)
        if override is not None:
            position = override.position or position
            rotation_y = override.rotation_y if override.rotation_y is not None else rotation_y
            scale = override.scale if override.scale is not None else scale
        result.append(
            {
                "id": instance_id,
                "position": vector_view(position),
                "rotation_y": rotation_y,
                "scale": scale,
            }
        )
    return result


def entity_3d_view(entity, actor=None) -> dict:
    view: dict = {"id": str(entity.id)}
    if actor is not None and hasattr(actor, "visual_effect_registry_3d"):
        effects = entity_effect_views(actor, entity)
        if effects:
            view["effects3d"] = effects
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
            "asset_key": render.asset_key,
            "variant_key": render.variant_key,
        }
    if actor is not None and hasattr(actor, "entity_visual_registry"):
        visual = actor.entity_visual_registry.resolve(entity)
        if visual is not None:
            view["visual3d"] = visual
    if entity.has_component(RoomBounds3DComponent):
        bounds = entity.get_component(RoomBounds3DComponent)
        view["bounds3d"] = {
            "origin": vector_view(bounds.origin),
            "size": vector_view(bounds.size),
        }
    if entity.has_component(Environment3DComponent):
        environment = entity.get_component(Environment3DComponent)
        view["environment3d"] = environment_3d_view(environment, actor)
    if entity.has_component(PropGroup3DComponent):
        group = entity.get_component(PropGroup3DComponent)
        view["prop_group3d"] = {
            "recipe_key": group.recipe_key,
            "asset_key": group.asset_key,
            "color": group.color,
            "instances": [],
        }
    if entity.has_component(Light3DComponent):
        light = entity.get_component(Light3DComponent)
        view["light3d"] = {
            "kind": light.kind,
            "color": light.color,
            "intensity": light.intensity,
            "range": light.range,
            "decay": light.decay,
            "cone": light.cone,
            "cast_shadow": light.cast_shadow,
        }
    if entity.has_component(ParticleEmitter3DComponent):
        emitter = entity.get_component(ParticleEmitter3DComponent)
        view["particle_emitter3d"] = {
            "preset": emitter.preset,
            "system": (
                require_environment_effect_registry(actor).particle_system_view(
                    emitter.preset
                )
                if actor is not None
                and hasattr(actor, "environment_effect_registry_3d")
                else None
            ),
            "seed": emitter.seed,
            "count": emitter.count,
            "bounds": vector_view(emitter.bounds),
            "color": emitter.color,
            "size": emitter.size,
            "speed": emitter.speed,
            "opacity": emitter.opacity,
        }
    if entity.has_component(DecorationSource3DComponent):
        source = entity.get_component(DecorationSource3DComponent)
        view["decoration_source3d"] = {
            "recipe_key": source.recipe_key,
            "recipe_version": source.recipe_version,
            "role": source.role,
        }
    return view


def decoration_3d_view(entity, bounds: RoomBounds3DComponent, actor=None) -> dict:
    view = entity_3d_view(entity, actor)
    if entity.has_component(PropGroup3DComponent):
        view["prop_group3d"]["instances"] = _prop_instances(
            entity.get_component(PropGroup3DComponent), bounds
        )
    return view


def world_3d_view(world) -> dict:
    entities = (
        world.query()
        .with_any(
            [
                Transform3DComponent,
                Render3DComponent,
                RoomBounds3DComponent,
                Environment3DComponent,
                PropGroup3DComponent,
                Light3DComponent,
                ParticleEmitter3DComponent,
            ]
        )
        .execute_entities()
    )
    return {"schema_version": 1, "entities": [entity_3d_view(entity) for entity in entities]}


__all__ = [
    "decoration_3d_view",
    "entity_3d_view",
    "environment_3d_view",
    "vector_view",
    "world_3d_view",
]
