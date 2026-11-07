CREATE TABLE IF NOT EXISTS discovery_album_covers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artwork_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Cover Art Archive',
  source_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS discovery_cover_refresh (
  id INTEGER PRIMARY KEY CHECK (id=1),
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO discovery_cover_refresh (id,lease_until) VALUES (1,0);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('f32fab67-77dd-3937-addc-9062e28e4c37','Thriller','Michael Jackson','https://musicbrainz.org/release-group/f32fab67-77dd-3937-addc-9062e28e4c37',0);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('f5093c06-23e3-404f-aeaa-40f72885ee3a','The Dark Side of the Moon','Pink Floyd','https://musicbrainz.org/release-group/f5093c06-23e3-404f-aeaa-40f72885ee3a',1);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6','Rumours','Fleetwood Mac','https://musicbrainz.org/release-group/416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6',2);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('1b022e01-4da6-387b-8658-8678046e4cef','Nevermind','Nirvana','https://musicbrainz.org/release-group/1b022e01-4da6-387b-8658-8678046e4cef',3);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('b1392450-e666-3926-a536-22c65f834433','OK Computer','Radiohead','https://musicbrainz.org/release-group/b1392450-e666-3926-a536-22c65f834433',4);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('48117b90-a16e-34ca-a514-19c702df1158','Discovery','Daft Punk','https://musicbrainz.org/release-group/48117b90-a16e-34ca-a514-19c702df1158',5);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('08aa7a6c-3e43-4459-87b2-e47faf3a088a','Currents','Tame Impala','https://musicbrainz.org/release-group/08aa7a6c-3e43-4459-87b2-e47faf3a088a',6);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('d9103c72-3807-4378-9ce7-b6f3e8fdd547','To Pimp a Butterfly','Kendrick Lamar','https://musicbrainz.org/release-group/d9103c72-3807-4378-9ce7-b6f3e8fdd547',7);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('4b16a1bc-8644-48ae-9b3e-8ae36aa30cfc','Born to Die','Lana Del Rey','https://musicbrainz.org/release-group/4b16a1bc-8644-48ae-9b3e-8ae36aa30cfc',8);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('be161b2c-ec5c-3102-8e0b-374a29cc5113','Clube da Esquina','Milton Nascimento','https://musicbrainz.org/release-group/be161b2c-ec5c-3102-8e0b-374a29cc5113',9);
INSERT OR IGNORE INTO discovery_album_covers (id,title,artist,source_url,position) VALUES ('8691d12c-abd8-385c-b1eb-d841190124f7','The Miseducation of Lauryn Hill','Lauryn Hill','https://musicbrainz.org/release-group/8691d12c-abd8-385c-b1eb-d841190124f7',10);
