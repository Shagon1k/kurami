#!/usr/bin/env python3
"""Install/check the single monthly read-only resource audit job."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--home', type=Path, default=Path(os.environ.get('KURAMI_HOME', '/home/shagon1k/_hermes/_kurami')))
    parser.add_argument('--hermes-home', type=Path, default=Path(os.environ.get('HERMES_HOME', '/home/shagon1k/_hermes/_core')))
    args = parser.parse_args()
    os.environ['HERMES_HOME'] = str(args.hermes_home)
    sys.path.insert(0, str(args.hermes_home / 'hermes-agent'))
    import yaml
    from cron.jobs import list_jobs
    from tools.cronjob_tools import cronjob
    config = yaml.safe_load((args.home / 'config/orchestrator.yaml').read_text())
    channel = str(config.get('discord', {}).get('maintenance_channel_id', ''))
    if not channel.isdigit() or not 5 <= len(channel) <= 30:
        raise ValueError('Maintenance channel unavailable')
    root = Path(__file__).resolve().parents[1]
    script = 'kurami-resource-audit.sh'
    name = 'kurami-monthly-resource-audit'
    jobs = [j for j in list_jobs(include_disabled=True) if j.get('name') == name]
    if len(jobs) > 1:
        raise ValueError('Duplicate resource audit jobs; resolve manually')
    job = jobs[0] if jobs else None
    if job and job.get('script') != script:
        raise ValueError('Existing job uses another script; refusing to replace it')
    fields = {'schedule': '30 6 1 * *', 'deliver': 'discord:' + channel, 'no_agent': True,
              'script': script, 'workdir': str(args.home / 'app'), 'prompt': 'Run the read-only resource audit. The script creates its own tool-free Hermes session. Never clean without separate owner approval.'}
    target = args.hermes_home / 'scripts' / script
    source = (root / 'integrations/hermes/scripts' / script).read_text()
    wrapper_matches = target.is_file() and target.read_text() == source
    if args.apply:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not wrapper_matches:
            target.write_text(source)
            target.chmod(0o700)
        result = json.loads(cronjob(action='update', job_id=job['id'], **fields) if job else cronjob(action='create', name=name, **fields))
        if not result.get('success'):
            raise RuntimeError('Native scheduler rejected resource audit configuration')
        refreshed = [j for j in list_jobs(include_disabled=True) if j.get('name') == name]
        if len(refreshed) != 1:
            raise RuntimeError('Installed resource audit not found uniquely')
        job = refreshed[0]
    print(json.dumps({'name': name, 'jobId': job.get('id') if job else None, 'scheduleUTC': fields['schedule'],
                      'deliver': fields['deliver'], 'installed': bool(job), 'enabled': job.get('enabled') if job else False,
                      'wrapperSynchronized': args.apply or wrapper_matches, 'applied': args.apply}))


if __name__ == '__main__':
    main()
