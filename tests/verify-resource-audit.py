import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import types
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('resource_audit', ROOT / 'bin/resource-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ResourceAuditTest(unittest.TestCase):
    def test_inventory_is_read_only_and_marks_active_resources(self):
        with tempfile.TemporaryDirectory(prefix='kurami-resource-audit-test-') as directory:
            root = Path(directory)
            home, user, proc, tmp = [root / x for x in ['kurami', 'user', 'proc', 'tmp']]
            for p in [home / 'state', user, proc / '100', tmp / 'old-cache']:
                p.mkdir(parents=True)
            (tmp / 'old-cache/marker').write_text('KEEP_TEST_DATA')
            (proc / 'meminfo').write_text('MemTotal: 1000000 kB\nMemAvailable: 600000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')
            (proc / '100/comm').write_text('node\n')
            (proc / '100/cmdline').write_bytes((str(tmp / 'old-cache') + '\0PRIVATE_TOKEN_SENTINEL').encode())
            (proc / '100/environ').write_bytes(b'PRIVATE_ENV_SENTINEL')
            (proc / '100/maps').write_text('')
            (proc / '100/mountinfo').write_text('1 2 8:1 /var/lib/docker/volumes/example-postgres/_data /var/lib/postgresql/data rw - ext4 /dev/vda1 rw\n')
            (proc / '100/smaps_rollup').write_text('Pss: 1024 kB\n')
            with sqlite3.connect(home / 'state/orchestrator.db') as db:
                db.executescript('CREATE TABLE runs(run_id TEXT,project TEXT,issue_number INTEGER,state TEXT); CREATE TABLE run_resources(run_id TEXT,worktree_path TEXT,resource_state TEXT);')
            locked = tmp / 'protected-service';locked.mkdir();locked.chmod(0)
            commands = []
            def read_command(args, timeout=30):
                commands.append(args)
                if args[0] == 'nice':
                    return '500000000\t/\n200000000\t' + str(tmp / 'old-cache') + '\n', 1
                if args[:2] == ['docker', 'info']:
                    return '["name=rootless"]', 0
                if args[:3] == ['docker', 'volume', 'ls']:
                    return '{"Name":"test-postgres-data"}\n', 0
                return '', 0
            with patch.object(audit, 'command', side_effect=read_command):
                try:
                    result = audit.inventory(home, user, proc, tmp)
                finally:
                    locked.chmod(0o700)
            self.assertTrue(result['candidates'][0]['protected'])
            self.assertEqual(result['memory']['usedBytes'], 400000*1024)
            self.assertEqual(result['memory']['processGroups'][0]['pssBytes'], 1024*1024)
            self.assertEqual((tmp / 'old-cache/marker').read_text(), 'KEEP_TEST_DATA')
            self.assertNotIn('PRIVATE_TOKEN_SENTINEL', json.dumps(result))
            self.assertNotIn('PRIVATE_ENV_SENTINEL', json.dumps(result))
            self.assertFalse(any(any(x in args for x in ['rm', 'prune', 'stop', 'kill', '--force', '--apply']) for args in commands))
            self.assertIn('Preserve all volumes', result['docker']['policy'])
            self.assertEqual(result['databaseMounts'], ['/var/lib/docker/volumes/example-postgres/_data'], 'mount metadata is collected even when fd listing is inaccessible')

    def test_no_invented_or_protected_cleanup_targets(self):
        snapshot = {'candidates': [{'id': 'active', 'protected': True}]}
        value = {'summary': {'ru': 'Есть активные данные.', 'en': 'Data is active.'}, 'analysis': {'ru': 'Сохранить.', 'en': 'Keep.'},
                 'decisions': [{'id': 'active', 'recommendation': 'keep', 'ru': 'Работает', 'en': 'Active'}]}
        value['id'] = 'untrusted-id-must-not-override-inventory'
        self.assertNotIn('id', audit.validate_analysis(value, snapshot))
        value['decisions'][0]['recommendation'] = 'consider'
        with self.assertRaises(ValueError):
            audit.validate_analysis(value, snapshot)
        value['decisions'][0].update(id='invented', recommendation='keep')
        with self.assertRaises(ValueError):
            audit.validate_analysis(value, snapshot)

    def test_agent_fails_closed_if_tools_are_loaded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ends = []
            class DB:
                def end_session(self, *args): ends.append(args)
                def close(self): pass
            class Agent:
                def __init__(self, **kwargs):
                    self.tools = ['terminal']
                    self.valid_tool_names = {'terminal'}
                def run_conversation(self, prompt):
                    raise AssertionError('Agent with tools must never run')
            modules = {
                'hermes_cli.config': types.SimpleNamespace(load_config_readonly=lambda: {'model': {'default': 'configured-model'}}),
                'hermes_cli.runtime_provider': types.SimpleNamespace(resolve_runtime_provider=lambda **kw: {}),
                'hermes_state': types.SimpleNamespace(SessionDB=DB),
                'run_agent': types.SimpleNamespace(AIAgent=Agent),
            }
            with patch.dict(sys.modules, modules):
                with self.assertRaisesRegex(RuntimeError, 'agent has tools'):
                    audit.analyze({'checkedAt': '2026-10-14'}, root, root, root)
            self.assertEqual(ends[0][1], 'error')


    def test_tool_free_analysis_has_a_longer_response_window_and_named_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompt = root / 'src/system/maintenance/resource-audit-prompt.md'
            prompt.parent.mkdir(parents=True)
            prompt.write_text('Audit inventory.')
            value = {'summary': {'ru': 'Сохранить.', 'en': 'Keep.'},
                     'analysis': {'ru': 'Сохранить.', 'en': 'Keep.'}, 'decisions': []}
            events = []
            class DB:
                def set_session_title(self, *args): events.append('title')
                def end_session(self, *args): events.append(args[1])
                def close(self): pass
            class Agent:
                def __init__(self, **kwargs):
                    self.tools = []; self.valid_tool_names = set()
                def run_conversation(self, prompt):
                    events.append('conversation')
                    if os.environ['HERMES_API_CALL_STALE_TIMEOUT'] != '300':
                        raise AssertionError('Audit needs its own response window')
                    return {'completed': True, 'final_response': json.dumps(value)}
            modules = {
                'hermes_cli.config': types.SimpleNamespace(load_config_readonly=lambda: {'model': {'default': 'configured-model'}}),
                'hermes_cli.runtime_provider': types.SimpleNamespace(resolve_runtime_provider=lambda **kw: {}),
                'hermes_state': types.SimpleNamespace(SessionDB=DB),
                'run_agent': types.SimpleNamespace(AIAgent=Agent),
            }
            with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, modules):
                result, session = audit.analyze({'checkedAt': '2026-10-14', 'candidates': []}, root, root, root)
            self.assertEqual(events, ['conversation', 'title', 'completed'])
            self.assertEqual(result, value)
            self.assertTrue(session.startswith('resource_audit_'))

    def test_external_agent_backend_cannot_receive_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def forbidden(*args, **kwargs):
                raise AssertionError('External backend must not start a session or agent')
            modules = {
                'hermes_cli.config': types.SimpleNamespace(load_config_readonly=lambda: {'model': {'default': 'configured-model'}}),
                'hermes_cli.runtime_provider': types.SimpleNamespace(resolve_runtime_provider=lambda **kw: {'provider': 'acp', 'acp_command': 'external-cli'}),
                'hermes_state': types.SimpleNamespace(SessionDB=forbidden),
                'run_agent': types.SimpleNamespace(AIAgent=forbidden),
            }
            with patch.dict(sys.modules, modules):
                with self.assertRaisesRegex(RuntimeError, 'external CLI agent'):
                    audit.analyze({'checkedAt': '2026-10-14'}, root, root, root)


if __name__ == '__main__':
    unittest.main()
