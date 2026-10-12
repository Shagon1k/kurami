"""Deterministic PID-replacement races plus a real Linux pidfd exit race."""
import errno
from pathlib import Path
import runpy
import signal
import subprocess
import unittest
from unittest.mock import patch

helper = runpy.run_path(str(Path(__file__).resolve().parents[1] /
                            "src/orchestrator/projects/sessions/park-processes.py"))
terminate = helper["terminate_process"]
entry = {"pid": 12345, "started": "100"}


def stat(started):
    return "12345 (fixture) S " + " ".join(["0"] * 18 + [started])


class PidfdTests(unittest.TestCase):
    def replacement_race(self, when):
        current = "original"
        pinned = None
        signalled = []
        events = []

        def open_fd(pid):
            nonlocal current, pinned
            events.append("open")
            self.assertEqual(pid, entry["pid"])
            if when == "before_open":
                current = "replacement"
            pinned = current
            if when == "before_stat":
                current = "replacement"
            return 42

        def read_stat(path):
            nonlocal current
            events.append("stat")
            value = stat("100" if current == "original" else "200")
            if when == "after_stat":
                current = "replacement"
            return value

        def send(fd, sig):
            events.append("signal")
            self.assertEqual(fd, 42)
            self.assertEqual(sig, signal.SIGTERM)
            # The kernel resolves the descriptor, NOT the now-reused numeric PID.
            if pinned == "original" and current == "replacement":
                raise ProcessLookupError(errno.ESRCH, "original exited")
            signalled.append(pinned)

        with patch("os.pidfd_open", side_effect=open_fd), \
                patch.object(Path, "read_text", read_stat), \
                patch("signal.pidfd_send_signal", side_effect=send), \
                patch("os.close") as close:
            terminate(entry)
        self.assertEqual(events[:2], ["open", "stat"])
        self.assertNotIn("replacement", signalled)
        close.assert_called_once_with(42)
        if when == "after_stat":
            self.assertEqual(events, ["open", "stat", "signal"])
        else:
            self.assertEqual(events, ["open", "stat"])

    def test_replaced_before_open(self):
        self.replacement_race("before_open")

    def test_replaced_before_validation(self):
        self.replacement_race("before_stat")

    def test_replaced_after_validation(self):
        self.replacement_race("after_stat")

    def test_real_exit_after_validation(self):
        original = subprocess.Popen(["sleep", "60"])
        replacement = subprocess.Popen(["sleep", "60"])
        real_send = signal.pidfd_send_signal
        try:
            fields = Path(f"/proc/{original.pid}/stat").read_text().rsplit(")", 1)[1].split()
            validated = {"pid": original.pid, "started": fields[19]}

            def exit_then_send(fd, sig):
                original.terminate()
                original.wait(timeout=5)
                # This exercises the exact validation -> send race using the
                # real kernel. No live process can be reached by the dead fd.
                with self.assertRaises(ProcessLookupError):
                    real_send(fd, sig)
                raise ProcessLookupError(errno.ESRCH, "original exited")

            with patch("signal.pidfd_send_signal", side_effect=exit_then_send) as send:
                terminate(validated)
            send.assert_called_once()
            self.assertIsNone(replacement.poll())
        finally:
            for child in (original, replacement):
                if child.poll() is None:
                    child.terminate()
                child.wait(timeout=5)

    def test_permission_failure_propagates_and_closes(self):
        with patch("os.pidfd_open", return_value=42), \
                patch.object(Path, "read_text", return_value=stat("100")), \
                patch("signal.pidfd_send_signal", side_effect=PermissionError), \
                patch("os.close") as close:
            with self.assertRaises(PermissionError):
                terminate(entry)
        close.assert_called_once_with(42)


if __name__ == "__main__":
    unittest.main()
