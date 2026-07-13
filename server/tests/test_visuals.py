from bunnyland.core import ContainerComponent, HealthComponent, WorldActor
from bunnyland.core.ecs import spawn_entity
from bunnyland.foundation.environment.mechanics import FireComponent
from bunnyland.foundation.media.plugin import plugin as media_plugin
from bunnyland.plugins import apply_plugins

from bunnyland_3d import (
    EntityVisualContribution,
    EntityVisualError,
    EntityVisualRule,
    ModelAsset,
    PrimitivePart3D,
    ProceduralModelSource,
    Render3DComponent,
    VisualAttachment,
    VisualNodePatch,
    register_entity_visuals,
    register_models,
    require_entity_visual_registry,
    require_model_registry,
)
from bunnyland_3d.plugin import plugin as plugin_3d
from bunnyland_3d.projection import entity_3d_view


def _actor(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)
    register_models(
        actor,
        "vendor.plugin",
        (
            ModelAsset(
                "vendor.plugin/chest",
                ProceduralModelSource(
                    parts=(
                        PrimitivePart3D(
                            "body", "box", roles=("damageable", "lock-anchor")
                        ),
                        PrimitivePart3D("lid", "box", roles=("openable",)),
                    )
                ),
            ),
        ),
    )
    return actor


def test_rules_compose_live_state_per_field_without_mutating_ecs(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)
    entity = spawn_entity(
        actor.world,
        [
            HealthComponent(current=20, maximum=100),
            ContainerComponent(open=True, locked=True),
            Render3DComponent(asset_key="vendor.plugin/chest", opacity=0.8),
        ],
    )
    original = entity.get_component(Render3DComponent)

    view = entity_3d_view(entity, actor)["visual3d"]

    patches = {patch["target"]: patch for patch in view["node_patches"]}
    assert view["base_model_key"] == "vendor.plugin/chest"
    assert patches["body"]["color_multiply"] == "#b84040"
    assert patches["lid"]["transform"]["rotation"][0] == -1.2
    assert patches["*"]["opacity"] == 0.8
    assert view["attachments"][0]["anchor"] == "body"
    assert view["attachments"][0]["transform"]["translation"] == [0, -0.04, 0.14]
    assert entity.get_component(Render3DComponent) == original


def test_fire_rule_keeps_emissive_patch_but_uses_registered_effect(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)
    entity = spawn_entity(
        actor.world,
        [
            FireComponent(),
            Render3DComponent(asset_key="bunnyland.3d/showcase-prop"),
        ],
    )

    actor.world.tick(0)
    view = entity_3d_view(entity, actor)
    visual = view["visual3d"]

    assert visual["attachments"] == []
    assert visual["particle_effects"] == []
    indicator = next(
        patch for patch in visual["node_patches"] if patch["target"] == "indicator"
    )
    assert indicator["emissive"] == "#ff5a16"
    assert indicator["opacity"] == 1.0
    assert view["effects3d"][0]["key"] == "bunnyland.3d/fire"


def test_showcase_state_indicator_is_hidden_until_used(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)

    model = require_model_registry(actor).models["bunnyland.3d/showcase-prop"].asset
    indicator = next(part for part in model.source.parts if part.name == "indicator")

    assert indicator.material.opacity == 0.0


def test_rule_ties_are_deterministic_per_field_and_emit_diagnostic(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)
    register_entity_visuals(
        actor,
        "vendor.plugin",
        (
            EntityVisualRule(
                "vendor.plugin/a",
                lambda _entity: True,
                50,
                EntityVisualContribution(
                    base_model_key="vendor.plugin/chest",
                    patches=(VisualNodePatch("body", opacity=0.2),),
                ),
            ),
            EntityVisualRule(
                "vendor.plugin/z",
                lambda _entity: True,
                50,
                EntityVisualContribution(patches=(VisualNodePatch("body", opacity=0.9),)),
            ),
        ),
    )
    entity = spawn_entity(actor.world, [Render3DComponent(asset_key="vendor.plugin/chest")])

    visual = entity_3d_view(entity, actor)["visual3d"]

    body = next(patch for patch in visual["node_patches"] if patch["target"] == "body")
    assert body["opacity"] == 0.9
    assert "equal-priority patch conflict" in require_entity_visual_registry(
        actor
    ).diagnostics[-1]


def test_registration_validates_ownership_models_and_required_targets(tmp_path, monkeypatch):
    actor = _actor(tmp_path, monkeypatch)
    bad = EntityVisualRule(
        "vendor.plugin/bad",
        lambda _entity: True,
        contribution=EntityVisualContribution(
            base_model_key="vendor.plugin/chest",
            patches=(VisualNodePatch("missing", required=True),),
            attachments=(
                VisualAttachment(
                    "vendor.plugin/lock",
                    "bunnyland.3d/lock",
                    "body",
                ),
            ),
        ),
    )
    try:
        register_entity_visuals(actor, "vendor.plugin", (bad,))
    except EntityVisualError as exc:
        assert "required visual target" in str(exc)
    else:
        raise AssertionError("required missing target was accepted")
