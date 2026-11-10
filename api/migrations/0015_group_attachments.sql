ALTER TABLE social_group_messages ADD COLUMN attachment_id TEXT;
CREATE TABLE social_group_attachments (id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message_id TEXT REFERENCES social_group_messages(id) ON DELETE CASCADE,media_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX idx_group_attachment_cleanup ON social_group_attachments(created_at) WHERE message_id IS NULL;
