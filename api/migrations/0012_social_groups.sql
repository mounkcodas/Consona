CREATE TABLE social_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE social_group_members (group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_read_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id,user_id));
CREATE INDEX idx_social_group_members_user ON social_group_members(user_id,group_id);
CREATE TABLE social_group_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE, sender_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER, deleted_at INTEGER, UNIQUE(group_id,sender_id,client_id));
CREATE INDEX idx_social_group_messages_page ON social_group_messages(group_id,seq DESC);
