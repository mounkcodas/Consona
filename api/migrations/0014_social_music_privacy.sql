ALTER TABLE user_social_settings ADD COLUMN share_favorites INTEGER NOT NULL DEFAULT 0 CHECK(share_favorites IN (0,1));
