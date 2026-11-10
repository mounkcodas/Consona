ALTER TABLE social_custom_emojis ADD COLUMN type TEXT NOT NULL DEFAULT 'emoji' CHECK(type IN ('emoji','sticker'));
