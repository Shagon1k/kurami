#!/usr/bin/env python3
"""No network: exercise the same completion worker used by Telegram MCP."""
import asyncio
import importlib.util
import json
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("completion", root / "integrations/hermes/connectors/briefing_completion.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Fixture:
    def __init__(self, home, count=87):
        self.home = home
        self.state = "editorialized"
        self.pairs = [{"chat_id":-1001, "message_id":i+1} for i in range(count)]
        self.calls = []
        self.downloads = []
        self.acks = 0
        self.interrupt = False
        self.notify_failure = False
        self.bad_identity = False
        self.fail_one = False
        self.concurrent = None

    def cli(self, args):
        action = args[0]
        self.calls.append(action)
        if action == "completion-context":
            return {"attempt":{"state":self.state}, "runDirectory":str(self.home),
                    "payloadPath":str(self.home/"payload.json"), "pairs":self.pairs, "pairDigest":"stable"}
        if action == "render-preview":
            self.state = "prepared"
        elif action == "build-media-manifest":
            values = json.loads((self.home/"completion-downloads.json").read_text())["results"]
            assert len(values) == len(self.pairs)
            return {"outputPath":str(self.home/"manifest.json") if self.pairs else None}
        elif action in {"import-media","media-ready"}:
            self.state = "media-ready"
        elif action == "telegram-commit-plan":
            self.state = "commit-planned"
            return {"sources":[{"chatId":-1001,"maxId":100,"sourceKey":"telegram:test"}], "planDigest":"plan"}
        elif action == "finalize":
            commits = json.loads((self.home/"completion-commits.json").read_text())
            assert commits["planDigest"] == "plan"
            self.state = "published"
        elif action == "notify-release":
            if self.notify_failure:
                raise RuntimeError("notification unavailable")
            self.state = "notified"
        elif action == "assert-complete":
            assert self.state == "notified"
        elif action == "advance-attempt":
            self.state = "failed"
        elif action == "attempt-status":
            return {"attempt":{"state":self.state}}
        return {"ok":True}

    async def download(self, pairs):
        if self.interrupt and self.downloads:
            raise RuntimeError("transport disconnected")
        self.downloads.append([p["message_id"] for p in pairs])
        if self.concurrent:
            call, self.concurrent = self.concurrent, None
            assert (await call())["state"] == "busy"
        results = []
        for pair in pairs:
            if self.fail_one and pair["message_id"] == 13:
                results.append({"chatId":pair["chat_id"],"messageId":13,"status":"failed"})
                continue
            path = self.home / (str(pair["message_id"])+".jpg")
            path.write_bytes(b"image")
            results.append({"chatId":pair["chat_id"], "messageId":pair["message_id"],
                            "status":"downloaded","path":str(path)})
        if self.bad_identity:
            results[0]["messageId"] = 9999
        return json.dumps({"results":results})

    async def acknowledge(self, items, edition, attempt, digest):
        self.acks += 1
        assert items == [{"chat_id":-1001,"max_id":100}]
        assert digest == "plan"
        return json.dumps({"results":[{"chatId":-1001,"maxId":100,"status":"committed"}]})

    async def run(self):
        return await module.finish("daily:2026-09-17", "attempt", cli=self.cli,
            download=self.download, acknowledge=self.acknowledge,
            atomic_json=lambda path,value:path.write_text(json.dumps(value)),
            valid_path=lambda path,*key: path.is_file() and path.parent == self.home, home=self.home)


async def tests():
    with tempfile.TemporaryDirectory() as directory:
        home = Path(directory)
        f = Fixture(home)
        f.interrupt = True
        first = await f.run()
        assert first["ok"] is False and f.state == "failed"
        assert len(json.loads((home/"completion-downloads.json").read_text())["results"]) == 12
        assert f.acks == 0 and "finalize" not in f.calls
        f.interrupt = False
        f.state = "prepared"  # authorized runtime recovery, not a fresh capture
        f.concurrent = f.run
        result = await f.run()
        assert result["ok"] is True and f.state == "notified"
        assert f.downloads == [list(range(i,min(i+12,88))) for i in range(1,88,12)]
        assert f.acks == 1
        assert (await f.run())["ok"] and f.acks == 1
    with tempfile.TemporaryDirectory() as directory:
        f = Fixture(Path(directory), 0)
        f.notify_failure = True
        assert (await f.run())["ok"] is False and f.state == "published"
        assert f.downloads == []
        f.notify_failure = False
        assert (await f.run())["ok"] and f.acks == 1
    with tempfile.TemporaryDirectory() as directory:
        f = Fixture(Path(directory), 15)
        f.fail_one = True
        assert (await f.run())["errorCode"] == "completion_media_incomplete"
        assert f.downloads == [list(range(1,13)),[13,14,15],[13],[13]]
        assert f.acks == 0
    with tempfile.TemporaryDirectory() as directory:
        f = Fixture(Path(directory), 1)
        f.bad_identity = True
        assert (await f.run())["errorCode"] == "completion_download_identity_mismatch"
        assert f.acks == 0
    with tempfile.TemporaryDirectory() as directory:
        f = Fixture(Path(directory), 1)
        f.state = "commit-planned"
        (f.home/"completion-commits.json").write_text(json.dumps({
            "editionId":"daily:2026-09-17", "planDigest":"plan",
            "results":[{"sourceKey":"telegram:test","status":"committed"}]}))
        assert (await f.run())["ok"] and f.acks == 0
    print("Completion: 87 images, resume after 12, bounded retries, locks, exact identities, notification-only retry and persisted commits verified.")


asyncio.run(tests())
