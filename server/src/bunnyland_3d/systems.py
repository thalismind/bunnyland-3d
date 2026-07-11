"""3D movement systems for Bunnyland's Relics world."""

from __future__ import annotations

from dataclasses import replace

from relics import Frequency, System

from .collision import CollisionBody, move_with_collisions
from .components import (
    Collider3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
    Velocity3DComponent,
)


def _replace_component(entity, component) -> None:
    if entity.has_component(type(component)):
        entity.remove_component(type(component))
    entity.add_component(component)


def _container_of(entity):
    try:
        from bunnyland.core import Contains
    except Exception:
        return None
    incoming = entity.get_incoming_relationships(Contains)
    if not incoming:
        return None
    return incoming[0][0]


def _speed_limited(linear: Vector3, max_speed: float) -> Vector3:
    speed_sq = linear.x * linear.x + linear.y * linear.y + linear.z * linear.z
    if max_speed <= 0 or speed_sq <= max_speed * max_speed:
        return linear
    speed = speed_sq**0.5
    return linear.scale_by(max_speed / speed)


def _body_for(entity) -> CollisionBody | None:
    if not entity.has_component(Transform3DComponent) or not entity.has_component(
        Collider3DComponent
    ):
        return None
    return CollisionBody(
        id=str(entity.id),
        transform=entity.get_component(Transform3DComponent),
        collider=entity.get_component(Collider3DComponent),
    )


def _room_bounds(world, entity) -> RoomBounds3DComponent | None:
    room_id = _container_of(entity)
    if room_id is None or not world.has_entity(room_id):
        return None
    room = world.get_entity(room_id)
    if room.has_component(RoomBounds3DComponent):
        return room.get_component(RoomBounds3DComponent)
    return None


def step_entities(world, entities, delta: float) -> None:
    """Advance 3D transforms for entities with velocity.

    This pure-ish helper accepts a Relics world and entity iterable so tests and custom
    runtimes can exercise the same movement/collision code without registering a system.
    """

    all_entities = list(entities)
    bodies = [body for entity in all_entities if (body := _body_for(entity)) is not None]
    for entity in all_entities:
        if not entity.has_component(Transform3DComponent) or not entity.has_component(
            Velocity3DComponent
        ):
            continue
        velocity = entity.get_component(Velocity3DComponent)
        transform = entity.get_component(Transform3DComponent)
        collider = (
            entity.get_component(Collider3DComponent)
            if entity.has_component(Collider3DComponent)
            else None
        )
        if collider is not None and collider.static:
            continue

        linear = _speed_limited(velocity.linear, velocity.max_speed)
        target_position = transform.position.add(linear.scale_by(delta))
        if collider is not None:
            body = CollisionBody(str(entity.id), transform, collider)
            result = move_with_collisions(
                body,
                target_position.add(transform.position.scale_by(-1)),
                bodies,
                _room_bounds(world, entity),
            )
            target_position = result.position
        angular_delta = velocity.angular.scale_by(delta)
        next_transform = replace(
            transform,
            position=target_position,
            rotation=transform.rotation.add(angular_delta),
        )
        if next_transform != transform:
            _replace_component(entity, next_transform)


class Movement3DSystem(System):
    """Relics system that integrates velocity and blocks movement at 3D colliders."""

    def query(self):
        return self.q.with_all([Transform3DComponent, Velocity3DComponent])

    def frequency(self) -> Frequency:
        return Frequency.EVERY_TICK

    def process(self, entities, components, delta) -> None:
        # Relics gives matching entities, but collision needs static colliders too. Different
        # Relics versions expose the owning world either on the system or on entities.
        world = getattr(self, "world", None)
        if world is None and entities:
            world = getattr(entities[0], "world", None)
        if world is None:
            step_entities(_EntityListWorld(entities), entities, float(delta))
        else:
            all_entities = world.query().with_all([Transform3DComponent]).execute_entities()
            step_entities(world, all_entities, float(delta))


class _EntityListWorld:
    def __init__(self, entities) -> None:
        self._by_id = {entity.id: entity for entity in entities}

    def has_entity(self, entity_id) -> bool:
        return entity_id in self._by_id

    def get_entity(self, entity_id):
        return self._by_id[entity_id]


__all__ = ["Movement3DSystem", "step_entities"]
