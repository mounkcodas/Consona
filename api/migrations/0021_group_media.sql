ALTER TABLE social_group_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE social_group_messages ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
