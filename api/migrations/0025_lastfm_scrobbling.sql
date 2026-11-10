CREATE TABLE social_lastfm_pending (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE social_lastfm_links (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,username TEXT NOT NULL,iv TEXT NOT NULL,ciphertext TEXT NOT NULL,connected_at INTEGER NOT NULL);
CREATE TABLE social_lastfm_scrobbles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,client_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,client_id));
