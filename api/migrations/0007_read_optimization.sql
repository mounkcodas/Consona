-- Cache revisions are transactional, so edits and FK cascades cannot leave stale cache keys.
CREATE TABLE IF NOT EXISTS library_revision (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO library_revision(id,revision) VALUES(1,1);
CREATE TABLE IF NOT EXISTS user_library_revision (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO user_library_revision(user_id) SELECT id FROM users;
CREATE TRIGGER IF NOT EXISTS cache_user_insert AFTER INSERT ON users BEGIN
  INSERT OR IGNORE INTO user_library_revision(user_id) VALUES(NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS cache_user_profile AFTER UPDATE OF display_name,avatar_key ON users
WHEN OLD.display_name IS NOT NEW.display_name OR OLD.avatar_key IS NOT NEW.avatar_key BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_delete AFTER DELETE ON users BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_tracks_insert AFTER INSERT ON tracks
WHEN NEW.import_batch_id IS NULL BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_tracks_update AFTER UPDATE ON tracks
WHEN OLD.import_batch_id IS NULL OR NEW.import_batch_id IS NULL BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_tracks_delete AFTER DELETE ON tracks
WHEN OLD.import_batch_id IS NULL BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_albums_insert AFTER INSERT ON albums
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_albums_update AFTER UPDATE ON albums
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_albums_delete AFTER DELETE ON albums
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_album_tracks_insert AFTER INSERT ON album_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_album_tracks_update AFTER UPDATE ON album_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_album_tracks_delete AFTER DELETE ON album_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlists_insert AFTER INSERT ON playlists
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlists_update AFTER UPDATE ON playlists
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlists_delete AFTER DELETE ON playlists
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlist_tracks_insert AFTER INSERT ON playlist_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlist_tracks_update AFTER UPDATE ON playlist_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_playlist_tracks_delete AFTER DELETE ON playlist_tracks
 BEGIN
  UPDATE library_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_favorites_insert AFTER INSERT ON user_favorites BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_favorites_update AFTER UPDATE ON user_favorites BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=OLD.user_id AND OLD.user_id<>NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_favorites_delete AFTER DELETE ON user_favorites BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_history_insert AFTER INSERT ON user_history BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_history_update AFTER UPDATE ON user_history BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=NEW.user_id;
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=OLD.user_id AND OLD.user_id<>NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS cache_user_history_delete AFTER DELETE ON user_history BEGIN
  UPDATE user_library_revision SET revision=revision+1 WHERE user_id=OLD.user_id;
END;

-- Reverse foreign keys and selective import lookups prevent scans during edits/deletes.
CREATE INDEX IF NOT EXISTS idx_album_tracks_track ON album_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_user_history_track ON user_history(track_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_track ON user_favorites(track_id);
CREATE INDEX IF NOT EXISTS idx_history_track ON history(track_id);
CREATE INDEX IF NOT EXISTS idx_tracks_added_by ON tracks(added_by);
CREATE INDEX IF NOT EXISTS idx_albums_added_by ON albums(added_by);
CREATE INDEX IF NOT EXISTS idx_playlists_added_by ON playlists(added_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_user ON import_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_import_batch ON tracks(import_batch_id,added_by) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_published_created ON tracks(created_at DESC) WHERE import_batch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_published_hash ON tracks(content_hash) WHERE import_batch_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_history_covering ON user_history(user_id,played_at DESC,id DESC,track_id);
PRAGMA optimize;
