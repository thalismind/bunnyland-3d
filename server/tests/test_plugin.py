from __future__ import annotations

import pytest
from bunnyland.core import ContainmentMode, Contains, RoomComponent, WorldActor, spawn_entity
from bunnyland.core.components import CharacterComponent, IdentityComponent, PortableComponent
from bunnyland.core.events import (
    CharacterGeneratedEvent,
    ObjectGeneratedEvent,
    RoomGeneratedEvent,
    event_base,
)
from bunnyland.persistence import WorldMeta
from bunnyland.plugins import apply_plugins, load_modules
from bunnyland.server.app import create_app

from bunnyland_3d.api import room_scene_view
from bunnyland_3d.components import (
    Collider3DComponent,
    DecorationSource3DComponent,
    Environment3DComponent,
    HasDecoration3D,
    Light3DComponent,
    ParticleEmitter3DComponent,
    PropGroup3DComponent,
    PropInstanceOverride,
    Render3DComponent,
    RoomBounds3DComponent,
    Transform3DComponent,
    Vector3,
    Velocity3DComponent,
)
from bunnyland_3d.decorations import apply_outdoor_recipe, preview_outdoor_recipe
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
    assert PropGroup3DComponent in plugin.ecs.components
    assert Light3DComponent in plugin.ecs.components
    assert ParticleEmitter3DComponent in plugin.ecs.components
    assert DecorationSource3DComponent in plugin.ecs.components
    assert HasDecoration3D in plugin.ecs.edges
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

    # Exercise the legacy worldgen callback contract directly. Bunnyland releases before
    # the hook registry became public do not expose actor._worldgen_hooks, while both old
    # and new loaders invoke these callbacks with the actor attached.
    hook = Worldgen3DHook()
    hook.actor = actor
    hook._on_room(
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
    hook._on_character(
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
    hook._on_object(
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

    assert room.get_component(Transform3DComponent).position == Vector3()
    assert room.get_component(RoomBounds3DComponent).size == Vector3(16, 4, 16)
    assert room.get_component(Render3DComponent).color == "#4f6f9f"
    assert character.get_component(Collider3DComponent).shape == "capsule"
    assert character.get_component(Render3DComponent).shape == "capsule"
    assert character.get_component(Render3DComponent).asset_key == "avatar.leporid"
    character_position = character.get_component(Transform3DComponent).position
    assert 0 < character_position.x < 16
    assert 0 < character_position.z < 16
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
            Render3DComponent(
                shape="sphere",
                color="#a6e3a1",
                label="Orb",
                asset_key="prop.orb",
                variant_key="moss",
            ),
        ],
    )

    view = entity_3d_view(entity)
    world_view = world_3d_view(actor.world)

    assert view["transform3d"]["position"] == {"x": 1.0, "y": 2.0, "z": 3.0}
    assert view["collider3d"]["shape"] == "sphere"
    assert view["render3d"]["label"] == "Orb"
    assert view["render3d"]["asset_key"] == "prop.orb"
    assert view["render3d"]["variant_key"] == "moss"
    assert world_view["entities"][0]["id"] == str(entity.id)


def test_render_keys_reject_remote_or_malformed_assets():
    with pytest.raises(ValueError):
        Render3DComponent(asset_key="https://example.com/model.glb")


def test_v2_routes_report_capabilities_and_project_only_visible_room_entities():
    testclient = pytest.importorskip("fastapi.testclient")
    actor = WorldActor()
    plugins = load_modules(["bunnyland_3d"])
    apply_plugins(plugins, actor)
    room = spawn_entity(
        actor.world,
        [
            RoomComponent(title="Lantern Field", biome="meadow"),
            RoomBounds3DComponent(size=Vector3(16, 4, 16)),
            Render3DComponent(color="#7ca85c", asset_key="room.meadow"),
        ],
    )
    visible = spawn_entity(
        actor.world,
        [
            IdentityComponent(name="Iris", kind="character"),
            CharacterComponent(),
            Transform3DComponent(position=Vector3(8, 0.9, 8)),
            Collider3DComponent(shape="capsule", size=Vector3(0.7, 1.8, 0.7)),
            Render3DComponent(shape="capsule", asset_key="avatar.leporid"),
        ],
    )
    hidden = spawn_entity(
        actor.world,
        [
            IdentityComponent(name="Secret", kind="item"),
            Transform3DComponent(position=Vector3(3, 0.3, 3)),
            Render3DComponent(asset_key="prop.generic"),
        ],
    )
    room.add_relationship(Contains(mode=ContainmentMode.ROOM_CONTENT), visible.id)
    room.add_relationship(
        Contains(mode=ContainmentMode.ROOM_CONTENT, visible=False),
        hidden.id,
    )

    client = testclient.TestClient(
        create_app(actor, meta=WorldMeta(seed="v2"), plugins=tuple(plugins))
    )
    capability = client.get("/3d/v2/capabilities")
    scene = client.get(f"/3d/v2/room/{room.id}")

    assert capability.status_code == 200
    assert capability.json()["scene_schema_version"] == 3
    assert scene.status_code == 200
    data = scene.json()
    assert data["schema_version"] == 3
    assert data["room"]["bounds3d"]["size"] == {"x": 16.0, "y": 4.0, "z": 16.0}
    assert [entity["id"] for entity in data["entities"]] == [str(visible.id)]
    assert data["entities"][0]["render3d"]["asset_key"] == "avatar.leporid"


def test_outdoor_decoration_is_ecs_backed_idempotent_and_not_room_content():
    actor = WorldActor()
    room = spawn_entity(
        actor.world,
        [
            RoomComponent(title="Wildflower Rise", biome="meadow", indoor=False),
            RoomBounds3DComponent(size=Vector3(16, 8, 16)),
        ],
    )

    preview = preview_outdoor_recipe(room)
    first = apply_outdoor_recipe(actor.world, room)
    decoration_ids = [target for _edge, target in room.get_relationships(HasDecoration3D)]
    second = apply_outdoor_recipe(actor.world, room)

    assert preview["status"] == "preview"
    assert first["instances"] == preview["instances"]
    assert second["status"] == "applied"
    assert decoration_ids == [target for _edge, target in room.get_relationships(HasDecoration3D)]
    assert len(decoration_ids) == 4
    assert room.get_relationships(Contains) == []
    assert room.get_component(Environment3DComponent).has_roof is False
    scene = room_scene_view(actor, str(room.id))
    assert len(scene["decorations"]) == 4
    flora = next(item for item in scene["decorations"] if item.get("prop_group3d"))
    assert flora["prop_group3d"]["instances"] == next(
        item["prop_group3d"]["instances"]
        for item in room_scene_view(actor, str(room.id))["decorations"]
        if item.get("prop_group3d")
    )


def test_reroll_changes_seed_but_preserves_group_overrides():
    actor = WorldActor()
    room = spawn_entity(actor.world, [RoomComponent(title="Reeds", biome="marsh")])
    apply_outdoor_recipe(actor.world, room)
    flora_id = next(
        target for edge, target in room.get_relationships(HasDecoration3D) if edge.role == "flora"
    )
    flora = actor.world.get_entity(flora_id)
    original = flora.get_component(PropGroup3DComponent)
    replacement = PropGroup3DComponent(
        recipe_key=original.recipe_key,
        seed=original.seed,
        asset_key=original.asset_key,
        count=original.count,
        color=original.color,
        excluded_instance_ids=("i2",),
        overrides=(PropInstanceOverride(instance_id="i3", scale=2.0),),
    )
    flora.remove_component(PropGroup3DComponent)
    flora.add_component(replacement)

    apply_outdoor_recipe(actor.world, room, reroll=True)
    rerolled = flora.get_component(PropGroup3DComponent)

    assert rerolled.seed != original.seed
    assert rerolled.excluded_instance_ids == ("i2",)
    assert rerolled.overrides[0].scale == 2.0


def test_indoor_room_decoration_is_skipped_without_mutation():
    actor = WorldActor()
    room = spawn_entity(
        actor.world, [RoomComponent(title="Glasshouse", biome="garden", indoor=True)]
    )

    result = apply_outdoor_recipe(actor.world, room)

    assert result["status"] == "skipped"
    assert not room.has_component(Environment3DComponent)
    assert room.get_relationships(HasDecoration3D) == []


def test_admin_decoration_roof_and_texture_routes(tmp_path, monkeypatch):
    testclient = pytest.importorskip("fastapi.testclient")
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path))
    actor = WorldActor()
    plugins = load_modules(["bunnyland_3d"])
    apply_plugins(plugins, actor)
    room = spawn_entity(
        actor.world,
        [
            RoomComponent(title="Sun Field", biome="meadow"),
            RoomBounds3DComponent(size=Vector3(16, 8, 16)),
        ],
    )
    client = testclient.TestClient(
        create_app(actor, meta=WorldMeta(seed="graphics"), plugins=plugins, admin_token="secret")
    )
    headers = {"X-Bunnyland-Admin-Secret": "secret"}

    assert (
        client.get(f"/admin/3d/room/{room.id}/decoration/preview", headers=headers).status_code
        == 200
    )
    applied = client.post(f"/admin/3d/room/{room.id}/decoration/apply", headers=headers)
    roofed = client.put(f"/admin/3d/room/{room.id}/roof", headers=headers, json={"has_roof": True})
    uploaded = client.post(
        f"/admin/3d/texture/room/{room.id}/skybox",
        headers={**headers, "content-type": "image/png"},
        content=b"not-decoded-by-media-store",
    )
    scene = client.get(f"/3d/v2/room/{room.id}").json()

    assert applied.status_code == 200
    assert roofed.json()["has_roof"] is True
    assert uploaded.status_code == 200
    assert scene["room"]["environment3d"]["has_roof"] is True
    assert scene["room"]["environment3d"]["skybox_url"].startswith("/media/textures3d/")
    assert len(scene["decorations"]) == 4
    assert scene["entities"] == []
