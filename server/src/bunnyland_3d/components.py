"""3D ECS components contributed by the out-of-tree Bunnyland 3D plugin."""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic.dataclasses import dataclass
from relics import Component, Edge


@dataclass(frozen=True)
class Vector3:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

    def add(self, other: Vector3) -> Vector3:
        return Vector3(self.x + other.x, self.y + other.y, self.z + other.z)

    def scale_by(self, value: float) -> Vector3:
        return Vector3(self.x * value, self.y * value, self.z * value)

    def with_axis(self, axis: str, value: float) -> Vector3:
        if axis == "x":
            return Vector3(value, self.y, self.z)
        if axis == "y":
            return Vector3(self.x, value, self.z)
        if axis == "z":
            return Vector3(self.x, self.y, value)
        raise ValueError(f"unknown axis {axis!r}")


@dataclass(frozen=True)
class Transform3DComponent(Component):
    """Authoritative local transform within the containing room's 3D coordinate space."""

    position: Vector3 = Vector3()
    rotation: Vector3 = Vector3()
    scale: Vector3 = Vector3(1.0, 1.0, 1.0)


@dataclass(frozen=True)
class Velocity3DComponent(Component):
    """Linear and angular velocity in room-local units per second."""

    linear: Vector3 = Vector3()
    angular: Vector3 = Vector3()
    max_speed: float = 12.0


@dataclass(frozen=True)
class Collider3DComponent(Component):
    """Collision volume for 3D movement.

    A box uses ``size``. A sphere uses ``radius``. Capsules are approximated as boxes for
    this first plugin slice so the collision system remains deterministic and simple.
    """

    shape: Literal["box", "sphere", "capsule"] = "box"
    size: Vector3 = Vector3(1.0, 1.0, 1.0)
    radius: float = 0.5
    solid: bool = True
    static: bool = False
    trigger: bool = False


@dataclass(frozen=True)
class Render3DComponent(Component):
    """Client-facing 3D render hints."""

    shape: Literal["box", "sphere", "capsule", "billboard"] = "box"
    color: str = Field(default="#cdd6f4", pattern=r"^#[0-9a-fA-F]{6}$")
    emissive: str = Field(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    label: str = ""
    visible: bool = True
    asset_key: str = Field(
        default="",
        max_length=80,
        pattern=r"^$|^[a-z0-9][a-z0-9._/-]*$",
    )
    variant_key: str = Field(
        default="",
        max_length=80,
        pattern=r"^$|^[a-z0-9][a-z0-9._/-]*$",
    )


@dataclass(frozen=True)
class RoomBounds3DComponent(Component):
    """Axis-aligned room bounds for 3D movement."""

    size: Vector3 = Vector3(16.0, 4.0, 16.0)
    origin: Vector3 = Vector3()


@dataclass(frozen=True)
class Environment3DComponent(Component):
    """Outdoor room atmosphere and optional surface media overrides."""

    sky_color: str = Field(default="#9bc7e8", pattern=r"^#[0-9a-fA-F]{6}$")
    fog_color: str = Field(default="#789c86", pattern=r"^#[0-9a-fA-F]{6}$")
    fog_density: float = Field(default=0.012, ge=0.0, le=0.2)
    ambient_color: str = Field(default="#d8efff", pattern=r"^#[0-9a-fA-F]{6}$")
    ambient_intensity: float = Field(default=1.5, ge=0.0, le=8.0)
    sun_color: str = Field(default="#fff1d2", pattern=r"^#[0-9a-fA-F]{6}$")
    sun_intensity: float = Field(default=2.0, ge=0.0, le=8.0)
    has_roof: bool = False
    skybox_preset: str = Field(
        default="bunnyland.3d/default",
        pattern=r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$",
    )
    surface_recipe: str = Field(default="meadow", pattern=r"^[a-z0-9][a-z0-9._-]*$")
    albedo_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")
    normal_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")
    skybox_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")
    texture_scale: float = Field(default=4.0, ge=0.25, le=32.0)


@dataclass(frozen=True)
class BiomeStyle3DComponent(Component):
    """Persistent uploaded texture defaults for one biome."""

    biome: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    albedo_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")
    normal_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")
    skybox_url: str = Field(default="", pattern=r"^$|^/media/[a-z0-9]+/[a-z0-9]+\.(png|jpg|webp)$")


@dataclass(frozen=True)
class PropInstanceOverride:
    """A manual adjustment to one stable generated instance."""

    instance_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]*$")
    position: Vector3 | None = None
    rotation_y: float | None = None
    scale: float | None = Field(default=None, ge=0.05, le=8.0)


@dataclass(frozen=True)
class PropGroup3DComponent(Component):
    """One ECS entity representing many static, noninteractive prop instances."""

    recipe_key: str = Field(pattern=r"^[a-z0-9][a-z0-9._/-]*$")
    seed: int = Field(ge=0, le=2**31 - 1)
    asset_key: str = Field(pattern=r"^[a-z0-9][a-z0-9._/-]*$")
    count: int = Field(default=24, ge=0, le=2000)
    color: str = Field(default="#7ca85c", pattern=r"^#[0-9a-fA-F]{6}$")
    min_scale: float = Field(default=0.5, ge=0.05, le=8.0)
    max_scale: float = Field(default=1.2, ge=0.05, le=8.0)
    margin: float = Field(default=0.6, ge=0.0, le=8.0)
    excluded_instance_ids: tuple[str, ...] = ()
    overrides: tuple[PropInstanceOverride, ...] = ()


@dataclass(frozen=True)
class Light3DComponent(Component):
    """A projected local light; transform position comes from Transform3DComponent."""

    kind: Literal["point", "spot", "directional"] = "point"
    color: str = Field(default="#ffd38a", pattern=r"^#[0-9a-fA-F]{6}$")
    intensity: float = Field(default=2.0, ge=0.0, le=20.0)
    range: float = Field(default=7.0, ge=0.1, le=100.0)
    decay: float = Field(default=2.0, ge=0.0, le=4.0)
    cone: float = Field(default=0.7, ge=0.05, le=1.5)
    cast_shadow: bool = False


@dataclass(frozen=True)
class ParticleEmitter3DComponent(Component):
    """A bounded, deterministic ambient particle field."""

    preset: str = Field(
        default="pollen",
        pattern=r"^(pollen|fireflies|spores|dust|mist|fire|[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*)$",
    )
    seed: int = Field(ge=0, le=2**31 - 1)
    count: int = Field(default=100, ge=0, le=1500)
    bounds: Vector3 = Vector3(14.0, 4.0, 14.0)
    color: str = Field(default="#f6e9a6", pattern=r"^#[0-9a-fA-F]{6}$")
    size: float = Field(default=0.08, ge=0.01, le=2.0)
    speed: float = Field(default=0.2, ge=0.0, le=5.0)
    opacity: float = Field(default=0.65, ge=0.0, le=1.0)


@dataclass(frozen=True)
class DecorationSource3DComponent(Component):
    """Ownership marker for idempotent recipe-managed presentation entities."""

    room_id: str
    recipe_key: str
    role: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$")
    recipe_version: int = Field(default=1, ge=1)


@dataclass(frozen=True)
class HasDecoration3D(Edge):
    """Presentation-only room-to-decoration relationship."""

    role: str = Field(
        default="bunnyland.3d/detail",
        pattern=r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$",
    )


@dataclass(frozen=True)
class VisualEffectInstance3DComponent(Component):
    """One active registered visual effect, stored on its own ECS entity."""

    effect_key: str = Field(
        pattern=r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$"
    )
    remaining_seconds: float = -1.0
    source_key: str = ""
    state_rule_key: str = ""
    seed: int = Field(ge=0, le=2**31 - 1)

    def __post_init__(self) -> None:
        if self.remaining_seconds != -1 and self.remaining_seconds < 0:
            raise ValueError("remaining_seconds must be -1 or nonnegative")


@dataclass(frozen=True)
class HasVisualEffect3D(Edge):
    """Affected-entity to active-effect-instance relationship."""


__all__ = [
    "Collider3DComponent",
    "BiomeStyle3DComponent",
    "DecorationSource3DComponent",
    "Environment3DComponent",
    "HasDecoration3D",
    "HasVisualEffect3D",
    "Light3DComponent",
    "ParticleEmitter3DComponent",
    "PropGroup3DComponent",
    "PropInstanceOverride",
    "Render3DComponent",
    "RoomBounds3DComponent",
    "Transform3DComponent",
    "Vector3",
    "Velocity3DComponent",
    "VisualEffectInstance3DComponent",
]
