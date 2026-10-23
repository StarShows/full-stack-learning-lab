CREATE TABLE reminder_keys (
 id INTEGER PRIMARY KEY CHECK(id=1),
 private_key TEXT NOT NULL
);
CREATE TABLE reminder_subscriptions (
 endpoint TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL
);
CREATE INDEX reminder_devices_user ON reminder_subscriptions(user_id);
CREATE TABLE reminder_deliveries (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 at INTEGER NOT NULL,
 PRIMARY KEY(user_id,day)
);
