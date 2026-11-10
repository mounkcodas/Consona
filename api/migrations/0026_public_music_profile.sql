ALTER TABLE user_social_settings ADD COLUMN public_music_profile INTEGER NOT NULL DEFAULT 0 CHECK(public_music_profile IN (0,1));
