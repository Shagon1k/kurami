"""Synthetic native-image transport regressions; never reads owner history/auth."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "bin/launch-codex-images.py"


def png(red=40):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes([0, red, 80, 120, 255]))) + chunk(b"IEND", b""))


with tempfile.TemporaryDirectory(prefix="kurami-native-images-") as temporary:
    home = Path(temporary)
    directory = home / "state/session-prompts"
    directory.mkdir(parents=True, mode=0o700)
    bundle = directory / "synthetic.images.json"
    fake = home / "codex"
    fake.write_text('''#!/usr/bin/env python3
import errno, fcntl, hashlib, json, os, sys
args=sys.argv[1:]
assert args[:2]==["--sandbox","workspace-write"]
assert args[-2:]==["--","Synthetic prompt"]
images=[]
for index,arg in enumerate(args):
 if arg=="--image":
  path=args[index+1]
  with open(path,"rb") as source: data=source.read()
  assert data.startswith(b"\\x89PNG\\r\\n\\x1a\\n") or (data.startswith(b"\\xff\\xd8") and data.endswith(b"\\xff\\xd9"))
  fd=os.open(path,os.O_WRONLY)
  try:
   try: os.write(fd,b"changed"); raise AssertionError("image was writable")
   except OSError as error: assert error.errno==errno.EPERM
  finally: os.close(fd)
  images.append(hashlib.sha256(data).hexdigest())
assert "HERMES_INITIAL_IMAGES_FILE" not in os.environ
print(json.dumps({"digests":images,"nativeAttachments":len(images)}))
''')
    fake.chmod(0o700)
    data = [png(), (ROOT / "tests/fixtures/predecessor-images/baseline.jpg").read_bytes(),
            (ROOT / "tests/fixtures/predecessor-images/progressive.jpg").read_bytes(), png(90)]
    records = [{"sha256": hashlib.sha256(value).hexdigest(), "data": base64.b64encode(value).decode()} for value in data]
    raw = json.dumps(records).encode()
    env = {**os.environ, "KURAMI_HOME": str(home), "HERMES_INITIAL_IMAGES_FILE": str(bundle),
           "HERMES_INITIAL_IMAGES_SHA256": hashlib.sha256(raw).hexdigest()}

    def write():
        if bundle.is_symlink():
            bundle.unlink()
        bundle.write_bytes(raw)
        bundle.chmod(0o600)

    def run(success=False):
        result = subprocess.run(["python3", str(BRIDGE), str(fake), "--sandbox", "workspace-write", "Synthetic prompt"],
                                env=env, capture_output=True, text=True, timeout=10)
        if success:
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout) == {"digests": [record["sha256"] for record in records], "nativeAttachments": len(data)}
            assert not bundle.exists()
        else:
            assert result.returncode != 0 and not result.stdout
            assert result.stderr == "Predecessor image transfer refused: missing, changed, unsafe or unsupported private bundle.\n"

    write(); run(True)
    run()  # missing bundle
    write(); bundle.write_bytes(raw.replace(b"40", b"41") + b" "); run()  # changed bytes
    write(); bundle.chmod(0o644); run()
    write(); target=home / "target"; bundle.rename(target); bundle.symlink_to(target); run()
    write(); saved=home / "saved"; directory.rename(saved); directory.symlink_to(saved); run()
    directory.unlink(); saved.rename(directory)
    write(); env["HERMES_INITIAL_IMAGES_FILE"] = str(home / "outside.images.json"); run()
    env["HERMES_INITIAL_IMAGES_FILE"] = str(bundle)
    for invalid in [[], records * 9, [{"sha256": "0" * 64, "data": records[0]["data"]}],
                    [{"sha256": "0" * 64, "data": "https://example.invalid/private"}],
                    [{"sha256": "0" * 64, "data": base64.b64encode(b"x" * (2 * 1024 * 1024 + 1)).decode()}]]:
        bundle.write_text(json.dumps(invalid)); bundle.chmod(0o600)
        env["HERMES_INITIAL_IMAGES_SHA256"] = hashlib.sha256(bundle.read_bytes()).hexdigest()
        run()
    print("Verified native attachment order, exact bytes, sealed immutable consumption, and missing/changed/unsafe/oversized bundle refusals.")
