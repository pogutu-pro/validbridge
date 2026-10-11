"""Markdown and source-code files are accepted as submissions; binaries are not."""

import io

import pytest
from fastapi import HTTPException, UploadFile

from src.security.file_validation import get_safe_filename, validate_upload


def _upload(name: str, data: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, size=len(data))


@pytest.mark.parametrize("name", ["notes.md", "solution.py", "App.tsx", "Main.java", "q.sql", "nb.ipynb"])
def test_text_sources_are_accepted(name):
    mime, content = validate_upload(_upload(name, "print('héllo')\n".encode()), ["code"])
    assert content.startswith(b"print")
    # Stored extension follows the validated type, keeping the language.
    assert get_safe_filename(name, "p", content_type=mime).endswith(name.rsplit(".", 1)[1])


@pytest.mark.parametrize("name", ["page.html", "logo.svg", "run.sh", "x.php", "tool.exe", "a.bat"])
def test_executable_or_renderable_formats_stay_blocked(name):
    with pytest.raises(HTTPException) as exc:
        validate_upload(_upload(name, b"echo hi\n"), ["code"])
    assert exc.value.status_code == 415


def test_binary_renamed_to_py_is_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_upload(_upload("fake.py", b"\x7fELF\x00\x01\x02"), ["code"])
    assert exc.value.status_code == 415


def test_invalid_utf8_is_rejected():
    with pytest.raises(HTTPException):
        validate_upload(_upload("bad.md", b"\xff\xfe\xfa text"), ["code"])
