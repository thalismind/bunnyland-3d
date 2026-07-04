"""Pure 3D collision and movement helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .components import Collider3DComponent, RoomBounds3DComponent, Transform3DComponent, Vector3

_UNIT_SCALE = Vector3(1, 1, 1)


@dataclass(frozen=True)
class Aabb:
    min: Vector3
    max: Vector3

    def intersects(self, other: Aabb) -> bool:
        return (
            self.min.x < other.max.x
            and self.max.x > other.min.x
            and self.min.y < other.max.y
            and self.max.y > other.min.y
            and self.min.z < other.max.z
            and self.max.z > other.min.z
        )


@dataclass(frozen=True)
class CollisionBody:
    id: str
    transform: Transform3DComponent
    collider: Collider3DComponent


@dataclass(frozen=True)
class MotionResult:
    position: Vector3
    blocked_axes: frozenset[str] = frozenset()
    collisions: tuple[str, ...] = ()

    @property
    def blocked(self) -> bool:
        return bool(self.blocked_axes)


def collider_half_extents(
    collider: Collider3DComponent,
    scale: Vector3 = _UNIT_SCALE,
) -> Vector3:
    if collider.shape == "sphere":
        radius = max(0.0, collider.radius)
        return Vector3(radius * scale.x, radius * scale.y, radius * scale.z)
    if collider.shape == "capsule":
        radius = max(0.0, collider.radius)
        height = max(collider.size.y, radius * 2)
        return Vector3(radius * scale.x, (height / 2) * scale.y, radius * scale.z)
    return Vector3(
        max(0.0, collider.size.x * scale.x) / 2,
        max(0.0, collider.size.y * scale.y) / 2,
        max(0.0, collider.size.z * scale.z) / 2,
    )


def aabb_for(
    position: Vector3,
    collider: Collider3DComponent,
    scale: Vector3 = _UNIT_SCALE,
) -> Aabb:
    half = collider_half_extents(collider, scale)
    return Aabb(
        Vector3(position.x - half.x, position.y - half.y, position.z - half.z),
        Vector3(position.x + half.x, position.y + half.y, position.z + half.z),
    )


def clamp_to_room(
    position: Vector3,
    collider: Collider3DComponent,
    bounds: RoomBounds3DComponent,
) -> Vector3:
    half = collider_half_extents(collider)
    return Vector3(
        min(max(position.x, bounds.origin.x + half.x), bounds.origin.x + bounds.size.x - half.x),
        min(max(position.y, bounds.origin.y + half.y), bounds.origin.y + bounds.size.y - half.y),
        min(max(position.z, bounds.origin.z + half.z), bounds.origin.z + bounds.size.z - half.z),
    )


def colliding_ids(
    body_id: str,
    position: Vector3,
    collider: Collider3DComponent,
    obstacles: list[CollisionBody],
) -> tuple[str, ...]:
    if not collider.solid or collider.trigger:
        return ()
    moving = aabb_for(position, collider)
    hits = []
    for obstacle in obstacles:
        if obstacle.id == body_id or not obstacle.collider.solid or obstacle.collider.trigger:
            continue
        obstacle_aabb = aabb_for(
            obstacle.transform.position,
            obstacle.collider,
            obstacle.transform.scale,
        )
        if moving.intersects(obstacle_aabb):
            hits.append(obstacle.id)
    return tuple(hits)


def move_with_collisions(
    body: CollisionBody,
    delta: Vector3,
    obstacles: list[CollisionBody],
    bounds: RoomBounds3DComponent | None = None,
) -> MotionResult:
    position = body.transform.position
    blocked: set[str] = set()
    collisions: set[str] = set()

    for axis in ("x", "y", "z"):
        value = getattr(position, axis) + getattr(delta, axis)
        candidate = position.with_axis(axis, value)
        if bounds is not None:
            candidate = clamp_to_room(candidate, body.collider, bounds)
            if getattr(candidate, axis) != value:
                blocked.add(axis)
        hits = colliding_ids(body.id, candidate, body.collider, obstacles)
        if hits:
            blocked.add(axis)
            collisions.update(hits)
            continue
        position = candidate

    return MotionResult(
        position=position,
        blocked_axes=frozenset(blocked),
        collisions=tuple(sorted(collisions)),
    )


__all__ = [
    "Aabb",
    "CollisionBody",
    "MotionResult",
    "aabb_for",
    "clamp_to_room",
    "collider_half_extents",
    "colliding_ids",
    "move_with_collisions",
]
