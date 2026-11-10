ALTER TABLE social_message_reactions ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0 CHECK(is_super IN (0,1));
ALTER TABLE social_group_reactions ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0 CHECK(is_super IN (0,1));
