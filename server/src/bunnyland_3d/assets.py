"""Plugin-facing registry for server-hosted 3D model assets."""

from __future__ import annotations

import json
import re
import shlex
import struct
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from bunnyland.foundation.media import MediaService, require_media_service

MODEL_NAMESPACE = "models3d"
_SUPPORTED_EXTENSIONS = frozenset({".glb", ".gltf", ".obj", ".stl"})
_ASSET_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)+$")


class ModelAssetError(ValueError):
    """A model registration or conversion is invalid."""


@dataclass(frozen=True)
class ModelTransform:
    scale: float = 1.0
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    translation: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class AssetSource:
    """A model path constrained to a plugin-owned root."""

    root: str | Path
    path: str | Path

    def resolve(self) -> Path:
        root = Path(self.root).resolve()
        candidate = (root / self.path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ModelAssetError("model source escapes its declared root") from exc
        if not candidate.is_file():
            raise ModelAssetError(f"model source does not exist: {self.path}")
        return candidate


@dataclass(frozen=True)
class ModelAsset:
    key: str
    source: AssetSource
    transform: ModelTransform = field(default_factory=ModelTransform)
    clips: dict[str, str] = field(default_factory=dict)
    variants: tuple[str, ...] = ()
    default_color: str = ""
    instanced: bool = False
    license: str = ""
    attribution: str = ""


@dataclass(frozen=True)
class RegisteredModel:
    asset: ModelAsset
    url: str
    digest: str


ModelImporter = Callable[[Path, ModelAsset], bytes]


def _validate_glb(path: Path, _asset: ModelAsset) -> bytes:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise ModelAssetError(f"invalid GLB header: {path.name}")
    version, length = struct.unpack_from("<II", data, 4)
    if version != 2 or length != len(data):
        raise ModelAssetError(f"invalid GLB container: {path.name}")
    cursor = 12
    chunks = []
    while cursor < len(data):
        if cursor + 8 > len(data):
            raise ModelAssetError(f"invalid GLB chunk table: {path.name}")
        chunk_length, chunk_type = struct.unpack_from("<II", data, cursor)
        cursor += 8
        if cursor + chunk_length > len(data):
            raise ModelAssetError(f"invalid GLB chunk length: {path.name}")
        chunks.append((chunk_type, data[cursor : cursor + chunk_length]))
        cursor += chunk_length
    if not chunks or chunks[0][0] != 0x4E4F534A:
        raise ModelAssetError(f"GLB has no JSON document: {path.name}")
    try:
        json.loads(chunks[0][1].decode("utf-8").rstrip(" \0"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModelAssetError(f"invalid GLB JSON document: {path.name}") from exc
    return data


def _sidecar(path: Path, asset: ModelAsset, reference: str) -> Path:
    parsed = urlparse(reference)
    if parsed.scheme or parsed.netloc:
        raise ModelAssetError(f"model sidecar must be a local file: {reference}")
    candidate = (path.parent / unquote(parsed.path)).resolve()
    root = Path(asset.source.root).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ModelAssetError(f"model sidecar escapes its declared root: {reference}") from exc
    if not candidate.is_file():
        raise ModelAssetError(f"model sidecar does not exist: {reference}")
    return candidate


def _validate_sidecars(path: Path, asset: ModelAsset) -> None:
    if path.suffix.lower() == ".gltf":
        try:
            document = json.loads(path.read_text())
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ModelAssetError(f"invalid glTF document: {path.name}") from exc
        for collection in (document.get("buffers", ()), document.get("images", ())):
            for item in collection:
                reference = item.get("uri", "")
                if reference and not reference.startswith("data:"):
                    _sidecar(path, asset, reference)
        return
    if path.suffix.lower() != ".obj":
        return
    material_paths = []
    for line in path.read_text(errors="replace").splitlines():
        tokens = shlex.split(line, comments=True)
        if tokens and tokens[0].lower() == "mtllib":
            material_paths.extend(_sidecar(path, asset, value) for value in tokens[1:])
    for material_path in material_paths:
        for line in material_path.read_text(errors="replace").splitlines():
            tokens = shlex.split(line, comments=True)
            if tokens and (tokens[0].lower().startswith("map_") or tokens[0].lower() == "bump"):
                _sidecar(material_path, asset, tokens[-1])


def _trimesh_import(path: Path, asset: ModelAsset) -> bytes:
    try:
        import trimesh
    except ImportError as exc:  # pragma: no cover - dependency failure is installation-specific
        raise ModelAssetError("model conversion requires the trimesh dependency") from exc
    try:
        _validate_sidecars(path, asset)
        scene = trimesh.load_scene(path)
        if not scene.geometry:
            raise ModelAssetError(f"model contains no geometry: {path.name}")
        if path.suffix.lower() == ".stl" and asset.default_color:
                color = trimesh.visual.color.hex_to_rgba(asset.default_color)
                for geometry in scene.geometry.values():
                    geometry.visual = trimesh.visual.ColorVisuals(
                        geometry, vertex_colors=[color] * len(geometry.vertices)
                    )
        result = scene.export(file_type="glb")
    except ModelAssetError:
        raise
    except Exception as exc:
        raise ModelAssetError(f"could not import {path.name}: {exc}") from exc
    if not isinstance(result, bytes):
        raise ModelAssetError(f"importer did not produce binary GLB for {path.name}")
    return result


class ModelAssetRegistry:
    """Convert and publish plugin-owned models under stable logical keys."""

    def __init__(self, media: MediaService) -> None:
        self.media = media
        self._models: dict[str, RegisteredModel] = {}
        self._importers: dict[str, ModelImporter] = {
            ".glb": _validate_glb,
            ".gltf": _trimesh_import,
            ".obj": _trimesh_import,
            ".stl": _trimesh_import,
        }

    @property
    def models(self) -> dict[str, RegisteredModel]:
        return dict(self._models)

    def register_model_importer(self, extension: str, importer: ModelImporter) -> None:
        normalized = extension.lower()
        if not normalized.startswith("."):
            normalized = f".{normalized}"
        if normalized in self._importers:
            raise ModelAssetError(f"model importer already registered for {normalized}")
        self._importers[normalized] = importer

    def register_models(self, owner: str, assets: Iterable[ModelAsset]) -> None:
        prefix = f"{owner}/"
        for asset in assets:
            if (
                len(asset.key) > 120
                or not _ASSET_KEY.fullmatch(asset.key)
                or not asset.key.startswith(prefix)
            ):
                raise ModelAssetError(f"model key must begin with {prefix!r}")
            if asset.key in self._models:
                raise ModelAssetError(f"model key is already registered: {asset.key}")
            path = asset.source.resolve()
            extension = path.suffix.lower()
            if extension not in _SUPPORTED_EXTENSIONS and extension not in self._importers:
                raise ModelAssetError(f"unsupported model format: {extension or path.name}")
            data = self._importers[extension](path, asset)
            name, _stored = self.media.put_content(MODEL_NAMESPACE, data, "glb")
            self._models[asset.key] = RegisteredModel(
                asset=asset,
                url=self.media.url_for(MODEL_NAMESPACE, name),
                digest=name.removesuffix(".glb"),
            )

    def manifest(self) -> dict[str, Any]:
        assets = {}
        for key, registered in sorted(self._models.items()):
            asset = registered.asset
            assets[key] = {
                "url": registered.url,
                "digest": registered.digest,
                "transform": {
                    "scale": asset.transform.scale,
                    "rotation": list(asset.transform.rotation),
                    "translation": list(asset.transform.translation),
                },
                "clips": dict(asset.clips),
                "variants": list(asset.variants),
                "default_color": asset.default_color,
                "instanced": asset.instanced,
                "license": asset.license,
                "attribution": asset.attribution,
            }
        return {"schema_version": 2, "assets": assets}


def install_model_registry(actor) -> None:
    actor.model_asset_registry = ModelAssetRegistry(require_media_service(actor))


def require_model_registry(actor) -> ModelAssetRegistry:
    registry = getattr(actor, "model_asset_registry", None)
    if not isinstance(registry, ModelAssetRegistry):
        raise RuntimeError("bunnyland.3d model registry is not installed")
    return registry


def register_models(actor, owner: str, assets: Iterable[ModelAsset]) -> None:
    require_model_registry(actor).register_models(owner, assets)


def register_model_importer(actor, extension: str, importer: ModelImporter) -> None:
    require_model_registry(actor).register_model_importer(extension, importer)


__all__ = [
    "AssetSource",
    "MODEL_NAMESPACE",
    "ModelAsset",
    "ModelAssetError",
    "ModelAssetRegistry",
    "ModelTransform",
    "install_model_registry",
    "register_model_importer",
    "register_models",
    "require_model_registry",
]
