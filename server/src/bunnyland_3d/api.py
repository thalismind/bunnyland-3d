"""Player-safe HTTP projections for the v2 3D client."""

from __future__ import annotations

from bunnyland.core import RoomComponent
from bunnyland.core.ecs import parse_entity_id
from bunnyland.server import serialize_room_projection
from fastapi import HTTPException

from .projection import entity_3d_view

SCENE_SCHEMA_VERSION = 2
ASSET_SCHEMA_VERSION = 1


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
    room_3d = entity_3d_view(room)

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
            view.update(entity_3d_view(entity))
        entities.append(view)

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
        },
        "exits": [exit_view.model_dump(mode="json") for exit_view in projection.room.exits],
        "entities": entities,
    }


def install_3d_routes(app, actor, **_context) -> None:
    """Install addon-owned v2 capability and room-scene routes."""

    # Imported lazily to avoid a plugin/api import cycle at module import time.
    from .plugin import PLUGIN_ID, PLUGIN_VERSION

    @app.get("/3d/v2/capabilities")
    async def capabilities() -> dict:
        return {
            "ok": True,
            "plugin_id": PLUGIN_ID,
            "plugin_version": PLUGIN_VERSION,
            "scene_schema_version": SCENE_SCHEMA_VERSION,
            "asset_schema_version": ASSET_SCHEMA_VERSION,
        }

    @app.get("/3d/v2/room/{room_id}")
    async def room_scene(room_id: str) -> dict:
        return room_scene_view(actor, room_id)


__all__ = [
    "ASSET_SCHEMA_VERSION",
    "SCENE_SCHEMA_VERSION",
    "install_3d_routes",
    "room_scene_view",
]
