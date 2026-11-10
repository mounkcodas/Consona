ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL;
CREATE TABLE social_message_reactions (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL, PRIMARY KEY(message_id,user_id,emoji));
CREATE TABLE social_message_marks (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('pin','favorite')), PRIMARY KEY(message_id,user_id,kind));
CREATE INDEX idx_social_marks_user ON social_message_marks(user_id,kind,message_id);
