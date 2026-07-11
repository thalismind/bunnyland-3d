"""Declarative generation enrichment for 3D presentation components."""

from __future__ import annotations

from hashlib import blake2b

from bunnyland.core.generation import GenerationDelta, GenerationRequest

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


def _room_position(key: str) -> Vector3:
    index = _slot(key, 25)
    return Vector3((index % 5) * ROOM_SPACING, 0.0, (index // 5) * ROOM_SPACING)


def _local_position(key: str, *, spacing: float, y: float) -> Vector3:
    slot = _slot(key, 16)
    return Vector3(
        8.0 + (slot % 4 - 1.5) * spacing,
        y,
        8.0 + (slot // 4 - 1.5) * spacing,
    )


class Generation3DEnricher:
    """Attach stable 3D components to generated rooms, characters, and objects."""

    capabilities: tuple[str, ...] = ()

    def enrich(self, request: GenerationRequest) -> GenerationDelta:
        existing = tuple(request.context.get("base_components", ()))
        types = {type(component) for component in existing}
        components = []
        if request.entity_kind == "room":
            room = next(
                (item for item in existing if item.__class__.__name__ == "RoomComponent"),
                None,
            )
            biome = str(getattr(room, "biome", "unknown"))
            indoor = bool(getattr(room, "indoor", False))
            if Transform3DComponent not in types:
                components.append(Transform3DComponent(position=_room_position(request.source_key)))
            if RoomBounds3DComponent not in types:
                components.append(
                    RoomBounds3DComponent(size=Vector3(16.0, 4.0 if indoor else 8.0, 16.0))
                )
            if Render3DComponent not in types:
                known = biome if biome in BIOME_COLORS else "unknown"
                components.append(
                    Render3DComponent(
                        shape="box", color=BIOME_COLORS[known], asset_key=f"room.{known}"
                    )
                )
        elif request.entity_kind == "character":
            if Transform3DComponent not in types:
                components.append(
                    Transform3DComponent(
                        position=_local_position(request.source_key, spacing=1.3, y=0.9)
                    )
                )
            if Collider3DComponent not in types:
                components.append(
                    Collider3DComponent(shape="capsule", size=Vector3(0.7, 1.8, 0.7), radius=0.35)
                )
            if Render3DComponent not in types:
                components.append(
                    Render3DComponent(shape="capsule", color="#89b4fa", asset_key="avatar.leporid")
                )
        else:
            if Transform3DComponent not in types:
                components.append(
                    Transform3DComponent(
                        position=_local_position(request.source_key, spacing=1.0, y=0.3)
                    )
                )
            if Collider3DComponent not in types:
                components.append(
                    Collider3DComponent(shape="box", size=Vector3(0.6, 0.6, 0.6), static=True)
                )
            if Render3DComponent not in types:
                light = "light" in request.tags
                components.append(
                    Render3DComponent(
                        shape="box",
                        color="#f9e2af" if light or "treasure" in request.tags else "#a6e3a1",
                        asset_key="prop.lantern" if light else "prop.generic",
                    )
                )
        return GenerationDelta(components=tuple(components))


__all__ = ["Generation3DEnricher"]
