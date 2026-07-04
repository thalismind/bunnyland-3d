from __future__ import annotations

import asyncio

from bunnyland.core import ContainmentMode, Contains, RoomComponent, WorldActor, spawn_entity
from bunnyland.core.components import CharacterComponent, IdentityComponent, PortableComponent
from bunnyland.core.events import (
    CharacterGeneratedEvent,
    ObjectGeneratedEvent,
    RoomGeneratedEvent,
    event_base,
)
from bunnyland.plugins import apply_plugins, load_modules

from bunnyland_3d.components import (
    Collider3DComponent,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
    Velocity3DComponent,
)
from bunnyland_3d.enrichment import Worldgen3DHook
from bunnyland_3d.plugin import PLUGIN_ID
from bunnyland_3d.projection import entity_3d_view, world_3d_view
from bunnyland_3d.systems import step_entities


def test_out_of_tree_plugin_loads_and_contributes_ecs_types():
    plugins = load_modules(["bunnyland_3d"])

    assert [plugin.id for plugin in plugins] == [PLUGIN_ID]
    plugin = plugins[0]
    assert Transform3DComponent in plugin.ecs.components
    assert Velocity3DComponent in plugin.ecs.components
    assert Collider3DComponent in plugin.ecs.components
    assert Render3DComponent in plugin.ecs.components
    assert RoomBounds3DComponent in plugin.ecs.components
    assert Worldgen3DHook in plugin.content.worldgen_hooks


def test_out_of_tree_plugin_applies_to_actor_without_server_repo_changes():
    actor = WorldActor()
    applied = apply_plugins(load_modules(["bunnyland_3d"]), actor)

    assert applied[0].id == "bunnyland.3d"


def test_registered_movement_system_ticks_from_plugin():
    actor = WorldActor()
    apply_plugins(load_modules(["bunnyland_3d"]), actor)
    moving = spawn_entity(
        actor.world,
        [
            Transform3DComponent(position=Vector3(1, 1, 1)),
            Velocity3DComponent(linear=Vector3(1, 0, 0), max_speed=10),
        ],
    )

    actor.world.tick(2.0)

    assert moving.get_component(Transform3DComponent).position == Vector3(3, 1, 1)


def test_worldgen_hook_adds_3d_components_to_generated_entities():
    actor = WorldActor()
    apply_plugins(load_modules(["bunnyland_3d"]), actor)
    room = spawn_entity(
        actor.world,
        [RoomComponent(title="Docking Ring", biome="station", indoor=True)],
    )
    character = spawn_entity(
        actor.world,
        [
            IdentityComponent(name="Iris", kind="character"),
            CharacterComponent(),
        ],
    )
    item = spawn_entity(
        actor.world,
        [
            IdentityComponent(name="Beacon", kind="item"),
            PortableComponent(),
        ],
    )

    asyncio.run(
        actor.bus.publish(
            RoomGeneratedEvent(
                **event_base(0),
                seed="preview",
                entity_id=str(room.id),
                entity_key="room:dock",
                entity_kind="room",
                room_key="dock",
                biome="station",
                indoor=True,
            )
        )
    )
    asyncio.run(
        actor.bus.publish(
            CharacterGeneratedEvent(
                **event_base(0),
                seed="preview",
                entity_id=str(character.id),
                entity_key="character:iris",
                entity_kind="character",
                character_key="iris",
                room_id=str(room.id),
            )
        )
    )
    asyncio.run(
        actor.bus.publish(
            ObjectGeneratedEvent(
                **event_base(0),
                seed="preview",
                entity_id=str(item.id),
                entity_key="item:beacon",
                entity_kind="object",
                object_key="beacon",
                room_id=str(room.id),
            )
        )
    )

    assert room.get_component(Transform3DComponent).position == Vector3()
    assert room.get_component(RoomBounds3DComponent).size == Vector3(16, 4, 16)
    assert room.get_component(Render3DComponent).color == "#4f6f9f"
    assert character.get_component(Collider3DComponent).shape == "capsule"
    assert character.get_component(Render3DComponent).shape == "sphere"
    assert item.get_component(Collider3DComponent).static
    assert item.get_component(Render3DComponent).shape == "box"


def test_step_entities_moves_until_static_collider_blocks():
    actor = WorldActor()
    room = spawn_entity(
        actor.world,
        [RoomComponent(title="Test Room"), RoomBounds3DComponent(size=Vector3(8, 4, 8))],
    )
    moving = spawn_entity(
        actor.world,
        [
            Transform3DComponent(position=Vector3(2, 1, 2)),
            Velocity3DComponent(linear=Vector3(10, 0, 0), max_speed=10),
            Collider3DComponent(shape="box", size=Vector3(1, 1, 1)),
            Render3DComponent(shape="box", color="#89b4fa"),
        ],
    )
    wall = spawn_entity(
        actor.world,
        [
            Transform3DComponent(position=Vector3(4, 1, 2)),
            Collider3DComponent(shape="box", size=Vector3(1, 2, 1), static=True),
            Render3DComponent(shape="box", color="#f38ba8"),
        ],
    )
    room.add_relationship(Contains(mode=ContainmentMode.ROOM_CONTENT), moving.id)
    room.add_relationship(Contains(mode=ContainmentMode.ROOM_CONTENT), wall.id)

    step_entities(actor.world, [room, moving, wall], 0.2)

    assert moving.get_component(Transform3DComponent).position == Vector3(2, 1, 2)


def test_step_entities_clamps_to_room_bounds():
    actor = WorldActor()
    room = spawn_entity(
        actor.world,
        [RoomComponent(title="Test Room"), RoomBounds3DComponent(size=Vector3(8, 4, 8))],
    )
    moving = spawn_entity(
        actor.world,
        [
            Transform3DComponent(position=Vector3(6, 1, 6)),
            Velocity3DComponent(linear=Vector3(20, 0, 20), max_speed=40),
            Collider3DComponent(shape="box", size=Vector3(2, 2, 2)),
        ],
    )
    room.add_relationship(Contains(mode=ContainmentMode.ROOM_CONTENT), moving.id)

    step_entities(actor.world, [room, moving], 1.0)

    assert moving.get_component(Transform3DComponent).position == Vector3(7, 1, 7)


def test_projection_includes_3d_components():
    actor = WorldActor()
    entity = spawn_entity(
        actor.world,
        [
            Transform3DComponent(position=Vector3(1, 2, 3)),
            Collider3DComponent(shape="sphere", radius=0.75),
            Render3DComponent(shape="sphere", color="#a6e3a1", label="Orb"),
        ],
    )

    view = entity_3d_view(entity)
    world_view = world_3d_view(actor.world)

    assert view["transform3d"]["position"] == {"x": 1.0, "y": 2.0, "z": 3.0}
    assert view["collider3d"]["shape"] == "sphere"
    assert view["render3d"]["label"] == "Orb"
    assert world_view["entities"][0]["id"] == str(entity.id)
