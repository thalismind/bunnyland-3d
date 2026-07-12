"""Composable, projection-only entity appearance rules."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from .assets import ModelTransform, require_model_registry
from .components import Render3DComponent
from .effects import require_environment_effect_registry

_VISUAL_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)+$")


class EntityVisualError(ValueError):
    """An entity visual rule is invalid."""


@dataclass(frozen=True)
class VisualNodePatch:
    target: str
    semantic_role: bool = False
    required: bool = False
    visible: bool | None = None
    transform: ModelTransform | None = None
    color_multiply: str | None = None
    emissive: str | None = None
    opacity: float | None = None
    variant: str | None = None


@dataclass(frozen=True)
class VisualAttachment:
    key: str
    model_key: str
    anchor: str
    semantic_role: bool = False
    required: bool = False
    visible: bool = True
    transform: ModelTransform = field(default_factory=ModelTransform)


@dataclass(frozen=True)
class VisualParticleEffect:
    key: str
    anchor: str
    semantic_role: bool = False
    required: bool = False
    preset: str = "fire"
    seed: int = 0
    count: int = 24
    bounds: tuple[float, float, float] = (0.4, 0.7, 0.4)
    color: str = "#ff7a24"
    size: float = 0.08
    speed: float = 0.7
    opacity: float = 0.9
    transform: ModelTransform = field(default_factory=ModelTransform)


@dataclass(frozen=True)
class EntityVisualContribution:
    base_model_key: str = ""
    patches: tuple[VisualNodePatch, ...] = ()
    attachments: tuple[VisualAttachment, ...] = ()
    particle_effects: tuple[VisualParticleEffect, ...] = ()


@dataclass(frozen=True)
class EntityVisualRule:
    key: str
    predicate: Callable[[Any], bool]
    priority: int = 0
    contribution: EntityVisualContribution = field(default_factory=EntityVisualContribution)


def _transform_view(transform: ModelTransform) -> dict[str, Any]:
    return {
        "scale": transform.scale,
        "rotation": list(transform.rotation),
        "translation": list(transform.translation),
    }


class EntityVisualRegistry:
    def __init__(self, actor) -> None:
        self.actor = actor
        self._rules: dict[str, EntityVisualRule] = {}
        self.diagnostics: list[str] = []

    @property
    def rules(self) -> dict[str, EntityVisualRule]:
        return dict(self._rules)

    def register(self, owner: str, rules: Iterable[EntityVisualRule]) -> None:
        models = require_model_registry(self.actor).models
        prefix = f"{owner}/"
        for rule in rules:
            if not _VISUAL_KEY.fullmatch(rule.key) or not rule.key.startswith(prefix):
                raise EntityVisualError(f"visual rule key must begin with {prefix!r}")
            if rule.key in self._rules:
                raise EntityVisualError(f"visual rule key is already registered: {rule.key}")
            contribution = rule.contribution
            if contribution.base_model_key and contribution.base_model_key not in models:
                raise EntityVisualError(f"unknown base model: {contribution.base_model_key}")
            for attachment in contribution.attachments:
                if not _VISUAL_KEY.fullmatch(attachment.key) or not attachment.key.startswith(
                    prefix
                ):
                    raise EntityVisualError(f"attachment key must begin with {prefix!r}")
                if attachment.model_key not in models:
                    raise EntityVisualError(f"unknown attachment model: {attachment.model_key}")
            for effect in contribution.particle_effects:
                if not _VISUAL_KEY.fullmatch(effect.key) or not effect.key.startswith(prefix):
                    raise EntityVisualError(f"particle effect key must begin with {prefix!r}")
                systems = require_environment_effect_registry(self.actor).particle_systems
                aliases = {"pollen", "fireflies", "spores", "dust", "mist", "fire"}
                if effect.preset not in aliases and effect.preset not in systems:
                    raise EntityVisualError(f"unsupported visual particle preset: {effect.preset}")
                if effect.count <= 0:
                    raise EntityVisualError("visual particle count must be positive")
            if contribution.base_model_key:
                model = models[contribution.base_model_key]
                for patch in contribution.patches:
                    targets = (
                        model.semantic_roles.get(patch.target, ()) if patch.semantic_role else ()
                    )
                    present = bool(targets) if patch.semantic_role else patch.target in model.nodes
                    if patch.required and not present:
                        raise EntityVisualError(
                            "required visual target is missing from "
                            f"{contribution.base_model_key}: {patch.target}"
                        )
                for attachment in contribution.attachments:
                    targets = (
                        model.semantic_roles.get(attachment.anchor, ())
                        if attachment.semantic_role
                        else ()
                    )
                    present = (
                        bool(targets)
                        if attachment.semantic_role
                        else attachment.anchor in model.nodes
                    )
                    if attachment.required and not present:
                        raise EntityVisualError(
                            f"required attachment anchor is missing from "
                            f"{contribution.base_model_key}: {attachment.anchor}"
                        )
                for effect in contribution.particle_effects:
                    targets = (
                        model.semantic_roles.get(effect.anchor, ())
                        if effect.semantic_role
                        else ()
                    )
                    present = (
                        bool(targets) if effect.semantic_role else effect.anchor in model.nodes
                    )
                    if effect.required and not present:
                        raise EntityVisualError(
                            f"required particle anchor is missing from "
                            f"{contribution.base_model_key}: {effect.anchor}"
                        )
            self._rules[rule.key] = rule

    def _diagnose(self, message: str) -> None:
        if message not in self.diagnostics:
            self.diagnostics.append(message)

    def resolve(self, entity) -> dict[str, Any] | None:
        matches = [rule for rule in self._rules.values() if rule.predicate(entity)]
        render = (
            entity.get_component(Render3DComponent)
            if entity.has_component(Render3DComponent)
            else None
        )
        base_candidates: list[tuple[int, str, str]] = []
        if render is not None and render.asset_key:
            base_candidates.append((-10_000, "compat/render3d", render.asset_key))
        for rule in matches:
            if rule.contribution.base_model_key:
                base_candidates.append((rule.priority, rule.key, rule.contribution.base_model_key))
        if not base_candidates:
            return None
        base_priority, base_rule, base_key = max(base_candidates)
        tied_bases = [item for item in base_candidates if item[0] == base_priority]
        if len({item[2] for item in tied_bases}) > 1:
            self._diagnose(f"equal-priority base model conflict resolved by rule key: {base_rule}")
        model = require_model_registry(self.actor).models.get(base_key)
        roles = model.semantic_roles if model is not None else {}
        nodes = set(model.nodes) if model is not None else set()
        winners: dict[tuple[str, str], tuple[int, str, Any]] = {}

        def assign(target: str, field_name: str, value: Any, priority: int, key: str) -> None:
            if value is None:
                return
            slot = (target, field_name)
            old = winners.get(slot)
            candidate = (priority, key, value)
            if old is not None and old[0] == priority and old[2] != value:
                self._diagnose(
                    f"equal-priority patch conflict on {target}.{field_name} resolved by "
                    f"rule key: {max(old[1], key)}"
                )
            if old is None or candidate[:2] > old[:2]:
                winners[slot] = candidate

        if render is not None:
            assign("*", "color_multiply", render.color or None, -10_000, "compat/render3d")
            assign("*", "emissive", render.emissive or None, -10_000, "compat/render3d")
            assign("*", "opacity", render.opacity, -10_000, "compat/render3d")
            assign("*", "variant", render.variant_key or None, -10_000, "compat/render3d")

        attachments: dict[str, tuple[int, str, VisualAttachment, str]] = {}
        particle_effects: dict[str, tuple[int, str, VisualParticleEffect, str]] = {}
        for rule in matches:
            for patch in rule.contribution.patches:
                targets = roles.get(patch.target, ()) if patch.semantic_role else (patch.target,)
                targets = tuple(target for target in targets if target == "*" or target in nodes)
                if not targets:
                    self._diagnose(f"optional visual target missing for {rule.key}: {patch.target}")
                    continue
                for target in targets:
                    assign(target, "visible", patch.visible, rule.priority, rule.key)
                    assign(
                        target,
                        "transform",
                        _transform_view(patch.transform) if patch.transform else None,
                        rule.priority,
                        rule.key,
                    )
                    assign(target, "color_multiply", patch.color_multiply, rule.priority, rule.key)
                    assign(target, "emissive", patch.emissive, rule.priority, rule.key)
                    assign(target, "opacity", patch.opacity, rule.priority, rule.key)
                    assign(target, "variant", patch.variant, rule.priority, rule.key)
            for attachment in rule.contribution.attachments:
                anchors = (
                    roles.get(attachment.anchor, ())
                    if attachment.semantic_role
                    else (attachment.anchor,)
                )
                anchors = tuple(anchor for anchor in anchors if anchor == "*" or anchor in nodes)
                if not anchors:
                    self._diagnose(
                        f"optional attachment anchor missing for {rule.key}: {attachment.anchor}"
                    )
                    continue
                for anchor in anchors:
                    candidate = (rule.priority, rule.key, attachment, anchor)
                    old = attachments.get(attachment.key)
                    if old is None or candidate[:2] > old[:2]:
                        attachments[attachment.key] = candidate
            for effect in rule.contribution.particle_effects:
                anchors = roles.get(effect.anchor, ()) if effect.semantic_role else (effect.anchor,)
                anchors = tuple(anchor for anchor in anchors if anchor == "*" or anchor in nodes)
                if not anchors:
                    self._diagnose(
                        f"optional particle anchor missing for {rule.key}: {effect.anchor}"
                    )
                    continue
                for anchor in anchors:
                    candidate = (rule.priority, rule.key, effect, anchor)
                    old = particle_effects.get(effect.key)
                    if old is None or candidate[:2] > old[:2]:
                        particle_effects[effect.key] = candidate

        patch_views: dict[str, dict[str, Any]] = {}
        for (target, field_name), (_priority, _key, value) in sorted(winners.items()):
            patch_views.setdefault(target, {"target": target})[field_name] = value
        attachment_views = []
        for _attachment_key, (_priority, _rule_key, attachment, anchor) in sorted(
            attachments.items()
        ):
            attachment_views.append(
                {
                    "key": attachment.key,
                    "model_key": attachment.model_key,
                    "anchor": anchor,
                    "visible": attachment.visible,
                    "transform": _transform_view(attachment.transform),
                }
            )
        particle_views = []
        for _effect_key, (_priority, _rule_key, effect, anchor) in sorted(
            particle_effects.items()
        ):
            particle_views.append(
                {
                    "key": effect.key,
                    "anchor": anchor,
                    "preset": effect.preset,
                    "system": require_environment_effect_registry(
                        self.actor
                    ).particle_system_view(effect.preset),
                    "seed": effect.seed,
                    "count": effect.count,
                    "bounds": {
                        "x": effect.bounds[0],
                        "y": effect.bounds[1],
                        "z": effect.bounds[2],
                    },
                    "color": effect.color,
                    "size": effect.size,
                    "speed": effect.speed,
                    "opacity": effect.opacity,
                    "transform": _transform_view(effect.transform),
                }
            )
        return {
            "base_model_key": base_key,
            "semantic_roles": {key: list(value) for key, value in sorted(roles.items())},
            "node_patches": list(patch_views.values()),
            "attachments": attachment_views,
            "particle_effects": particle_views,
        }


def install_entity_visual_registry(actor) -> None:
    actor.entity_visual_registry = EntityVisualRegistry(actor)


def require_entity_visual_registry(actor) -> EntityVisualRegistry:
    registry = getattr(actor, "entity_visual_registry", None)
    if not isinstance(registry, EntityVisualRegistry):
        raise RuntimeError("bunnyland.3d entity visual registry is not installed")
    return registry


def register_entity_visuals(actor, owner: str, rules: Iterable[EntityVisualRule]) -> None:
    require_entity_visual_registry(actor).register(owner, rules)


__all__ = [
    "EntityVisualContribution",
    "EntityVisualError",
    "EntityVisualRegistry",
    "EntityVisualRule",
    "VisualAttachment",
    "VisualNodePatch",
    "VisualParticleEffect",
    "install_entity_visual_registry",
    "register_entity_visuals",
    "require_entity_visual_registry",
]
