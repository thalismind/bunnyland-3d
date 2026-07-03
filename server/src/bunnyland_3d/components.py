"""3D ECS components contributed by the out-of-tree Bunnyland 3D plugin."""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic.dataclasses import dataclass
from relics import Component


@dataclass(frozen=True)
class Vector3:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

    def add(self, other: "Vector3") -> "Vector3":
        return Vector3(self.x + other.x, self.y + other.y, self.z + other.z)

    def scale_by(self, value: float) -> "Vector3":
        return Vector3(self.x * value, self.y * value, self.z * value)

    def with_axis(self, axis: str, value: float) -> "Vector3":
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


@dataclass(frozen=True)
class RoomBounds3DComponent(Component):
    """Axis-aligned room bounds for 3D movement."""

    size: Vector3 = Vector3(16.0, 4.0, 16.0)
    origin: Vector3 = Vector3()


__all__ = [
    "Collider3DComponent",
    "Render3DComponent",
    "RoomBounds3DComponent",
    "Transform3DComponent",
    "Vector3",
    "Velocity3DComponent",
]
