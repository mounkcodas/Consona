-- Social data is private and deliberately independent of library cache revisions.
CREATE TABLE IF NOT EXISTS user_social_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requests TEXT NOT NULL DEFAULT 'everyone' CHECK(requests IN ('everyone','none')),
  messages TEXT NOT NULL DEFAULT 'friends' CHECK(messages IN ('friends','none')),
  show_presence INTEGER NOT NULL DEFAULT 1,
  show_activity INTEGER NOT NULL DEFAULT 0,
  share_history INTEGER NOT NULL DEFAULT 0,
  listening_invites TEXT NOT NULL DEFAULT 'friends' CHECK(listening_invites IN ('friends','none')),
  call_invites TEXT NOT NULL DEFAULT 'none' CHECK(call_invites IN ('friends','none')),
  presence TEXT NOT NULL DEFAULT 'online' CHECK(presence IN ('online','away','busy','invisible')),
  status_text TEXT NOT NULL DEFAULT '',
  browser_notifications INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS friend_requests (
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(sender_id,receiver_id), CHECK(sender_id<>receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id,created_at DESC);
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,friend_id), CHECK(user_id<>friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_reverse ON friendships(friend_id,user_id);
CREATE TABLE IF NOT EXISTS user_blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,blocked_id), CHECK(user_id<>blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_reverse ON user_blocks(blocked_id,user_id);
CREATE INDEX IF NOT EXISTS idx_users_social_name ON users(display_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  last_delivered_seq INTEGER NOT NULL DEFAULT 0,
  last_received_seq INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id,archived,conversation_id);
CREATE INDEX IF NOT EXISTS idx_members_peer ON conversation_members(peer_id);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_page ON messages(conversation_id,seq DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE VIRTUAL TABLE IF NOT EXISTS social_message_search USING fts5(body,content='messages',content_rowid='seq',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS social_search_insert AFTER INSERT ON messages BEGIN
  INSERT INTO social_message_search(rowid,body) VALUES(NEW.seq,NEW.body);
END;
CREATE TRIGGER IF NOT EXISTS social_search_delete AFTER DELETE ON messages BEGIN
  INSERT INTO social_message_search(social_message_search,rowid,body) VALUES('delete',OLD.seq,OLD.body);
END;
CREATE TRIGGER IF NOT EXISTS social_search_update AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO social_message_search(social_message_search,rowid,body) VALUES('delete',OLD.seq,OLD.body);
  INSERT INTO social_message_search(rowid,body) VALUES(NEW.seq,NEW.body);
END;
CREATE TABLE IF NOT EXISTS social_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_attachment_cleanup ON social_attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_attachment_message ON social_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_social_attachment_owner ON social_attachments(owner_id);
CREATE INDEX IF NOT EXISTS idx_social_attachment_conversation ON social_attachments(conversation_id);
CREATE TABLE IF NOT EXISTS social_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_social_notifications_user ON social_notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_notifications_unread ON social_notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_notifications_actor ON social_notifications(actor_id);
CREATE INDEX IF NOT EXISTS idx_social_notifications_cleanup ON social_notifications(created_at) WHERE read_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS listening_sessions (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listening_host ON listening_sessions(host_id,status);
CREATE INDEX IF NOT EXISTS idx_listening_guest ON listening_sessions(guest_id,status);
CREATE TABLE IF NOT EXISTS social_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_social_reports_status ON social_reports(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_reports_reporter ON social_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_social_reports_target ON social_reports(target_id);
PRAGMA optimize;
