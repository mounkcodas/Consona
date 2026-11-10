ALTER TABLE social_group_messages ADD COLUMN media_spoiler INTEGER NOT NULL DEFAULT 0 CHECK(media_spoiler IN (0,1));
