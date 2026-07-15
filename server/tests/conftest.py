import pytest


@pytest.fixture(autouse=True)
def isolated_media_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BUNNYLAND_MEDIA_DIR", str(tmp_path / "media"))
