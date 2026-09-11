-- Small, realistic fixture set proving the architecture end to end — NOT a
-- full catalog import (owner's brief: "a handful of real games is fine").
-- Revisions are assigned by hand here (this is the one place in the whole
-- backend where revision numbers are written directly rather than derived
-- from sync_state, because a migration runs before any request handler and
-- is establishing the initial state sync_state itself already reflects).

INSERT INTO discovery_catalog_entries
  (solith_game_id, title, normalized_title, aliases_json, provider_ids_json, type,
   release_date, release_year, genres_json, tags_json, trainer_available, ct_available,
   updated_at, revision)
VALUES
  ('atomfall', 'Atomfall', 'atomfall', '[]', '{}', 'game',
   '2025-03-27', 2025, '["survival","action"]', '["single-player"]', 1, 0,
   '2026-07-17T00:00:01.000Z', 1),
  ('baldurs-gate-3', 'Baldur''s Gate 3', 'baldurs gate 3', '["bg3"]', '{}', 'game',
   '2023-08-03', 2023, '["rpg"]', '["single-player","co-op"]', 1, 1,
   '2026-07-17T00:00:02.000Z', 2),
  ('hogwarts-legacy', 'Hogwarts Legacy', 'hogwarts legacy', '[]', '{}', 'game',
   '2023-02-10', 2023, '["action-rpg"]', '["single-player"]', 0, 0,
   '2026-07-17T00:00:03.000Z', 3);

INSERT INTO trainer_coverage
  (game_id, trainer_available, trainer_id, trainer_version, game_build_hint,
   cheat_count, trust_state, artifact_hash, artifact_size_bytes, last_updated,
   author, source, revision)
VALUES
  ('atomfall', 1, 'atomfall-trainer-v1', '1.0.0', 'Atomfall_dx12.exe',
   4, 'community-verified',
   '6c8fed01e93f1e1197a87d61bd2d8ea3223ee595a01aeee8e488dae19d1c1fd3', 51,
   '2026-07-17T00:00:01.000Z', 'solith-fixtures', 'seed', 1),
  ('baldurs-gate-3', 1, 'bg3-trainer-v1', '1.2.0', 'bg3.exe',
   12, 'community-verified', NULL, NULL,
   '2026-07-17T00:00:02.000Z', 'solith-fixtures', 'seed', 2),
  ('hogwarts-legacy', 0, NULL, NULL, NULL,
   0, 'unverified', NULL, NULL,
   '2026-07-17T00:00:03.000Z', 'solith-fixtures', 'seed', 3);

-- Fixture trainer artifact for atomfall-trainer-v1 — real bytes, real
-- SHA-256 (computed with node:crypto, matches artifact_hash above exactly):
--   payload = "SOLITH-PHASE2-FIXTURE-TRAINER-ARTIFACT-atomfall-v1\n" (51 bytes)
INSERT INTO artifacts (artifact_hash, size_bytes, content_type, blob, created_at)
VALUES (
  '6c8fed01e93f1e1197a87d61bd2d8ea3223ee595a01aeee8e488dae19d1c1fd3',
  51,
  'application/octet-stream',
  x'534f4c4954482d5048415345322d464958545552452d545241494e45522d41525449464143542d61746f6d66616c6c2d76310a',
  '2026-07-17T00:00:01.000Z'
);

UPDATE sync_state SET catalog_revision = 3, trainer_revision = 3, updated_at = '2026-07-17T00:00:03.000Z' WHERE id = 'global';
