"""Plugin-facing registries for declarative skyboxes and particle systems."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from hashlib import blake2b
from typing import Literal

_EFFECT_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class EnvironmentEffectError(ValueError):
    """A skybox or particle-system registration is invalid."""


@dataclass(frozen=True)
class Skybox3D:
    """A bounded, procedural skybox style rendered by the stock 3D client."""

    key: str
    zenith_color: str = ""
    sky_color: str = ""
    horizon_color: str = "#ffe2b8"
    horizon_mix: float = 0.32
    sun_color: str = "#fff5da"
    sun_x: float = 0.765
    sun_y: float = 0.28
    sun_size: float = 0.035
    sun_opacity: float = 0.76
    cloud_color: str = "#ffffff"
    cloud_opacity: float = 0.12
    cloud_count: int = 18
    star_color: str = "#ffffff"
    star_opacity: float = 0.0
    star_count: int = 0


@dataclass(frozen=True)
class ParticleSystem3D:
    """Client-safe particle motion and material parameters."""

    key: str
    blending: Literal["normal", "additive"] = "normal"
    vertical_motion: Literal["rise", "fall", "drift"] = "rise"
    vertical_scale: float = 1.0
    lateral_wobble: float = 0.08
    pulse_amount: float = 0.0
    pulse_speed: float = 2.4


@dataclass(frozen=True)
class RoomSkyboxRule:
    """Select a registered skybox for matching rooms at projection time."""

    key: str
    skybox_key: str
    room_predicate: Callable[[object, object], bool]
    priority: int = 0


@dataclass(frozen=True)
class RoomParticleRule:
    """Replace the core ambient particle field in matching rooms."""

    key: str
    system_key: str
    room_predicate: Callable[[object, object], bool]
    priority: int = 0
    count: int = 80
    height: float = 4.0
    margin: float = 1.0
    color: str = "#f6e9a6"
    size: float = 0.08
    speed: float = 0.2
    opacity: float = 0.65


def _validate_key(owner: str, key: str) -> None:
    prefix = f"{owner}/"
    if not _EFFECT_KEY.fullmatch(key) or not key.startswith(prefix):
        raise EnvironmentEffectError(f"effect key must begin with {prefix!r}")


def _validate_color(name: str, value: str, *, optional: bool = False) -> None:
    if (not value and optional) or _COLOR.fullmatch(value):
        return
    raise EnvironmentEffectError(f"{name} must be a six-digit hex color")


class EnvironmentEffectRegistry:
    def __init__(self) -> None:
        self._skyboxes: dict[str, Skybox3D] = {}
        self._particle_systems: dict[str, ParticleSystem3D] = {}
        self._skybox_rules: dict[str, RoomSkyboxRule] = {}
        self._particle_rules: dict[str, RoomParticleRule] = {}
        self.diagnostics: list[str] = []

    @property
    def skyboxes(self) -> dict[str, Skybox3D]:
        return dict(self._skyboxes)

    @property
    def particle_systems(self) -> dict[str, ParticleSystem3D]:
        return dict(self._particle_systems)

    @property
    def skybox_rules(self) -> dict[str, RoomSkyboxRule]:
        return dict(self._skybox_rules)

    @property
    def particle_rules(self) -> dict[str, RoomParticleRule]:
        return dict(self._particle_rules)

    def register_skyboxes(self, owner: str, skyboxes: tuple[Skybox3D, ...]) -> None:
        for skybox in skyboxes:
            _validate_key(owner, skybox.key)
            if skybox.key in self._skyboxes:
                raise EnvironmentEffectError(f"skybox is already registered: {skybox.key}")
            _validate_color("zenith_color", skybox.zenith_color, optional=True)
            _validate_color("sky_color", skybox.sky_color, optional=True)
            for name in ("horizon_color", "sun_color", "cloud_color", "star_color"):
                _validate_color(name, getattr(skybox, name))
            if not 0.0 <= skybox.horizon_mix <= 1.0:
                raise EnvironmentEffectError("skybox horizon_mix must be between 0 and 1")
            if not 0.0 <= skybox.sun_x <= 1.0 or not 0.0 <= skybox.sun_y <= 1.0:
                raise EnvironmentEffectError("skybox sun position must be between 0 and 1")
            if not 0.0 <= skybox.sun_size <= 0.5:
                raise EnvironmentEffectError("skybox sun_size must be between 0 and 0.5")
            if not 0.0 <= skybox.sun_opacity <= 1.0:
                raise EnvironmentEffectError("skybox sun_opacity must be between 0 and 1")
            if not 0.0 <= skybox.cloud_opacity <= 1.0:
                raise EnvironmentEffectError("skybox cloud_opacity must be between 0 and 1")
            if not 0 <= skybox.cloud_count <= 128:
                raise EnvironmentEffectError("skybox cloud_count must be between 0 and 128")
            if not 0.0 <= skybox.star_opacity <= 1.0:
                raise EnvironmentEffectError("skybox star_opacity must be between 0 and 1")
            if not 0 <= skybox.star_count <= 512:
                raise EnvironmentEffectError("skybox star_count must be between 0 and 512")
            self._skyboxes[skybox.key] = skybox

    def register_particle_systems(
        self, owner: str, systems: tuple[ParticleSystem3D, ...]
    ) -> None:
        for system in systems:
            _validate_key(owner, system.key)
            if system.key in self._particle_systems:
                raise EnvironmentEffectError(
                    f"particle system is already registered: {system.key}"
                )
            if not 0.0 <= system.vertical_scale <= 4.0:
                raise EnvironmentEffectError(
                    "particle vertical_scale must be between 0 and 4"
                )
            if not 0.0 <= system.lateral_wobble <= 2.0:
                raise EnvironmentEffectError(
                    "particle lateral_wobble must be between 0 and 2"
                )
            if not 0.0 <= system.pulse_amount <= 1.0:
                raise EnvironmentEffectError("particle pulse_amount must be between 0 and 1")
            if not 0.0 <= system.pulse_speed <= 20.0:
                raise EnvironmentEffectError("particle pulse_speed must be between 0 and 20")
            self._particle_systems[system.key] = system

    def register_skybox_rules(
        self, owner: str, rules: tuple[RoomSkyboxRule, ...]
    ) -> None:
        for rule in rules:
            _validate_key(owner, rule.key)
            if rule.key in self._skybox_rules:
                raise EnvironmentEffectError(
                    f"skybox rule is already registered: {rule.key}"
                )
            if rule.skybox_key not in self._skyboxes:
                raise EnvironmentEffectError(f"unknown skybox: {rule.skybox_key}")
            self._skybox_rules[rule.key] = rule

    def register_particle_rules(
        self, owner: str, rules: tuple[RoomParticleRule, ...]
    ) -> None:
        for rule in rules:
            _validate_key(owner, rule.key)
            if rule.key in self._particle_rules:
                raise EnvironmentEffectError(
                    f"particle rule is already registered: {rule.key}"
                )
            if rule.system_key not in self._particle_systems:
                raise EnvironmentEffectError(
                    f"unknown particle system: {rule.system_key}"
                )
            if not 0 <= rule.count <= 1500:
                raise EnvironmentEffectError("particle rule count must be between 0 and 1500")
            if not 0.1 <= rule.height <= 100.0:
                raise EnvironmentEffectError("particle rule height must be between 0.1 and 100")
            if not 0.0 <= rule.margin <= 8.0:
                raise EnvironmentEffectError("particle rule margin must be between 0 and 8")
            _validate_color("particle rule color", rule.color)
            if not 0.01 <= rule.size <= 2.0:
                raise EnvironmentEffectError("particle rule size must be between 0.01 and 2")
            if not 0.0 <= rule.speed <= 5.0:
                raise EnvironmentEffectError("particle rule speed must be between 0 and 5")
            if not 0.0 <= rule.opacity <= 1.0:
                raise EnvironmentEffectError("particle rule opacity must be between 0 and 1")
            self._particle_rules[rule.key] = rule

    def room_skybox_view(
        self, world, room, configured_key: str
    ) -> dict | None:
        if configured_key != "bunnyland.3d/default":
            return self.skybox_view(configured_key)
        matches = [
            rule
            for rule in self._skybox_rules.values()
            if rule.room_predicate(world, room)
        ]
        if not matches:
            return None
        return self.skybox_view(max(matches, key=lambda rule: (rule.priority, rule.key)).skybox_key)

    def room_particle_view(self, world, room, bounds) -> dict | None:
        matches = [
            rule
            for rule in self._particle_rules.values()
            if rule.room_predicate(world, room)
        ]
        if not matches:
            return None
        rule = max(matches, key=lambda item: (item.priority, item.key))
        width = max(1.0, bounds.size.x - rule.margin * 2)
        depth = max(1.0, bounds.size.z - rule.margin * 2)
        seed = int.from_bytes(
            blake2b(f"{room.id}:{rule.key}".encode(), digest_size=4).digest(), "big"
        ) & 0x7FFFFFFF
        return {
            "id": f"effect:{rule.key}",
            "transform3d": {
                "position": {
                    "x": bounds.origin.x + bounds.size.x / 2,
                    "y": bounds.origin.y,
                    "z": bounds.origin.z + bounds.size.z / 2,
                }
            },
            "particle_emitter3d": {
                "preset": rule.system_key,
                "system": self.particle_system_view(rule.system_key),
                "seed": seed,
                "count": rule.count,
                "bounds": {"x": width, "y": rule.height, "z": depth},
                "color": rule.color,
                "size": rule.size,
                "speed": rule.speed,
                "opacity": rule.opacity,
            },
            "decoration_source3d": {
                "recipe_key": rule.key,
                "recipe_version": 1,
                "role": rule.key,
            },
        }

    def skybox_view(self, key: str) -> dict:
        return asdict(self._resolve_skybox(key))

    def particle_system_view(self, key: str) -> dict:
        return asdict(self._resolve_particle_system(key))

    def _diagnose(self, message: str) -> None:
        if message not in self.diagnostics:
            self.diagnostics.append(message)

    def _resolve_skybox(self, key: str) -> Skybox3D:
        skybox = self._skyboxes.get(key)
        if skybox is not None:
            return skybox
        self._diagnose(f"unknown skybox {key!r}; using bunnyland.3d/default")
        return self._skyboxes["bunnyland.3d/default"]

    def _resolve_particle_system(self, key: str) -> ParticleSystem3D:
        aliases = {
            "pollen": "bunnyland.3d/pollen",
            "fireflies": "bunnyland.3d/fireflies",
            "spores": "bunnyland.3d/spores",
            "dust": "bunnyland.3d/dust",
            "mist": "bunnyland.3d/mist",
            "fire": "bunnyland.3d/fire",
        }
        resolved = aliases.get(key, key)
        system = self._particle_systems.get(resolved)
        if system is not None:
            return system
        self._diagnose(f"unknown particle system {key!r}; using bunnyland.3d/pollen")
        return self._particle_systems["bunnyland.3d/pollen"]


def install_environment_effect_registry(actor) -> None:
    registry = EnvironmentEffectRegistry()
    actor.environment_effect_registry_3d = registry
    registry.register_skyboxes("bunnyland.3d", (Skybox3D("bunnyland.3d/default"),))
    registry.register_particle_systems(
        "bunnyland.3d",
        (
            ParticleSystem3D("bunnyland.3d/pollen", vertical_scale=0.55),
            ParticleSystem3D("bunnyland.3d/spores", vertical_scale=0.55),
            ParticleSystem3D(
                "bunnyland.3d/fireflies",
                blending="additive",
                vertical_motion="drift",
                vertical_scale=0.55,
                pulse_amount=0.4,
            ),
            ParticleSystem3D(
                "bunnyland.3d/dust", vertical_motion="drift", vertical_scale=0.18
            ),
            ParticleSystem3D(
                "bunnyland.3d/mist",
                vertical_motion="drift",
                vertical_scale=0.55,
                lateral_wobble=0.025,
            ),
            ParticleSystem3D(
                "bunnyland.3d/fire",
                blending="additive",
                vertical_scale=0.55,
                lateral_wobble=0.08,
            ),
        ),
    )


def require_environment_effect_registry(actor) -> EnvironmentEffectRegistry:
    registry = getattr(actor, "environment_effect_registry_3d", None)
    if not isinstance(registry, EnvironmentEffectRegistry):
        raise RuntimeError("bunnyland.3d environment effect registry is not installed")
    return registry


def register_skyboxes(actor, owner: str, skyboxes: Iterable[Skybox3D]) -> None:
    require_environment_effect_registry(actor).register_skyboxes(owner, tuple(skyboxes))


def register_particle_systems(
    actor, owner: str, systems: Iterable[ParticleSystem3D]
) -> None:
    require_environment_effect_registry(actor).register_particle_systems(owner, tuple(systems))


def register_skybox_rules(
    actor, owner: str, rules: Iterable[RoomSkyboxRule]
) -> None:
    require_environment_effect_registry(actor).register_skybox_rules(owner, tuple(rules))


def register_particle_rules(
    actor, owner: str, rules: Iterable[RoomParticleRule]
) -> None:
    require_environment_effect_registry(actor).register_particle_rules(owner, tuple(rules))


__all__ = [
    "EnvironmentEffectError",
    "EnvironmentEffectRegistry",
    "ParticleSystem3D",
    "RoomParticleRule",
    "RoomSkyboxRule",
    "Skybox3D",
    "install_environment_effect_registry",
    "register_particle_systems",
    "register_particle_rules",
    "register_skybox_rules",
    "register_skyboxes",
    "require_environment_effect_registry",
]
