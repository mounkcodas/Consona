-- Keep a search in one conversation from reading matches across every chat.
ALTER TABLE messages ADD COLUMN search_scope TEXT GENERATED ALWAYS AS (replace(replace(conversation_id,':',''),'-','')) VIRTUAL;
DROP TRIGGER IF EXISTS social_search_insert;
DROP TRIGGER IF EXISTS social_search_delete;
DROP TRIGGER IF EXISTS social_search_update;
DROP TABLE IF EXISTS social_message_search;
CREATE VIRTUAL TABLE social_message_search USING fts5(body,search_scope,content='messages',content_rowid='seq',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER social_search_insert AFTER INSERT ON messages BEGIN
  INSERT INTO social_message_search(rowid,body,search_scope) VALUES(NEW.seq,NEW.body,NEW.search_scope);
END;
CREATE TRIGGER social_search_delete AFTER DELETE ON messages BEGIN
  INSERT INTO social_message_search(social_message_search,rowid,body,search_scope) VALUES('delete',OLD.seq,OLD.body,OLD.search_scope);
END;
CREATE TRIGGER social_search_update AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO social_message_search(social_message_search,rowid,body,search_scope) VALUES('delete',OLD.seq,OLD.body,OLD.search_scope);
  INSERT INTO social_message_search(rowid,body,search_scope) VALUES(NEW.seq,NEW.body,NEW.search_scope);
END;
INSERT INTO social_message_search(social_message_search) VALUES('rebuild');
PRAGMA optimize;
