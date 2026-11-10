ALTER TABLE listening_sessions ADD COLUMN started_at INTEGER;
ALTER TABLE listening_sessions ADD COLUMN ended_at INTEGER;
ALTER TABLE listening_sessions ADD COLUMN history_json TEXT NOT NULL DEFAULT '[]';
