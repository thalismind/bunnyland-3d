from __future__ import annotations

from bunnyland_3d.collision import (
    CollisionBody,
    aabb_for,
    clamp_to_room,
    move_with_collisions,
)
from bunnyland_3d.components import (
    Collider3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
)


def test_aabb_collision_detects_overlap_and_separation():
    box = Collider3DComponent(shape="box", size=Vector3(2, 2, 2))
    near = aabb_for(Vector3(0, 0, 0), box)
    overlap = aabb_for(Vector3(0.9, 0, 0), box)
    far = aabb_for(Vector3(3.1, 0, 0), box)

    assert near.intersects(overlap)
    assert not near.intersects(far)


def test_sphere_collider_uses_radius_extents():
    sphere = Collider3DComponent(shape="sphere", radius=1.5)
    bounds = aabb_for(Vector3(4, 2, -1), sphere)

    assert bounds.min == Vector3(2.5, 0.5, -2.5)
    assert bounds.max == Vector3(5.5, 3.5, 0.5)


def test_clamp_to_room_respects_collider_size():
    room = RoomBounds3DComponent(size=Vector3(10, 4, 10))
    collider = Collider3DComponent(shape="box", size=Vector3(2, 2, 2))

    assert clamp_to_room(Vector3(-10, 10, 12), collider, room) == Vector3(1, 3, 9)


def test_move_with_collisions_slides_on_blocked_axis():
    body = CollisionBody(
        id="moving",
        transform=Transform3DComponent(position=Vector3(2, 1, 2)),
        collider=Collider3DComponent(shape="box", size=Vector3(1, 1, 1)),
    )
    wall = CollisionBody(
        id="wall",
        transform=Transform3DComponent(position=Vector3(4, 1, 2)),
        collider=Collider3DComponent(shape="box", size=Vector3(1, 2, 1), static=True),
    )

    result = move_with_collisions(body, Vector3(2, 0, 1), [body, wall])

    assert result.position == Vector3(2, 1, 3)
    assert result.blocked_axes == frozenset({"x"})
    assert result.collisions == ("wall",)
