"""Deterministic outdoor decoration recipes and ECS application helpers."""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from hashlib import blake2b

from bunnyland.core import RoomComponent
from bunnyland.core.ecs import replace_component, spawn_entity

from .components import (
    BiomeStyle3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    HasDecoration3D,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    Transform3DComponent,
    Vector3,
)

RECIPE_VERSION = 1


@dataclass(frozen=True)
class OutdoorRecipe:
    key: str
    sky: str
    fog: str
    ground: str
    ambient: str
    sun: str
    flora_asset: str
    flora_color: str
    detail_asset: str
    detail_color: str
    particle_preset: str
    particle_color: str
    light_color: str
    flora_count: int = 52
    detail_count: int = 14


RECIPES = {
    "meadow": OutdoorRecipe(
        "meadow",
        "#96c9ee",
        "#78a982",
        "#6f9c52",
        "#dff4ff",
        "#fff0c2",
        "procedural.grass",
        "#82b85f",
        "procedural.flower",
        "#f0d36d",
        "pollen",
        "#fff0a8",
        "#ffd88f",
        72,
        20,
    ),
    "forest": OutdoorRecipe(
        "forest",
        "#739bb0",
        "#42664d",
        "#3f6744",
        "#c5e5d2",
        "#ffddaa",
        "procedural.tree",
        "#48794c",
        "procedural.fern",
        "#71a85c",
        "spores",
        "#c8eda4",
        "#ffc46f",
        34,
        42,
    ),
    "garden": OutdoorRecipe(
        "garden",
        "#a9d6ef",
        "#779878",
        "#638c50",
        "#e6f6ff",
        "#fff0d5",
        "procedural.hedge",
        "#5d9954",
        "procedural.flower",
        "#f0a9c3",
        "pollen",
        "#ffe6a3",
        "#ffd19b",
        28,
        48,
    ),
    "marsh": OutdoorRecipe(
        "marsh",
        "#7fa4a1",
        "#3c6862",
        "#385e55",
        "#c5ded8",
        "#d7e2c0",
        "procedural.reed",
        "#6e8d55",
        "procedural.rock",
        "#60796d",
        "fireflies",
        "#d9ff86",
        "#bfff73",
        62,
        16,
    ),
    "desert": OutdoorRecipe(
        "desert",
        "#d8b982",
        "#b48b61",
        "#b78d55",
        "#ffe5b7",
        "#fff0c4",
        "procedural.cactus",
        "#62875b",
        "procedural.rock",
        "#9c7652",
        "dust",
        "#f4d4a0",
        "#ffbe76",
        16,
        34,
    ),
    "wasteland": OutdoorRecipe(
        "wasteland",
        "#a49379",
        "#726b59",
        "#756a4c",
        "#d9cdb5",
        "#e7c998",
        "procedural.scrub",
        "#777650",
        "procedural.scrap",
        "#786c62",
        "dust",
        "#d7bd91",
        "#e6a45e",
        24,
        28,
    ),
}

FALLBACK_RECIPE = OutdoorRecipe(
    "outdoor",
    "#91b8cf",
    "#667d70",
    "#607b54",
    "#d8ecf5",
    "#f8e4bd",
    "procedural.grass",
    "#73945a",
    "procedural.rock",
    "#77786d",
    "pollen",
    "#e8e0ad",
    "#efc47c",
    36,
    12,
)


def stable_seed(value: str) -> int:
    return (
        int.from_bytes(blake2b(value.encode("utf-8"), digest_size=4).digest(), "big") & 0x7FFFFFFF
    )


def recipe_for(biome: str) -> OutdoorRecipe:
    return RECIPES.get(biome.lower(), replace(FALLBACK_RECIPE, key=biome.lower() or "outdoor"))


def biome_style(world, biome: str) -> BiomeStyle3DComponent | None:
    for entity in world.query().with_all([BiomeStyle3DComponent]).execute_entities():
        style = entity.get_component(BiomeStyle3DComponent)
        if style.biome == biome:
            return style
    return None


def environment_for(world, room, recipe: OutdoorRecipe) -> Environment3DComponent:
    existing = (
        room.get_component(Environment3DComponent)
        if room.has_component(Environment3DComponent)
        else None
    )
    style = biome_style(world, recipe.key)
    return Environment3DComponent(
        sky_color=recipe.sky,
        fog_color=recipe.fog,
        ambient_color=recipe.ambient,
        sun_color=recipe.sun,
        surface_recipe=recipe.key,
        has_roof=existing.has_roof if existing else False,
        albedo_url=(
            existing.albedo_url
            if existing and existing.albedo_url
            else style.albedo_url
            if style
            else ""
        ),
        normal_url=(
            existing.normal_url
            if existing and existing.normal_url
            else style.normal_url
            if style
            else ""
        ),
        skybox_url=(
            existing.skybox_url
            if existing and existing.skybox_url
            else style.skybox_url
            if style
            else ""
        ),
        texture_scale=existing.texture_scale if existing else 4.0,
    )


def _owned_by_role(world, room, role: str):
    for edge, entity_id in room.get_relationships(HasDecoration3D):
        if edge.role != role or not world.has_entity(entity_id):
            continue
        entity = world.get_entity(entity_id)
        if entity.has_component(DecorationSource3DComponent):
            return entity
    return None


def _source(room, recipe: OutdoorRecipe, role: str) -> DecorationSource3DComponent:
    return DecorationSource3DComponent(
        room_id=str(room.id), recipe_key=recipe.key, recipe_version=RECIPE_VERSION, role=role
    )


def _upsert_group(
    world, room, recipe: OutdoorRecipe, role: str, seed: int, *, reroll: bool
) -> None:
    entity = _owned_by_role(world, room, role)
    old = (
        entity.get_component(PropGroup3DComponent)
        if entity and entity.has_component(PropGroup3DComponent)
        else None
    )
    if entity is None:
        entity = spawn_entity(world)
        room.add_relationship(HasDecoration3D(role=role), entity.id)
    asset = recipe.flora_asset if role == "flora" else recipe.detail_asset
    tint = recipe.flora_color if role == "flora" else recipe.detail_color
    count = recipe.flora_count if role == "flora" else recipe.detail_count
    replace_component(entity, _source(room, recipe, role))
    replace_component(
        entity,
        PropGroup3DComponent(
            recipe_key=recipe.key,
            seed=seed if reroll or old is None else old.seed,
            asset_key=asset,
            count=count,
            color=tint,
            min_scale=0.45 if role == "flora" else 0.55,
            max_scale=1.25 if role == "flora" else 1.15,
            excluded_instance_ids=old.excluded_instance_ids if old else (),
            overrides=old.overrides if old else (),
        ),
    )


def apply_outdoor_recipe(world, room, *, reroll: bool = False) -> dict:
    component = room.get_component(RoomComponent)
    if component.indoor:
        return {"room_id": str(room.id), "status": "skipped", "reason": "indoor room"}
    recipe = recipe_for(component.biome)
    base_seed = (
        random.SystemRandom().randrange(2**31) if reroll else stable_seed(f"{room.id}:{recipe.key}")
    )
    replace_component(room, environment_for(world, room, recipe))
    _upsert_group(world, room, recipe, "flora", base_seed, reroll=reroll)
    _upsert_group(world, room, recipe, "detail", base_seed ^ 0x35A2C19, reroll=reroll)

    light = _owned_by_role(world, room, "light")
    if light is None:
        light = spawn_entity(world)
        room.add_relationship(HasDecoration3D(role="light"), light.id)
    replace_component(light, _source(room, recipe, "light"))
    replace_component(light, Transform3DComponent(position=Vector3(8.0, 2.4, 8.0)))
    replace_component(light, Light3DComponent(color=recipe.light_color, intensity=1.25, range=9.0))

    emitter = _owned_by_role(world, room, "particles")
    old_emitter = (
        emitter.get_component(ParticleEmitter3DComponent)
        if emitter and emitter.has_component(ParticleEmitter3DComponent)
        else None
    )
    if emitter is None:
        emitter = spawn_entity(world)
        room.add_relationship(HasDecoration3D(role="particles"), emitter.id)
    replace_component(emitter, _source(room, recipe, "particles"))
    replace_component(emitter, Transform3DComponent(position=Vector3(8.0, 0.2, 8.0)))
    replace_component(
        emitter,
        ParticleEmitter3DComponent(
            preset=recipe.particle_preset,
            seed=base_seed ^ 0x71D83A5 if reroll or old_emitter is None else old_emitter.seed,
            count=90 if recipe.particle_preset != "fireflies" else 55,
            color=recipe.particle_color,
            size=0.1 if recipe.particle_preset == "fireflies" else 0.065,
            speed=0.12 if recipe.particle_preset == "mist" else 0.24,
        ),
    )
    return {
        "room_id": str(room.id),
        "status": "applied",
        "recipe": recipe.key,
        "instances": recipe.flora_count + recipe.detail_count,
        "lights": 1,
        "particles": 90 if recipe.particle_preset != "fireflies" else 55,
    }


def preview_outdoor_recipe(room) -> dict:
    component = room.get_component(RoomComponent)
    if component.indoor:
        return {"room_id": str(room.id), "status": "skipped", "reason": "indoor room"}
    recipe = recipe_for(component.biome)
    return {
        "room_id": str(room.id),
        "status": "preview",
        "recipe": recipe.key,
        "instances": recipe.flora_count + recipe.detail_count,
        "lights": 1,
        "particles": 90 if recipe.particle_preset != "fireflies" else 55,
        "surface": recipe.ground,
    }


def set_biome_texture(world, biome: str, slot: str, url: str) -> None:
    entity = None
    for candidate in world.query().with_all([BiomeStyle3DComponent]).execute_entities():
        if candidate.get_component(BiomeStyle3DComponent).biome == biome:
            entity = candidate
            break
    if entity is None:
        entity = spawn_entity(world)
        style = BiomeStyle3DComponent(biome=biome)
    else:
        style = entity.get_component(BiomeStyle3DComponent)
    replace_component(entity, replace(style, **{f"{slot}_url": url}))


def set_room_texture(room, slot: str, url: str) -> None:
    if not room.has_component(Environment3DComponent):
        raise ValueError("decorate the room before assigning a room texture")
    environment = room.get_component(Environment3DComponent)
    replace_component(room, replace(environment, **{f"{slot}_url": url}))


def set_room_roof(room, has_roof: bool) -> None:
    if room.has_component(Environment3DComponent):
        environment = room.get_component(Environment3DComponent)
    else:
        component = room.get_component(RoomComponent)
        environment = Environment3DComponent(
            surface_recipe=component.biome.lower() or "outdoor",
            has_roof=component.indoor,
        )
    replace_component(room, replace(environment, has_roof=has_roof))


__all__ = [
    "RECIPES",
    "apply_outdoor_recipe",
    "preview_outdoor_recipe",
    "recipe_for",
    "set_biome_texture",
    "set_room_texture",
    "set_room_roof",
    "stable_seed",
]
