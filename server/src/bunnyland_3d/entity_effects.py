"""Registered, timed visual effects attached to entities through ECS edges."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from hashlib import blake2b
from typing import Any

from bunnyland.core import parse_entity_id, replace_component, spawn_entity
from relics import Frequency, System

from .assets import ModelTransform
from .components import HasVisualEffect3D, VisualEffectInstance3DComponent
from .effects import require_environment_effect_registry

_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$")
_ROLE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class VisualEffectError(ValueError):
    """A visual-effect definition, rule, or application is invalid."""


@dataclass(frozen=True)
class VisualEffectParticleLayer:
    system_key: str
    count: int = 24
    bounds: tuple[float, float, float] = (0.4, 0.7, 0.4)
    color: str = "#ffffff"
    size: float = 0.08
    speed: float = 0.7
    opacity: float = 0.9
    transform: ModelTransform = field(default_factory=ModelTransform)


@dataclass(frozen=True)
class VisualEffectLightningLayer:
    color: str = "#ffffff"
    bolt_count: int = 3
    segment_count: int = 8
    radius: float = 0.5
    height: float = 1.2
    jitter: float = 0.12
    opacity: float = 0.8
    flicker_speed: float = 8.0
    transform: ModelTransform = field(default_factory=ModelTransform)


@dataclass(frozen=True)
class VisualEffectDefinition:
    key: str
    anchor_role: str = "entity-aura"
    particle_layers: tuple[VisualEffectParticleLayer, ...] = ()
    lightning_layers: tuple[VisualEffectLightningLayer, ...] = ()
    anchor_required: bool = False


@dataclass(frozen=True)
class VisualEffectStateRule:
    key: str
    component_type: type
    predicate: Callable[[Any], bool]
    effect_key: str


def _transform_view(transform: ModelTransform) -> dict[str, Any]:
    return {
        "scale": transform.scale,
        "rotation": list(transform.rotation),
        "translation": list(transform.translation),
    }


def _owned_key(owner: str, key: str, kind: str) -> None:
    prefix = f"{owner}/"
    if not _KEY.fullmatch(key) or not key.startswith(prefix):
        raise VisualEffectError(f"{kind} key must begin with {prefix!r}")


def _color(value: str, kind: str) -> None:
    if not _COLOR.fullmatch(value):
        raise VisualEffectError(f"{kind} color must be a six-digit hex color")


class VisualEffectRegistry:
    def __init__(self, actor) -> None:
        self.actor = actor
        self._definitions: dict[str, VisualEffectDefinition] = {}
        self._state_rules: dict[str, VisualEffectStateRule] = {}

    @property
    def definitions(self) -> dict[str, VisualEffectDefinition]:
        return dict(self._definitions)

    @property
    def state_rules(self) -> dict[str, VisualEffectStateRule]:
        return dict(self._state_rules)

    def register_definitions(
        self, owner: str, definitions: Iterable[VisualEffectDefinition]
    ) -> None:
        systems = require_environment_effect_registry(self.actor).particle_systems
        for definition in definitions:
            _owned_key(owner, definition.key, "visual effect")
            if definition.key in self._definitions:
                raise VisualEffectError(
                    f"visual effect is already registered: {definition.key}"
                )
            if not _ROLE.fullmatch(definition.anchor_role):
                raise VisualEffectError("visual effect anchor_role is invalid")
            if not definition.particle_layers and not definition.lightning_layers:
                raise VisualEffectError("visual effect must contain at least one layer")
            for layer in definition.particle_layers:
                if layer.system_key not in systems:
                    raise VisualEffectError(
                        f"unknown particle system: {layer.system_key}"
                    )
                if layer.count <= 0:
                    raise VisualEffectError("visual effect particle count must be positive")
                if any(value <= 0 for value in layer.bounds):
                    raise VisualEffectError("visual effect particle bounds must be positive")
                _color(layer.color, "visual effect particle")
                if layer.size <= 0 or layer.speed < 0 or not 0 <= layer.opacity <= 1:
                    raise VisualEffectError("visual effect particle layer is invalid")
            for layer in definition.lightning_layers:
                _color(layer.color, "visual effect lightning")
                if (
                    layer.bolt_count <= 0
                    or layer.segment_count < 2
                    or layer.radius <= 0
                    or layer.height <= 0
                    or layer.jitter < 0
                    or not 0 <= layer.opacity <= 1
                    or layer.flicker_speed < 0
                ):
                    raise VisualEffectError("visual effect lightning layer is invalid")
            self._definitions[definition.key] = definition

    def register_state_rules(
        self, owner: str, rules: Iterable[VisualEffectStateRule]
    ) -> None:
        for rule in rules:
            _owned_key(owner, rule.key, "visual effect state rule")
            if rule.key in self._state_rules:
                raise VisualEffectError(
                    f"visual effect state rule is already registered: {rule.key}"
                )
            if rule.effect_key not in self._definitions:
                raise VisualEffectError(f"unknown visual effect: {rule.effect_key}")
            self._state_rules[rule.key] = rule

    def view(self, instance: VisualEffectInstance3DComponent) -> dict[str, Any] | None:
        definition = self._definitions.get(instance.effect_key)
        if definition is None:
            return None
        environment = require_environment_effect_registry(self.actor)
        return {
            "key": definition.key,
            "remaining_seconds": instance.remaining_seconds,
            "source_key": instance.source_key,
            "state_rule_key": instance.state_rule_key,
            "seed": instance.seed,
            "anchor_role": definition.anchor_role,
            "anchor_required": definition.anchor_required,
            "particle_layers": [
                {
                    "system_key": layer.system_key,
                    "system": environment.particle_system_view(layer.system_key),
                    "count": layer.count,
                    "bounds": {
                        "x": layer.bounds[0],
                        "y": layer.bounds[1],
                        "z": layer.bounds[2],
                    },
                    "color": layer.color,
                    "size": layer.size,
                    "speed": layer.speed,
                    "opacity": layer.opacity,
                    "transform": _transform_view(layer.transform),
                }
                for layer in definition.particle_layers
            ],
            "lightning_layers": [
                {
                    "color": layer.color,
                    "bolt_count": layer.bolt_count,
                    "segment_count": layer.segment_count,
                    "radius": layer.radius,
                    "height": layer.height,
                    "jitter": layer.jitter,
                    "opacity": layer.opacity,
                    "flicker_speed": layer.flicker_speed,
                    "transform": _transform_view(layer.transform),
                }
                for layer in definition.lightning_layers
            ],
        }


def _seed(target_id, effect_key: str, source_key: str) -> int:
    value = f"{target_id}:{effect_key}:{source_key}".encode()
    return int.from_bytes(blake2b(value, digest_size=4).digest(), "big") & 0x7FFFFFFF


def _target(actor, target_id):
    parsed = parse_entity_id(target_id)
    if parsed is None or not actor.world.has_entity(parsed):
        raise VisualEffectError(f"visual effect target does not exist: {target_id}")
    return actor.world.get_entity(parsed)


def _matching_instance(actor, target, effect_key: str, source_key: str):
    for _edge, instance_id in target.get_relationships(HasVisualEffect3D):
        if not actor.world.has_entity(instance_id):
            continue
        instance_entity = actor.world.get_entity(instance_id)
        if not instance_entity.has_component(VisualEffectInstance3DComponent):
            continue
        instance = instance_entity.get_component(VisualEffectInstance3DComponent)
        if instance.effect_key == effect_key and instance.source_key == source_key:
            return instance_entity, instance
    return None


def _apply_visual_effect(
    actor,
    target_id,
    effect_key: str,
    duration_seconds: float,
    source_key: str,
    state_rule_key: str,
):
    registry = require_visual_effect_registry(actor)
    if effect_key not in registry.definitions:
        raise VisualEffectError(f"unknown visual effect: {effect_key}")
    if duration_seconds != -1 and duration_seconds < 0:
        raise VisualEffectError("duration_seconds must be -1 or nonnegative")
    target = _target(actor, target_id)
    existing = _matching_instance(actor, target, effect_key, source_key)
    if existing is not None:
        entity, instance = existing
        replace_component(
            entity,
            replace(
                instance,
                remaining_seconds=float(duration_seconds),
                state_rule_key=state_rule_key,
            ),
        )
        return entity
    instance = spawn_entity(
        actor.world,
        [
            VisualEffectInstance3DComponent(
                effect_key=effect_key,
                remaining_seconds=float(duration_seconds),
                source_key=source_key,
                state_rule_key=state_rule_key,
                seed=_seed(target.id, effect_key, source_key),
            )
        ],
    )
    target.add_relationship(HasVisualEffect3D(), instance.id)
    return instance


def apply_visual_effect(
    actor,
    target_id,
    effect_key: str,
    duration_seconds: float,
    source_key: str = "",
):
    return _apply_visual_effect(
        actor, target_id, effect_key, duration_seconds, source_key, ""
    )


def remove_visual_effect(
    actor, target_id, effect_key: str, source_key: str = ""
) -> bool:
    target = _target(actor, target_id)
    existing = _matching_instance(actor, target, effect_key, source_key)
    if existing is None:
        return False
    entity, _instance = existing
    actor.world.remove(entity.id)
    return True


class VisualEffectSystem(System):
    """Materialize state effects and expire finite effect instances."""

    def __init__(self, actor) -> None:
        super().__init__()
        self.actor = actor

    def query(self):
        return self.q

    def frequency(self) -> Frequency:
        return Frequency.EVERY_TICK

    def process(self, entities, components, delta) -> None:
        del entities, components
        registry = require_visual_effect_registry(self.actor)
        active_rules: set[tuple[object, str]] = set()
        for rule in registry.state_rules.values():
            for target in list(
                self.world.query().with_all([rule.component_type]).execute_entities()
            ):
                if not rule.predicate(target):
                    continue
                active_rules.add((target.id, rule.key))
                existing = _matching_instance(
                    self.actor, target, rule.effect_key, rule.key
                )
                if existing is None or existing[1].state_rule_key != rule.key:
                    _apply_visual_effect(
                        self.actor,
                        target.id,
                        rule.effect_key,
                        -1,
                        rule.key,
                        rule.key,
                    )

        for effect_entity in list(
            self.world.query()
            .with_all([VisualEffectInstance3DComponent])
            .execute_entities()
        ):
            incoming = effect_entity.get_incoming_relationships(HasVisualEffect3D)
            instance = effect_entity.get_component(VisualEffectInstance3DComponent)
            if len(incoming) != 1:
                self.world.remove(effect_entity.id)
                continue
            target_id, _edge = incoming[0]
            if instance.state_rule_key and (
                target_id, instance.state_rule_key
            ) not in active_rules:
                self.world.remove(effect_entity.id)
                continue
            if instance.remaining_seconds == -1:
                continue
            remaining = max(0.0, instance.remaining_seconds - float(delta))
            if remaining == 0:
                self.world.remove(effect_entity.id)
            else:
                replace_component(
                    effect_entity, replace(instance, remaining_seconds=remaining)
                )


def install_visual_effect_registry(actor) -> None:
    actor.visual_effect_registry_3d = VisualEffectRegistry(actor)
    actor.world.register_system(VisualEffectSystem(actor))


def require_visual_effect_registry(actor) -> VisualEffectRegistry:
    registry = getattr(actor, "visual_effect_registry_3d", None)
    if not isinstance(registry, VisualEffectRegistry):
        raise RuntimeError("bunnyland.3d visual effect registry is not installed")
    return registry


def register_visual_effects(
    actor, owner: str, definitions: Iterable[VisualEffectDefinition]
) -> None:
    require_visual_effect_registry(actor).register_definitions(owner, definitions)


def register_visual_effect_state_rules(
    actor, owner: str, rules: Iterable[VisualEffectStateRule]
) -> None:
    require_visual_effect_registry(actor).register_state_rules(owner, rules)


def entity_effect_views(actor, entity) -> list[dict[str, Any]]:
    registry = require_visual_effect_registry(actor)
    views = []
    for _edge, instance_id in entity.get_relationships(HasVisualEffect3D):
        if not actor.world.has_entity(instance_id):
            continue
        effect_entity = actor.world.get_entity(instance_id)
        if not effect_entity.has_component(VisualEffectInstance3DComponent):
            continue
        view = registry.view(
            effect_entity.get_component(VisualEffectInstance3DComponent)
        )
        if view is not None:
            views.append(view)
    return sorted(
        views,
        key=lambda item: (item["key"], item["source_key"], item["seed"]),
    )


__all__ = [
    "VisualEffectDefinition",
    "VisualEffectError",
    "VisualEffectLightningLayer",
    "VisualEffectParticleLayer",
    "VisualEffectRegistry",
    "VisualEffectStateRule",
    "VisualEffectSystem",
    "apply_visual_effect",
    "entity_effect_views",
    "install_visual_effect_registry",
    "register_visual_effect_state_rules",
    "register_visual_effects",
    "remove_visual_effect",
    "require_visual_effect_registry",
]
