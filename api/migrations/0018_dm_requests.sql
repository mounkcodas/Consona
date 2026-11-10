ALTER TABLE user_social_settings ADD COLUMN dm_requests INTEGER NOT NULL DEFAULT 1 CHECK(dm_requests IN (0,1));
CREATE TABLE social_dm_requests (pair_id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('pending','accepted')),created_at INTEGER NOT NULL,CHECK(sender_id<>receiver_id));
CREATE INDEX idx_dm_request_receiver ON social_dm_requests(receiver_id,status,created_at DESC);
CREATE INDEX idx_dm_request_sender ON social_dm_requests(sender_id,status,created_at DESC);
