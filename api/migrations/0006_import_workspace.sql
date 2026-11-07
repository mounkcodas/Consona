ALTER TABLE tracks ADD COLUMN primary_album_id TEXT REFERENCES albums(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN content_hash TEXT;
ALTER TABLE tracks ADD COLUMN import_batch_id TEXT;
ALTER TABLE tracks ADD COLUMN import_item_key TEXT;
CREATE INDEX idx_tracks_primary_album ON tracks(primary_album_id);
CREATE INDEX idx_tracks_content_hash ON tracks(content_hash);
CREATE UNIQUE INDEX idx_import_track_retry ON tracks(added_by,import_batch_id,import_item_key) WHERE import_batch_id IS NOT NULL;
UPDATE tracks SET primary_album_id=(SELECT album_id FROM album_tracks WHERE track_id=tracks.id ORDER BY position,album_id LIMIT 1);
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL,
  committed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS import_assets (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  media_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id,batch_id,item_key)
);
