#!/usr/bin/env python3
"""Attach a private, digest-pinned predecessor bundle to native Codex.

Only sealed anonymous descriptors reach Codex: no mutable source path is reopened
by its image reader. No image payload or underlying parse error is ever logged.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def attach_images():
    path = Path(os.environ["HERMES_INITIAL_IMAGES_FILE"])
    directory = Path(os.environ["KURAMI_HOME"]) / "state/session-prompts"
    if (not path.is_absolute() or path.parent != directory or directory.resolve() != directory
            or not path.name.endswith(".images.json")):
        raise ValueError()
    # Open each directory component without following symlinks, then use that
    # pinned directory for both reading and unlinking the one-use bundle.
    directory_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in directory.parts[1:]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        directory_info = os.fstat(directory_fd)
        if directory_info.st_mode & 0o077 or directory_info.st_uid != os.getuid():
            raise ValueError()
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except Exception:
        os.close(directory_fd)
        raise
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid() or info.st_size > 12 * 1024 * 1024:
            raise ValueError()
        raw = source.read(12 * 1024 * 1024 + 1)
    if hashlib.sha256(raw).hexdigest() != os.environ["HERMES_INITIAL_IMAGES_SHA256"]:
        raise ValueError()
    images = json.loads(raw)
    if not isinstance(images, list) or not 1 <= len(images) <= 16:
        raise ValueError()
    args = []
    total = 0
    for image in images:
        if not isinstance(image, dict) or set(image) != {"sha256", "data"}:
            raise ValueError()
        data = base64.b64decode(image["data"], validate=True)
        total += len(data)
        if (not data or len(data) > 2 * 1024 * 1024 or total > 8 * 1024 * 1024
                or not (data.startswith(b"\x89PNG\r\n\x1a\n") or
                        (data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9")))
                or hashlib.sha256(data).hexdigest() != image["sha256"]):
            raise ValueError()
        # Linux-only, like the managed tmux launcher. Fail closed if sealing is
        # unavailable; never fall back to mutable files or fetching URLs.
        image_fd = os.memfd_create("kurami-predecessor" + (".png" if data.startswith(b"\x89PNG") else ".jpg"), os.MFD_ALLOW_SEALING)
        with os.fdopen(os.dup(image_fd), "wb") as output:
            output.write(data)
        # Linux UAPI constants: some Python distributions omit the symbolic
        # names despite supporting memfd_create. Kernel errors still fail closed.
        fcntl.fcntl(image_fd, 1033, 0x0008 | 0x0004 | 0x0002 | 0x0001)  # F_ADD_SEALS; WRITE/GROW/SHRINK/SEAL
        os.set_inheritable(image_fd, True)
        # The CLI may delegate loading to a child; anchor to this exec's PID,
        # not the child's descriptor table. The bytes cannot change after sealing.
        args.extend(["--image", f"/proc/{os.getpid()}/fd/{image_fd}"])
    os.unlink(path.name, dir_fd=directory_fd)
    os.close(directory_fd)
    return args


if __name__ == "__main__":
    try:
        attachments = attach_images()
    except Exception:
        print("Predecessor image transfer refused: missing, changed, unsafe or unsupported private bundle.", file=sys.stderr)
        sys.exit(1)
    os.environ.pop("HERMES_INITIAL_IMAGES_FILE", None)
    os.environ.pop("HERMES_INITIAL_IMAGES_SHA256", None)
    os.execv(sys.argv[1], [sys.argv[1], *sys.argv[2:-1], *attachments, "--", sys.argv[-1]])
