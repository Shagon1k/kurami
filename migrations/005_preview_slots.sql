CREATE TABLE preview_slots (
  slot_number INTEGER PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 6),
  hostname TEXT NOT NULL UNIQUE,
  assets_hostname TEXT NOT NULL UNIQUE,
  frontend_port INTEGER NOT NULL UNIQUE CHECK (frontend_port BETWEEN 1024 AND 65535),
  backend_port INTEGER NOT NULL UNIQUE CHECK (backend_port BETWEEN 1024 AND 65535),
  postgres_port INTEGER NOT NULL UNIQUE CHECK (postgres_port BETWEEN 1024 AND 65535),
  redis_port INTEGER NOT NULL UNIQUE CHECK (redis_port BETWEEN 1024 AND 65535),
  minio_api_port INTEGER NOT NULL UNIQUE CHECK (minio_api_port BETWEEN 1024 AND 65535),
  minio_console_port INTEGER NOT NULL UNIQUE CHECK (minio_console_port BETWEEN 1024 AND 65535),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO preview_slots (
  slot_number, hostname, assets_hostname,
  frontend_port, backend_port, postgres_port, redis_port,
  minio_api_port, minio_console_port
) VALUES
  (1, 'preview-1.shagon1k.win', 'assets-preview-1.shagon1k.win', 43101, 43201, 45401, 46301, 49101, 49201),
  (2, 'preview-2.shagon1k.win', 'assets-preview-2.shagon1k.win', 43102, 43202, 45402, 46302, 49102, 49202),
  (3, 'preview-3.shagon1k.win', 'assets-preview-3.shagon1k.win', 43103, 43203, 45403, 46303, 49103, 49203),
  (4, 'preview-4.shagon1k.win', 'assets-preview-4.shagon1k.win', 43104, 43204, 45404, 46304, 49104, 49204),
  (5, 'preview-5.shagon1k.win', 'assets-preview-5.shagon1k.win', 43105, 43205, 45405, 46305, 49105, 49205),
  (6, 'preview-6.shagon1k.win', 'assets-preview-6.shagon1k.win', 43106, 43206, 45406, 46306, 49106, 49206);

CREATE TABLE preview_leases (
  lease_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL REFERENCES preview_slots(slot_number) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN (
    'leased',
    'provisioning',
    'running',
    'releasing',
    'released',
    'failed'
  )),
  compose_project_name TEXT NOT NULL,
  leased_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at TEXT,
  release_reason TEXT,
  CHECK (
    (state = 'released' AND released_at IS NOT NULL)
    OR
    (state <> 'released' AND released_at IS NULL)
  )
) STRICT;

CREATE UNIQUE INDEX preview_leases_one_active_slot_idx
  ON preview_leases(slot_number)
  WHERE state <> 'released';

CREATE UNIQUE INDEX preview_leases_one_active_run_idx
  ON preview_leases(run_id)
  WHERE state <> 'released';

CREATE UNIQUE INDEX preview_leases_active_compose_project_idx
  ON preview_leases(compose_project_name)
  WHERE state <> 'released';

CREATE INDEX preview_leases_run_history_idx
  ON preview_leases(run_id, leased_at);
