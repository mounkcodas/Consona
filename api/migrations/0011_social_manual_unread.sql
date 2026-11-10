ALTER TABLE conversation_members ADD COLUMN manual_unread INTEGER NOT NULL DEFAULT 0 CHECK (manual_unread IN (0, 1));
