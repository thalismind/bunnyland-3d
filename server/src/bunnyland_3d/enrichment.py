"""World-generation enrichment hook for generated 3D presentation components."""

from __future__ import annotations

from hashlib import blake2b

from bunnyland.core.ecs import parse_entity_id, replace_component
from bunnyland.core.events import CharacterGeneratedEvent, ObjectGeneratedEvent, RoomGeneratedEvent
from bunnyland.core.world_actor import WorldActor

from .components import (
    Collider3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
)

ROOM_SPACING = 18.0

BIOME_COLORS = {
    "cave": "#746354",
    "city": "#4f6f9f",
    "desert": "#c9a66b",
    "forest": "#5f9f6a",
    "garden": "#6fa85c",
    "marsh": "#4b8979",
    "meadow": "#7ca85c",
    "ship": "#5b6f8f",
    "station": "#4f6f9f",
    "unknown": "#6d7788",
    "wasteland": "#8b7d57",
}


def _slot(key: str, modulo: int) -> int:
    digest = blake2b(key.encode("utf-8"), digest_size=2).digest()
    return int.from_bytes(digest, "big") % modulo


def _room_position(index: int) -> Vector3:
    column = index % 5
    row = index // 5
    return Vector3(column * ROOM_SPACING, 0.0, row * ROOM_SPACING)


def _local_position(key: str, *, spacing: float, y: float) -> Vector3:
    slot = _slot(key, 16)
    column = slot % 4
    row = slot // 4
    # RoomBounds3DComponent treats origin as the minimum corner. Generated room bounds
    # are 16x16, so keep deterministic spawn slots around their center instead of around
    # world origin (which put half of the old slots outside the room).
    return Vector3(8.0 + (column - 1.5) * spacing, y, 8.0 + (row - 1.5) * spacing)


class Worldgen3DHook:
    """Attach deterministic 3D components to generated rooms, characters, and objects."""

    def __init__(self) -> None:
        self._room_index = 0

    def subscribe(self, actor: WorldActor) -> None:
        actor.bus.subscribe(RoomGeneratedEvent, self._on_room)
        actor.bus.subscribe(CharacterGeneratedEvent, self._on_character)
        actor.bus.subscribe(ObjectGeneratedEvent, self._on_object)
        self.actor = actor

    def _entity(self, entity_id: str):
        parsed = parse_entity_id(entity_id)
        if parsed is None or not self.actor.world.has_entity(parsed):
            return None
        return self.actor.world.get_entity(parsed)

    def _on_room(self, event: RoomGeneratedEvent) -> None:
        entity = self._entity(event.entity_id)
        if entity is None:
            return
        if not entity.has_component(Transform3DComponent):
            replace_component(
                entity, Transform3DComponent(position=_room_position(self._room_index))
            )
        if not entity.has_component(RoomBounds3DComponent):
            height = 4.0 if event.indoor else 8.0
            replace_component(entity, RoomBounds3DComponent(size=Vector3(16.0, height, 16.0)))
        if not entity.has_component(Render3DComponent):
            color = BIOME_COLORS.get(event.biome, BIOME_COLORS["unknown"])
            replace_component(
                entity,
                Render3DComponent(
                    shape="box",
                    color=color,
                    asset_key=(
                        f"room.{event.biome}"
                        if event.biome in BIOME_COLORS
                        else "room.unknown"
                    ),
                ),
            )
        self._room_index += 1

    def _on_character(self, event: CharacterGeneratedEvent) -> None:
        entity = self._entity(event.entity_id)
        if entity is None:
            return
        if not entity.has_component(Transform3DComponent):
            replace_component(
                entity,
                Transform3DComponent(
                    position=_local_position(event.entity_key, spacing=1.3, y=0.9)
                ),
            )
        if not entity.has_component(Collider3DComponent):
            replace_component(
                entity,
                Collider3DComponent(shape="capsule", size=Vector3(0.7, 1.8, 0.7), radius=0.35),
            )
        if not entity.has_component(Render3DComponent):
            replace_component(
                entity,
                Render3DComponent(
                    shape="capsule",
                    color="#89b4fa",
                    asset_key="avatar.leporid",
                ),
            )

    def _on_object(self, event: ObjectGeneratedEvent) -> None:
        entity = self._entity(event.entity_id)
        if entity is None:
            return
        if not entity.has_component(Transform3DComponent):
            replace_component(
                entity,
                Transform3DComponent(
                    position=_local_position(event.entity_key, spacing=1.0, y=0.3)
                ),
            )
        if not entity.has_component(Collider3DComponent):
            replace_component(
                entity,
                Collider3DComponent(shape="box", size=Vector3(0.6, 0.6, 0.6), static=True),
            )
        if not entity.has_component(Render3DComponent):
            color = "#f9e2af" if "light" in event.tags or "treasure" in event.tags else "#a6e3a1"
            asset_key = "prop.lantern" if "light" in event.tags else "prop.generic"
            replace_component(
                entity,
                Render3DComponent(shape="box", color=color, asset_key=asset_key),
            )


__all__ = ["Worldgen3DHook"]
