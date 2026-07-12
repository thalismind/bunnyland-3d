from __future__ import annotations

import pytest
from bunnyland.core import RoomComponent, WorldActor, spawn_entity
from bunnyland.foundation.media.plugin import plugin as media_plugin
from bunnyland.plugins import (
    DependencyContribution,
    Plugin,
    RuntimeContribution,
    apply_plugins,
)

from bunnyland_3d import (
    Environment3DComponent,
    EnvironmentEffectError,
    ParticleEmitter3DComponent,
    ParticleSystem3D,
    RoomBounds3DComponent,
    RoomParticleRule,
    RoomSkyboxRule,
    Skybox3D,
    register_particle_rules,
    register_particle_systems,
    register_skybox_rules,
    register_skyboxes,
    require_environment_effect_registry,
)
from bunnyland_3d.api import room_scene_view
from bunnyland_3d.decorations import apply_outdoor_recipe
from bunnyland_3d.plugin import plugin as plugin_3d
from bunnyland_3d.projection import entity_3d_view


def _vendor_plugin() -> Plugin:
    def install_effects(actor) -> None:
        register_skyboxes(
            actor,
            "vendor.weather",
            (
                Skybox3D(
                    "vendor.weather/night",
                    zenith_color="#071229",
                    horizon_color="#29375c",
                    sun_color="#dbe8ff",
                    cloud_count=0,
                    star_opacity=0.85,
                    star_count=180,
                ),
                Skybox3D("vendor.weather/day"),
            ),
        )
        register_particle_systems(
            actor,
            "vendor.weather",
            (
                ParticleSystem3D(
                    "vendor.weather/snow",
                    vertical_motion="fall",
                    vertical_scale=0.7,
                    lateral_wobble=0.16,
                ),
            ),
        )
        register_skybox_rules(
            actor,
            "vendor.weather",
            (
                RoomSkyboxRule(
                    "vendor.weather/snowy-sky",
                    "vendor.weather/night",
                    lambda _world, room: room.get_component(RoomComponent).biome == "snow",
                    priority=20,
                ),
            ),
        )
        register_particle_rules(
            actor,
            "vendor.weather",
            (
                RoomParticleRule(
                    "vendor.weather/snowfall",
                    "vendor.weather/snow",
                    lambda _world, room: room.get_component(RoomComponent).biome == "snow",
                    count=32,
                    height=5,
                    margin=2,
                ),
            ),
        )

    return Plugin(
        id="vendor.weather",
        name="Weather Visuals",
        dependencies=DependencyContribution(requires=("bunnyland.3d",)),
        runtime=RuntimeContribution(integration_factories=(install_effects,)),
    )


def test_plugin_effects_register_after_3d_and_project_declarative_views():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d(), _vendor_plugin()], actor)
    room = spawn_entity(
        actor.world,
        [Environment3DComponent(skybox_preset="vendor.weather/night")],
    )
    emitter = spawn_entity(
        actor.world,
        [ParticleEmitter3DComponent(preset="vendor.weather/snow", seed=7)],
    )

    environment = entity_3d_view(room, actor)["environment3d"]
    particles = entity_3d_view(emitter, actor)["particle_emitter3d"]

    assert environment["skybox"]["key"] == "vendor.weather/night"
    assert environment["skybox"]["star_count"] == 180
    assert particles["system"] == {
        "key": "vendor.weather/snow",
        "blending": "normal",
        "vertical_motion": "fall",
        "vertical_scale": 0.7,
        "lateral_wobble": 0.16,
        "pulse_amount": 0.0,
        "pulse_speed": 2.4,
    }


def test_registration_enforces_ownership_uniqueness_and_bounds():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)

    with pytest.raises(EnvironmentEffectError, match="begin with"):
        register_skyboxes(actor, "vendor.weather", [Skybox3D("other/night")])
    with pytest.raises(EnvironmentEffectError, match="star_count"):
        register_skyboxes(
            actor,
            "vendor.weather",
            [Skybox3D("vendor.weather/night", star_count=513)],
        )
    with pytest.raises(EnvironmentEffectError, match="pulse_amount"):
        register_particle_systems(
            actor,
            "vendor.weather",
            [ParticleSystem3D("vendor.weather/snow", pulse_amount=1.1)],
        )

    register_skyboxes(actor, "vendor.weather", [Skybox3D("vendor.weather/night")])
    with pytest.raises(EnvironmentEffectError, match="already registered"):
        register_skyboxes(actor, "vendor.weather", [Skybox3D("vendor.weather/night")])


def test_unknown_persisted_effects_fall_back_with_diagnostics():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)
    registry = require_environment_effect_registry(actor)
    room = spawn_entity(
        actor.world,
        [Environment3DComponent(skybox_preset="missing.plugin/sky")],
    )
    emitter = spawn_entity(
        actor.world,
        [ParticleEmitter3DComponent(preset="missing.plugin/weather", seed=3)],
    )

    assert entity_3d_view(room, actor)["environment3d"]["skybox"]["key"] == (
        "bunnyland.3d/default"
    )
    assert entity_3d_view(emitter, actor)["particle_emitter3d"]["system"]["key"] == (
        "bunnyland.3d/pollen"
    )
    assert registry.diagnostics == [
        "unknown skybox 'missing.plugin/sky'; using bunnyland.3d/default",
        "unknown particle system 'missing.plugin/weather'; using bunnyland.3d/pollen",
    ]


def test_room_rules_select_skybox_and_replace_only_core_particles():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d(), _vendor_plugin()], actor)
    room = spawn_entity(
        actor.world,
        [
            RoomComponent(title="Snowfield", biome="snow"),
            RoomBounds3DComponent(),
            Environment3DComponent(),
        ],
    )
    apply_outdoor_recipe(actor.world, room)

    scene = room_scene_view(actor, str(room.id))
    particles = [
        item for item in scene["decorations"] if item.get("particle_emitter3d")
    ]

    assert scene["room"]["environment3d"]["skybox_preset"] == "vendor.weather/night"
    assert len(particles) == 1
    assert particles[0]["decoration_source3d"]["role"] == "vendor.weather/snowfall"
    assert particles[0]["particle_emitter3d"]["count"] == 32
    assert particles[0]["particle_emitter3d"]["bounds"] == {
        "x": 12.0,
        "y": 5,
        "z": 12.0,
    }
    assert particles[0]["particle_emitter3d"]["preset"] == "vendor.weather/snow"
    register_skybox_rules(
        actor,
        "vendor.weather",
        [
            RoomSkyboxRule(
                "vendor.weather/z-snowy-sky",
                "vendor.weather/day",
                lambda _world, _room: True,
                priority=20,
            )
        ],
    )
    assert room_scene_view(actor, str(room.id))["room"]["environment3d"][
        "skybox_preset"
    ] == "vendor.weather/day"


def test_explicit_skybox_beats_room_rule_and_rule_results_are_stable():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d(), _vendor_plugin()], actor)
    room = spawn_entity(
        actor.world,
        [
            RoomComponent(title="Snowfield", biome="snow"),
            Environment3DComponent(skybox_preset="vendor.weather/day"),
        ],
    )

    first = room_scene_view(actor, str(room.id))
    second = room_scene_view(actor, str(room.id))

    assert first == second
    assert first["room"]["environment3d"]["skybox_preset"] == "vendor.weather/day"


def test_room_rule_registration_validates_references_and_parameters():
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)

    def predicate(_world, _room):
        return True

    with pytest.raises(EnvironmentEffectError, match="unknown skybox"):
        register_skybox_rules(
            actor,
            "vendor.weather",
            [RoomSkyboxRule("vendor.weather/rule", "vendor.weather/missing", predicate)],
        )
    with pytest.raises(EnvironmentEffectError, match="unknown particle system"):
        register_particle_rules(
            actor,
            "vendor.weather",
            [
                RoomParticleRule(
                    "vendor.weather/rule", "vendor.weather/missing", predicate
                )
            ],
        )
    register_particle_systems(
        actor, "vendor.weather", [ParticleSystem3D("vendor.weather/snow")]
    )
    with pytest.raises(EnvironmentEffectError, match="count"):
        register_particle_rules(
            actor,
            "vendor.weather",
            [
                RoomParticleRule(
                    "vendor.weather/rule",
                    "vendor.weather/snow",
                    predicate,
                    count=1501,
                )
            ],
        )
