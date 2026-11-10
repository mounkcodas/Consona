CREATE TABLE social_custom_emojis (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,pack TEXT NOT NULL DEFAULT '',mime TEXT NOT NULL,media_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(owner_id,name));
CREATE INDEX idx_custom_emojis_owner ON social_custom_emojis(owner_id,pack,name);
