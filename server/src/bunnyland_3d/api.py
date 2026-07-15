"""Player-safe HTTP projections for the v2 3D client."""

from __future__ import annotations

import re

from bunnyland.core import RoomComponent
from bunnyland.core.ecs import parse_entity_id
from bunnyland.server import serialize_room_projection
from fastapi import HTTPException, Request
from pydantic import BaseModel

from .assets import require_model_registry
from .components import Environment3DComponent, HasDecoration3D, RoomBounds3DComponent
from .decorations import (
    apply_outdoor_recipe,
    biome_style,
    preview_outdoor_recipe,
    set_biome_texture,
    set_room_roof,
    set_room_texture,
)
from .effects import require_environment_effect_registry
from .projection import decoration_3d_view, entity_3d_view, environment_3d_view

SCENE_SCHEMA_VERSION = 4
ASSET_SCHEMA_VERSION = 2
UPLOAD_IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_TEXTURE_BYTES = 10 * 1024 * 1024
TEXTURE_SEGMENT = "textures3d"


class RoofRequest(BaseModel):
    has_roof: bool


def _entity(actor, entity_id: str):
    parsed = parse_entity_id(entity_id)
    if parsed is None or not actor.world.has_entity(parsed):
        return None
    return actor.world.get_entity(parsed)


def room_scene_view(actor, room_id: str) -> dict:
    """Augment the existing public room projection with optional 3D presentation data."""

    try:
        projection = serialize_room_projection(actor, room_id)
    except ValueError as exc:
        detail = str(exc)
        status = 400 if detail == "entity is not a room" else 404
        raise HTTPException(status_code=status, detail=detail) from exc

    room = _entity(actor, room_id)
    if room is None or not room.has_component(RoomComponent):
        raise HTTPException(status_code=404, detail="room does not exist")
    component = room.get_component(RoomComponent)
    room_3d = entity_3d_view(room, actor)
    bounds = (
        room.get_component(RoomBounds3DComponent)
        if room.has_component(RoomBounds3DComponent)
        else RoomBounds3DComponent()
    )
    effects = (
        require_environment_effect_registry(actor)
        if hasattr(actor, "environment_effect_registry_3d")
        else None
    )
    room_particle = (
        effects.room_particle_view(actor.world, room, bounds)
        if effects is not None
        else None
    )

    entities = []
    # serialize_room_projection is the visibility boundary. Resolve 3D data only for ids
    # that it admitted rather than querying raw room contents independently.
    for public in projection.room.entities:
        entity = _entity(actor, public.id)
        view = {
            "id": public.id,
            "name": public.name,
            "kind": public.kind,
            "is_character": public.is_character,
        }
        if entity is not None:
            view.update(entity_3d_view(entity, actor))
        entities.append(view)

    decorations = []
    for edge, decoration_id in room.get_relationships(HasDecoration3D):
        if room_particle is not None and edge.role == "bunnyland.3d/particles":
            continue
        if actor.world.has_entity(decoration_id):
            decorations.append(
                decoration_3d_view(actor.world.get_entity(decoration_id), bounds, actor)
            )

    environment = room_3d.get("environment3d")
    configured_skybox = (
        environment["skybox_preset"] if environment else "bunnyland.3d/default"
    )
    selected_skybox = (
        effects.room_skybox_view(actor.world, room, configured_skybox)
        if effects is not None
        else None
    )
    if selected_skybox is not None:
        if environment is None:
            environment = environment_3d_view(
                Environment3DComponent(has_roof=component.indoor), actor
            )
        else:
            environment = dict(environment)
        environment["skybox_preset"] = selected_skybox["key"]
        environment["skybox"] = selected_skybox
    style = biome_style(actor.world, component.biome)
    if environment is not None and style is not None:
        environment = dict(environment)
        environment["albedo_url"] = environment["albedo_url"] or style.albedo_url
        environment["normal_url"] = environment["normal_url"] or style.normal_url
        environment["skybox_url"] = environment["skybox_url"] or style.skybox_url
    if room_particle is not None:
        decorations.append(room_particle)

    return {
        "ok": True,
        "schema_version": SCENE_SCHEMA_VERSION,
        "world_epoch": projection.world_epoch,
        "room": {
            "id": projection.room.id,
            "title": projection.room.title,
            "biome": component.biome,
            "indoor": component.indoor,
            "bounds3d": room_3d.get("bounds3d"),
            "render3d": room_3d.get("render3d"),
            "environment3d": environment,
        },
        "exits": [exit_view.model_dump(mode="json") for exit_view in projection.room.exits],
        "entities": entities,
        "decorations": decorations,
    }


def install_3d_play_routes(router, actor, **_context) -> None:
    """Install addon-owned v2 capability and room-scene routes."""

    # Imported lazily to avoid a plugin/api import cycle at module import time.
    from .plugin import PLUGIN_ID, PLUGIN_VERSION

    @router.get("/3d/v2/capabilities")
    async def capabilities() -> dict:
        return {
            "ok": True,
            "plugin_id": PLUGIN_ID,
            "plugin_version": PLUGIN_VERSION,
            "scene_schema_version": SCENE_SCHEMA_VERSION,
            "asset_schema_version": ASSET_SCHEMA_VERSION,
        }

    @router.get("/3d/v2/assets/manifest")
    async def asset_manifest() -> dict:
        return require_model_registry(actor).manifest()

    @router.get("/3d/v2/room/{room_id}")
    async def room_scene(room_id: str) -> dict:
        return room_scene_view(actor, room_id)


def install_3d_admin_routes(router, actor, media_store=None, **_context) -> None:
    """Install administrator-only 3D editing routes."""

    def require_room(room_id: str):
        room = _entity(actor, room_id)
        if room is None:
            raise HTTPException(status_code=404, detail="room does not exist")
        if not room.has_component(RoomComponent):
            raise HTTPException(status_code=400, detail="entity is not a room")
        return room

    @router.get("/3d/room/{room_id}/decoration/preview")
    async def preview_decoration(room_id: str) -> dict:
        async with actor._lock:
            return {"ok": True, **preview_outdoor_recipe(require_room(room_id))}

    @router.post("/3d/room/{room_id}/decoration/apply")
    async def apply_decoration(room_id: str) -> dict:
        async with actor._lock:
            return {"ok": True, **apply_outdoor_recipe(actor.world, require_room(room_id))}

    @router.post("/3d/room/{room_id}/decoration/reroll")
    async def reroll_decoration(room_id: str) -> dict:
        async with actor._lock:
            return {
                "ok": True,
                **apply_outdoor_recipe(actor.world, require_room(room_id), reroll=True),
            }

    @router.post("/3d/decoration/apply-outdoors")
    async def apply_all_outdoors() -> dict:
        results = []
        async with actor._lock:
            rooms = list(actor.world.query().with_all([RoomComponent]).execute_entities())
            for room in rooms:
                results.append(apply_outdoor_recipe(actor.world, room))
        return {
            "ok": True,
            "results": results,
            "applied": sum(item["status"] == "applied" for item in results),
            "skipped": sum(item["status"] == "skipped" for item in results),
        }

    @router.post("/3d/texture/{scope}/{target}/{slot}")
    async def upload_texture(scope: str, target: str, slot: str, request: Request) -> dict:
        if media_store is None:
            raise HTTPException(status_code=409, detail="media storage is unavailable")
        if scope not in {"biome", "room"} or slot not in {"albedo", "normal", "skybox"}:
            raise HTTPException(status_code=400, detail="invalid texture scope or slot")
        async with actor._lock:
            if scope == "biome":
                if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", target.lower()):
                    raise HTTPException(status_code=400, detail="invalid biome texture target")
            else:
                room = require_room(target)
                if not room.has_component(Environment3DComponent):
                    raise HTTPException(
                        status_code=409, detail="decorate the room before assigning a room texture"
                    )
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        extension = UPLOAD_IMAGE_TYPES.get(content_type)
        if extension is None:
            raise HTTPException(status_code=400, detail="upload must be a PNG, JPEG, or WebP image")
        data = await request.body()
        if not data:
            raise HTTPException(status_code=400, detail="upload body is empty")
        if len(data) > MAX_TEXTURE_BYTES:
            raise HTTPException(status_code=413, detail="upload texture is too large")
        name = media_store.new_name(extension)
        media_store.write(TEXTURE_SEGMENT, name, data)
        url = media_store.url_for(TEXTURE_SEGMENT, name)
        async with actor._lock:
            if scope == "biome":
                set_biome_texture(actor.world, target.lower(), slot, url)
            else:
                try:
                    set_room_texture(require_room(target), slot, url)
                except ValueError as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"ok": True, "scope": scope, "target": target, "slot": slot, "url": url}

    @router.delete("/3d/texture/{scope}/{target}/{slot}")
    async def clear_texture(scope: str, target: str, slot: str) -> dict:
        if scope not in {"biome", "room"} or slot not in {"albedo", "normal", "skybox"}:
            raise HTTPException(status_code=400, detail="invalid texture scope or slot")
        async with actor._lock:
            if scope == "biome":
                set_biome_texture(actor.world, target.lower(), slot, "")
            else:
                try:
                    set_room_texture(require_room(target), slot, "")
                except ValueError as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"ok": True, "scope": scope, "target": target, "slot": slot, "url": ""}

    @router.put("/3d/room/{room_id}/roof")
    async def set_roof(room_id: str, body: RoofRequest) -> dict:
        async with actor._lock:
            room = require_room(room_id)
            set_room_roof(room, body.has_roof)
        return {"ok": True, "room_id": room_id, "has_roof": body.has_roof}


__all__ = [
    "ASSET_SCHEMA_VERSION",
    "SCENE_SCHEMA_VERSION",
    "install_3d_admin_routes",
    "install_3d_play_routes",
    "room_scene_view",
]
