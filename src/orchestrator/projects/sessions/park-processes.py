"""Signal only snapshotted Linux process identities; never fall back to kill(pid)."""
import json
import os
from pathlib import Path
import signal
import sys


def terminate_process(entry):
    try:
        # Pin the kernel identity BEFORE inspecting /proc. If the PID is reused
        # after validation, this descriptor still refers only to the old process.
        fd = os.pidfd_open(entry["pid"])
    except ProcessLookupError:
        return
    try:
        try:
            stat = Path(f'/proc/{entry["pid"]}/stat').read_text()
            fields = stat[stat.rindex(")") + 2:].split()
            if fields[19] != entry["started"] or fields[0] in ("Z", "X"):
                return
            signal.pidfd_send_signal(fd, signal.SIGTERM)
        except (FileNotFoundError, ProcessLookupError):
            pass
    finally:
        os.close(fd)


if __name__ == "__main__":
    for entry in json.loads(sys.argv[1]):
        terminate_process(entry)
