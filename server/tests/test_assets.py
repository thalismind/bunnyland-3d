from __future__ import annotations

import json
import struct

import pytest
from bunnyland.core import WorldActor
from bunnyland.foundation.media.plugin import plugin as media_plugin
from bunnyland.plugins import (
    DependencyContribution,
    Plugin,
    RuntimeContribution,
    apply_plugins,
)

from bunnyland_3d.assets import (
    AssetSource,
    ModelAsset,
    ModelAssetError,
    ModelTransform,
    PrimitivePart3D,
    ProceduralModelSource,
    VisualMaterial3D,
    require_model_registry,
)
from bunnyland_3d.plugin import plugin as plugin_3d


def _glb() -> bytes:
    document = b"{}  "
    length = 12 + 8 + len(document)
    return (
        b"glTF"
        + struct.pack("<II", 2, length)
        + struct.pack("<II", len(document), 0x4E4F534A)
        + document
    )


def _actor() -> WorldActor:
    actor = WorldActor()
    apply_plugins([media_plugin(), plugin_3d()], actor)
    return actor


def test_registry_publishes_content_addressed_glb_without_source_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    source = tmp_path / "source"
    source.mkdir()
    (source / "lantern.glb").write_bytes(_glb())
    actor = _actor()
    registry = require_model_registry(actor)

    registry.register_models(
        "vendor.plugin",
        [
            ModelAsset(
                key="vendor.plugin/lantern",
                source=AssetSource(source, "lantern.glb"),
                transform=ModelTransform(scale=0.5, translation=(0.0, 1.0, 0.0)),
                clips={"idle": "Glow"},
                variants=("warm",),
                instanced=True,
                license="CC0-1.0",
                attribution="Example Artist",
            )
        ],
    )
    manifest = registry.manifest()
    asset = manifest["assets"]["vendor.plugin/lantern"]

    assert manifest["schema_version"] == 2
    assert asset["url"].startswith("/public/media/models3d/")
    assert asset["url"].endswith(".glb")
    assert asset["transform"]["scale"] == 0.5
    assert asset["clips"] == {"idle": "Glow"}
    assert asset["instanced"] is True
    assert str(source) not in repr(manifest)


def test_procedural_recipe_compiles_deterministically_with_named_semantic_nodes(
    tmp_path, monkeypatch
):
    pytest.importorskip("trimesh")
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    source = ProceduralModelSource(
        parts=(
            PrimitivePart3D(
                "body",
                "box",
                size=(1.0, 0.5, 0.75),
                material=VisualMaterial3D(color="#336699", emissive="#102030"),
                roles=("damageable",),
            ),
            PrimitivePart3D(
                "lid",
                "cylinder",
                radius=0.4,
                height=0.1,
                transform=ModelTransform(translation=(0, 0.3, 0)),
                parent="body",
                roles=("openable",),
            ),
        ),
        required_roles=("damageable", "openable"),
    )
    first = require_model_registry(_actor())
    second = require_model_registry(_actor())

    first.register_models("vendor.plugin", [ModelAsset("vendor.plugin/chest", source)])
    second.register_models("vendor.plugin", [ModelAsset("vendor.plugin/chest", source)])

    first_asset = first.manifest()["assets"]["vendor.plugin/chest"]
    second_asset = second.manifest()["assets"]["vendor.plugin/chest"]
    assert first_asset["digest"] == second_asset["digest"]
    assert set(first_asset["nodes"]) >= {"body", "lid"}
    assert first_asset["semantic_roles"] == {
        "damageable": ["body"],
        "openable": ["lid"],
    }
    stored = first.media.read("models3d", first_asset["url"].rsplit("/", 1)[1])
    assert stored[:4] == b"glTF"


def test_procedural_recipe_rejects_invalid_hierarchy_and_missing_required_role(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    registry = require_model_registry(_actor())

    with pytest.raises(ModelAssetError, match="unknown procedural parent"):
        registry.register_models(
            "vendor.plugin",
            [
                ModelAsset(
                    "vendor.plugin/orphan",
                    ProceduralModelSource(
                        parts=(PrimitivePart3D("part", "box", parent="missing"),)
                    ),
                )
            ],
        )
    with pytest.raises(ModelAssetError, match="missing required semantic roles"):
        registry.register_models(
            "vendor.plugin",
            [
                ModelAsset(
                    "vendor.plugin/no-role",
                    ProceduralModelSource(
                        parts=(PrimitivePart3D("part", "sphere"),),
                        required_roles=("openable",),
                    ),
                )
            ],
        )


def test_registry_rejects_escaping_wrong_owner_duplicate_and_invalid_glb(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    root = tmp_path / "root"
    root.mkdir()
    (root / "ok.glb").write_bytes(_glb())
    (tmp_path / "outside.glb").write_bytes(_glb())
    (root / "bad.glb").write_bytes(b"not glb")
    registry = require_model_registry(_actor())

    with pytest.raises(ModelAssetError, match="begin"):
        registry.register_models(
            "vendor.plugin", [ModelAsset("other/model", AssetSource(root, "ok.glb"))]
        )
    with pytest.raises(ModelAssetError, match="escapes"):
        registry.register_models(
            "vendor.plugin", [ModelAsset("vendor.plugin/out", AssetSource(root, "../outside.glb"))]
        )
    with pytest.raises(ModelAssetError, match="invalid GLB"):
        registry.register_models(
            "vendor.plugin", [ModelAsset("vendor.plugin/bad", AssetSource(root, "bad.glb"))]
        )
    asset = ModelAsset("vendor.plugin/ok", AssetSource(root, "ok.glb"))
    registry.register_models("vendor.plugin", [asset])
    with pytest.raises(ModelAssetError, match="already registered"):
        registry.register_models("vendor.plugin", [asset])


@pytest.mark.parametrize(
    ("name", "content"),
    [
        (
            "triangle.obj",
            b"v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
        ),
        (
            "triangle.stl",
            b"solid triangle\nfacet normal 0 0 1\nouter loop\n"
            b"vertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid\n",
        ),
        (
            "triangle-binary.stl",
            b"binary stl".ljust(80, b"\0")
            + struct.pack("<I", 1)
            + struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0),
        ),
    ],
)
def test_registry_converts_obj_and_ascii_or_binary_stl(name, content, tmp_path, monkeypatch):
    pytest.importorskip("trimesh")
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    source = tmp_path / "source"
    source.mkdir()
    (source / name).write_bytes(content)
    registry = require_model_registry(_actor())

    registry.register_models(
        "vendor.plugin",
        [
            ModelAsset(
                f"vendor.plugin/{name}",
                AssetSource(source, name),
                default_color="#44aa66",
                instanced=True,
            )
        ],
    )

    url = registry.manifest()["assets"][f"vendor.plugin/{name}"]["url"]
    stored = registry.media.read("models3d", url.rsplit("/", 1)[1])
    assert stored[:4] == b"glTF"


def test_registry_embeds_external_gltf_buffer(tmp_path, monkeypatch):
    pytest.importorskip("trimesh")
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    source = tmp_path / "source"
    source.mkdir()
    buffer = struct.pack("<9f3H", 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 2)
    (source / "triangle.bin").write_bytes(buffer)
    document = {
        "asset": {"version": "2.0"},
        "buffers": [{"uri": "triangle.bin", "byteLength": len(buffer)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36, "target": 34962},
            {"buffer": 0, "byteOffset": 36, "byteLength": 6, "target": 34963},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "min": [0, 0, 0],
                "max": [1, 1, 0],
            },
            {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    (source / "triangle.gltf").write_text(json.dumps(document))
    registry = require_model_registry(_actor())

    registry.register_models(
        "vendor.plugin",
        [ModelAsset("vendor.plugin/gltf", AssetSource(source, "triangle.gltf"))],
    )

    url = registry.manifest()["assets"]["vendor.plugin/gltf"]["url"]
    assert registry.media.read("models3d", url.rsplit("/", 1)[1])[:4] == b"glTF"


def test_registry_rejects_gltf_sidecar_outside_declared_root(tmp_path, monkeypatch):
    pytest.importorskip("trimesh")
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    source = tmp_path / "source"
    source.mkdir()
    (tmp_path / "outside.bin").write_bytes(b"secret")
    (source / "escape.gltf").write_text(
        json.dumps(
            {
                "asset": {"version": "2.0"},
                "buffers": [{"uri": "../outside.bin", "byteLength": 6}],
                "scenes": [{}],
                "scene": 0,
            }
        )
    )
    registry = require_model_registry(_actor())

    with pytest.raises(ModelAssetError, match="sidecar escapes"):
        registry.register_models(
            "vendor.plugin",
            [ModelAsset("vendor.plugin/escape", AssetSource(source, "escape.gltf"))],
        )


def test_external_plugin_registers_model_through_integration_factory(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
    (tmp_path / "tree.glb").write_bytes(_glb())

    def integrate(actor):
        require_model_registry(actor).register_models(
            "vendor.forest",
            [ModelAsset("vendor.forest/tree", AssetSource(tmp_path, "tree.glb"), instanced=True)],
        )

    provider = Plugin(
        id="vendor.forest",
        name="Forest Visuals",
        dependencies=DependencyContribution(requires=("bunnyland.3d",)),
        runtime=RuntimeContribution(integration_factories=(integrate,)),
    )
    actor = WorldActor()

    apply_plugins([media_plugin(), plugin_3d(), provider], actor)

    assert "vendor.forest/tree" in require_model_registry(actor).manifest()["assets"]
