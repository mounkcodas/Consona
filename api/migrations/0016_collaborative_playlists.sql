CREATE TABLE social_collaborative_playlists (playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE social_playlist_collaborators (playlist_id TEXT NOT NULL REFERENCES social_collaborative_playlists(playlist_id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,added_at INTEGER NOT NULL,PRIMARY KEY(playlist_id,user_id));
CREATE INDEX idx_social_playlist_collaborators_user ON social_playlist_collaborators(user_id,playlist_id);
