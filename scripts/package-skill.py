#!/usr/bin/env python3
"""Build the maintainer-only .skill ZIP using only Python's standard library."""

import argparse
import os
from pathlib import Path
import stat
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "browser-demo-videos"
ROOT_FILES = ("SKILL.md", "LICENSE")
SOURCE_DIRECTORIES = {
    "scripts": {".mjs", ".js", ".cjs", ".json"},
    "references": {".md", ".json"},
    "assets/demo": {".mjs", ".js", ".html", ".css", ".json", ".svg"},
}
EXCLUDED_DIRECTORIES = {
    "node_modules", "runtime", "live-runtime", "artifacts", "demo-output",
    "output", "outputs", "recordings", "screenshots", "logs", "coverage",
    "__pycache__", "profiles", "credentials", "cache", "caches", "tmp", "temp",
    "dist", "build", "sessions", "downloads",
}
REQUIRED_FILES = (
    "SKILL.md", "LICENSE", "scripts/cli.mjs", "references/plan-format.md",
    "assets/demo/server.mjs", "assets/demo/site.html", "assets/demo/walkthrough.json",
)


def require_regular_file(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Payload must be a regular file: {path.relative_to(ROOT)}")
    if not path.resolve().is_relative_to(SKILL):
        raise ValueError(f"Payload escapes the skill: {path.relative_to(ROOT)}")


def source_files(directory, suffixes):
    if not stat.S_ISDIR(directory.lstat().st_mode):
        raise ValueError(f"Payload must be a real directory: {directory.relative_to(ROOT)}")
    for path in sorted(directory.iterdir()):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise ValueError(f"Symbolic links are not allowed: {path.relative_to(ROOT)}")
        if path.name.startswith(".") or path.name in EXCLUDED_DIRECTORIES:
            continue
        if stat.S_ISDIR(mode):
            yield from source_files(path, suffixes)
        elif stat.S_ISREG(mode) and path.suffix in suffixes:
            require_regular_file(path)
            yield path
        elif not stat.S_ISREG(mode):
            raise ValueError(f"Unsupported payload entry: {path.relative_to(ROOT)}")


def payload_files():
    # Reject linked ancestors as well as linked entries; never follow a checkout escape.
    for directory in (ROOT / "skills", SKILL, SKILL / "assets"):
        if not stat.S_ISDIR(directory.lstat().st_mode):
            raise ValueError(f"Payload must be a real directory: {directory.relative_to(ROOT)}")
    files = []
    for name in ROOT_FILES:
        path = SKILL / name
        require_regular_file(path)
        files.append(path)
    for name, suffixes in SOURCE_DIRECTORIES.items():
        files.extend(source_files(SKILL / name, suffixes))
    included = {path.relative_to(SKILL).as_posix() for path in files}
    missing = set(REQUIRED_FILES) - included
    if missing:
        raise ValueError(f"Missing required skill sources: {', '.join(sorted(missing))}")
    return sorted(files, key=lambda path: path.relative_to(SKILL).as_posix())


def build_archive(destination):
    files = payload_files()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError("Refusing to replace a symbolic-link archive destination")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".browser-demo-videos-", suffix=".skill", dir=destination.parent,
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in files:
                relative = path.relative_to(SKILL).as_posix()
                entry = zipfile.ZipInfo(f"browser-demo-videos/{relative}", (1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                permissions = 0o755 if relative == "scripts/cli.mjs" else 0o644
                entry.external_attr = (stat.S_IFREG | permissions) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, path.read_bytes(), compresslevel=9)
        temporary.chmod(0o644)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Packaged {len(files)} source files: {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "destination", nargs="?", type=Path,
        default=ROOT / "artifacts" / "distribution" / "browser-demo-videos.skill",
        help="output archive (default: artifacts/distribution/browser-demo-videos.skill)",
    )
    arguments = parser.parse_args()
    try:
        build_archive(arguments.destination.absolute())
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Cannot package skill: {error}\n")


if __name__ == "__main__":
    main()
