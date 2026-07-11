from __future__ import annotations

import asyncio

import pytest
from bunnyland.core import RoomComponent, WorldActor, spawn_entity
from bunnyland.worldgen import RoomSpec, WorldProposal, instantiate

from bunnyland_3d.components import (
    DecorationSource3DComponent,
    HasDecoration3D,
    PropGroup3DComponent,
    PropInstanceOverride,
    RoomBounds3DComponent,
    Vector3,
)
from bunnyland_3d.decorations import RoomDecorationRule, register_room_decorations
from bunnyland_3d.projection import decoration_3d_view


def _outdoor(room) -> bool:
    return not room.get_component(RoomComponent).indoor


def _rule(**changes) -> RoomDecorationRule:
    values = {
        "key": "vendor.pack/trees",
        "model_key": "vendor.pack/tree",
        "room_predicate": _outdoor,
        "count": 2,
        "min_scale": 0.8,
        "max_scale": 1.2,
        "margin": 2.0,
        "tint": "#558844",
    }
    values.update(changes)
    return RoomDecorationRule(**values)


def _decoration(actor, room):
    relationships = room.get_relationships(HasDecoration3D)
    assert len(relationships) == 1
    return actor.world.get_entity(relationships[0][1])


def test_rules_apply_to_existing_and_future_rooms_and_reloads_are_idempotent():
    actor = WorldActor()
    existing = spawn_entity(actor.world, [RoomComponent(title="Grove")])
    indoor = spawn_entity(actor.world, [RoomComponent(title="Cabin", indoor=True)])

    register_room_decorations(actor, "vendor.pack", [_rule()])
    first = _decoration(actor, existing)
    register_room_decorations(actor, "vendor.pack", [_rule()])

    assert _decoration(actor, existing).id == first.id
    assert indoor.get_relationships(HasDecoration3D) == []
    result = asyncio.run(
        instantiate(
            actor,
            WorldProposal(seed="seed", rooms=[RoomSpec(key="future", title="Future Grove")]),
        )
    )
    future = actor.world.get_entity(result.rooms["future"])
    future_seed = _decoration(actor, future).get_component(PropGroup3DComponent).seed
    assert future_seed != first.get_component(PropGroup3DComponent).seed


def test_rule_ownership_validation_fixed_projection_and_stable_seed():
    fixed = (
        PropInstanceOverride("i0", position=Vector3(8, 0, 8), rotation_y=0.0, scale=1.0),
        PropInstanceOverride("i1", position=Vector3(2, 0, 3), rotation_y=1.0, scale=1.1),
    )
    actor = WorldActor()
    room = spawn_entity(
        actor.world, [RoomComponent(title="Grove"), RoomBounds3DComponent()]
    )
    register_room_decorations(actor, "vendor.pack", [_rule(fixed_instances=fixed)])
    decoration = _decoration(actor, room)
    source = decoration.get_component(DecorationSource3DComponent)
    group = decoration.get_component(PropGroup3DComponent)
    view = decoration_3d_view(decoration, room.get_component(RoomBounds3DComponent))

    assert source.role == "vendor.pack/trees"
    assert group.recipe_key == "vendor.pack/trees"
    assert view["prop_group3d"]["instances"][0]["position"] == {"x": 8, "y": 0, "z": 8}
    assert view["prop_group3d"]["instances"][1]["rotation_y"] == 1.0
    with pytest.raises(ValueError, match="begin"):
        register_room_decorations(actor, "other.pack", [_rule()])
    with pytest.raises(ValueError, match="namespaced"):
        _rule(key="trees")
    with pytest.raises(ValueError, match="i0 through"):
        _rule(fixed_instances=(fixed[1],))
