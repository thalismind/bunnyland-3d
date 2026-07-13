from __future__ import annotations

import pytest
from bunnyland.core import WorldActor, spawn_entity
from bunnyland.foundation.environment.mechanics import FireComponent
from bunnyland.foundation.media.plugin import plugin as media_plugin
from bunnyland.plugins import apply_plugins
from pydantic.dataclasses import dataclass
from relics import Component

from bunnyland_3d import (
    HasVisualEffect3D,
    ParticleSystem3D,
    VisualEffectDefinition,
    VisualEffectError,
    VisualEffectInstance3DComponent,
    VisualEffectLightningLayer,
    VisualEffectParticleLayer,
    VisualEffectStateRule,
    apply_visual_effect,
    register_particle_systems,
    register_visual_effect_state_rules,
    register_visual_effects,
    remove_visual_effect,
)
from bunnyland_3d.plugin import plugin as plugin_3d
from bunnyland_3d.projection import entity_3d_view


@dataclass(frozen=True)
class Marked(Component):
    enabled: bool = True


def _actor(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)
    register_particle_systems(
        actor,
        "vendor.fx",
        (ParticleSystem3D("vendor.fx/rise", blending="additive"),),
    )
    register_visual_effects(
        actor,
        "vendor.fx",
        (
            VisualEffectDefinition(
                "vendor.fx/aura",
                particle_layers=(
                    VisualEffectParticleLayer(
                        "vendor.fx/rise", count=5, color="#112233"
                    ),
                    VisualEffectParticleLayer(
                        "vendor.fx/rise", count=3, color="#445566"
                    ),
                ),
                lightning_layers=(VisualEffectLightningLayer(color="#778899"),),
            ),
        ),
    )
    return actor


def _instances(actor, target):
    return [
        actor.world.get_entity(effect_id).get_component(
            VisualEffectInstance3DComponent
        )
        for _edge, effect_id in target.get_relationships(HasVisualEffect3D)
    ]


def test_registration_validates_ownership_duplicates_references_and_layers(
    tmp_path, monkeypatch
):
    actor = _actor(tmp_path, monkeypatch)

    with pytest.raises(VisualEffectError, match="begin with"):
        register_visual_effects(
            actor,
            "vendor.fx",
            [
                VisualEffectDefinition(
                    "other/aura",
                    particle_layers=(VisualEffectParticleLayer("vendor.fx/rise"),),
                )
            ],
        )
    with pytest.raises(VisualEffectError, match="already registered"):
        register_visual_effects(
            actor,
            "vendor.fx",
            [
                VisualEffectDefinition(
                    "vendor.fx/aura",
                    particle_layers=(VisualEffectParticleLayer("vendor.fx/rise"),),
                )
            ],
        )
    with pytest.raises(VisualEffectError, match="unknown particle system"):
        register_visual_effects(
            actor,
            "vendor.fx",
            [
                VisualEffectDefinition(
                    "vendor.fx/missing",
                    particle_layers=(VisualEffectParticleLayer("vendor.fx/nope"),),
                )
            ],
        )
    with pytest.raises(VisualEffectError, match="anchor_role"):
        register_visual_effects(
            actor,
            "vendor.fx",
            [
                VisualEffectDefinition(
                    "vendor.fx/bad-role",
                    anchor_role="Bad Role",
                    particle_layers=(VisualEffectParticleLayer("vendor.fx/rise"),),
                )
            ],
        )
    with pytest.raises(VisualEffectError, match="at least one layer"):
        register_visual_effects(
            actor, "vendor.fx", [VisualEffectDefinition("vendor.fx/empty")]
        )


def test_apply_refresh_remove_expire_persist_and_clean_orphans(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)
    target = spawn_entity(actor.world)

    first = apply_visual_effect(actor, target.id, "vendor.fx/aura", 5, "spell-a")
    seed = first.get_component(VisualEffectInstance3DComponent).seed
    refreshed = apply_visual_effect(actor, target.id, "vendor.fx/aura", 9, "spell-a")
    second = apply_visual_effect(actor, target.id, "vendor.fx/aura", -1, "spell-b")

    assert refreshed.id == first.id
    assert refreshed.get_component(VisualEffectInstance3DComponent).seed == seed
    assert sorted(item.remaining_seconds for item in _instances(actor, target)) == [-1, 9]
    assert remove_visual_effect(actor, target.id, "vendor.fx/aura", "spell-a")
    assert not actor.world.has_entity(first.id)
    assert not remove_visual_effect(actor, target.id, "vendor.fx/aura", "spell-a")

    finite = apply_visual_effect(actor, target.id, "vendor.fx/aura", 2, "finite")
    actor.world.tick(1.25)
    assert finite.get_component(VisualEffectInstance3DComponent).remaining_seconds == 0.75
    actor.world.tick(0.75)
    assert not actor.world.has_entity(finite.id)
    assert actor.world.has_entity(second.id)

    orphan = apply_visual_effect(actor, target.id, "vendor.fx/aura", -1, "orphan")
    target.remove_relationship(HasVisualEffect3D, orphan.id)
    actor.world.tick(0)
    assert not actor.world.has_entity(orphan.id)


def test_state_rules_materialize_remove_and_project_stably_without_models(
    tmp_path, monkeypatch
):
    actor = _actor(tmp_path, monkeypatch)
    register_visual_effect_state_rules(
        actor,
        "vendor.fx",
        (
            VisualEffectStateRule(
                "vendor.fx/marked",
                Marked,
                lambda entity: entity.get_component(Marked).enabled,
                "vendor.fx/aura",
            ),
        ),
    )
    target = spawn_entity(actor.world, [Marked()])

    actor.world.tick(0)
    first = entity_3d_view(target, actor)["effects3d"]
    second = entity_3d_view(target, actor)["effects3d"]

    assert first == second
    assert first[0]["remaining_seconds"] == -1
    assert [layer["color"] for layer in first[0]["particle_layers"]] == [
        "#112233",
        "#445566",
    ]
    assert first[0]["lightning_layers"][0]["segment_count"] == 8
    target.remove_component(Marked)
    actor.world.tick(0)
    assert "effects3d" not in entity_3d_view(target, actor)


def test_fire_uses_registered_multicolor_effect_on_procedural_entity(
    tmp_path, monkeypatch
):
    actor = WorldActor()
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    apply_plugins([media_plugin(), plugin_3d()], actor)
    target = spawn_entity(actor.world, [FireComponent()])

    actor.world.tick(0)
    view = entity_3d_view(target, actor)

    assert "visual3d" not in view
    assert [layer["color"] for layer in view["effects3d"][0]["particle_layers"]] == [
        "#ff7a24",
        "#e53920",
        "#777777",
    ]
    assert [
        layer["transform"]["translation"][1]
        for layer in view["effects3d"][0]["particle_layers"]
    ] == [0.95, 0.95, 1.25]
