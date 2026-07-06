const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dropzone.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');  // safe with WAL, flushes on checkpoint

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('text','image','video','audio','file')),
    body TEXT,
    filename TEXT,
    mime_type TEXT,
    file_size INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    item_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (item_id, tag),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
`);

// Migration: transcript columns for audio items
// transcript_status: NULL (n/a) | 'pending' | 'done' | 'error'
const itemCols = db.prepare(`PRAGMA table_info(items)`).all().map(c => c.name);
if (!itemCols.includes('transcript')) {
  db.exec(`
    ALTER TABLE items ADD COLUMN transcript TEXT;
    ALTER TABLE items ADD COLUMN transcript_status TEXT;
  `);
}

const stmts = {
  insertItem: db.prepare(`
    INSERT INTO items (id, type, body, filename, mime_type, file_size)
    VALUES (@id, @type, @body, @filename, @mime_type, @file_size)
  `),
  insertTag: db.prepare(`INSERT INTO tags (item_id, tag) VALUES (?, ?)`),
  getItem: db.prepare(`SELECT * FROM items WHERE id = ?`),
  deleteItem: db.prepare(`DELETE FROM items WHERE id = ?`),
  getTagsForItem: db.prepare(`SELECT tag FROM tags WHERE item_id = ?`),
  getAllTags: db.prepare(`
    SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC
  `),
  deleteTagsForItem: db.prepare(`DELETE FROM tags WHERE item_id = ?`),
};

function createItem({ id, type, body, filename, mime_type, file_size, tags }) {
  const insert = db.transaction(() => {
    stmts.insertItem.run({ id, type, body: body || null, filename: filename || null, mime_type: mime_type || null, file_size: file_size || null });
    if (tags && tags.length) {
      for (const tag of tags) {
        stmts.insertTag.run(id, tag);
      }
    }
  });
  insert();
  return getItem(id);
}

function getItem(id) {
  const item = stmts.getItem.get(id);
  if (!item) return null;
  item.tags = stmts.getTagsForItem.all(id).map(r => r.tag);
  return item;
}

function listItems({ cursor, limit = 20, tag, excludeTags }) {
  let sql = 'SELECT items.* FROM items';
  const params = [];
  const where = [];

  if (tag) {
    sql += ' INNER JOIN tags ON tags.item_id = items.id AND tags.tag = ?';
    params.push(tag);
  }

  if (excludeTags && excludeTags.length) {
    const placeholders = excludeTags.map(() => '?').join(',');
    where.push(`items.id NOT IN (SELECT item_id FROM tags WHERE tag IN (${placeholders}))`);
    params.push(...excludeTags);
  }

  if (cursor) {
    where.push('items.created_at < ?');
    params.push(cursor);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += ' ORDER BY items.created_at DESC LIMIT ?';
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const items = rows.map(item => {
    item.tags = stmts.getTagsForItem.all(item.id).map(r => r.tag);
    return item;
  });

  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null;
  return { items, nextCursor };
}

function deleteItem(id) {
  const item = stmts.getItem.get(id);
  if (!item) return null;
  stmts.deleteItem.run(id);
  return item;
}

function getAllTags({ excludeTags } = {}) {
  if (excludeTags && excludeTags.length) {
    const placeholders = excludeTags.map(() => '?').join(',');
    return db.prepare(`
      SELECT tag, COUNT(*) as count FROM tags
      WHERE tag NOT IN (${placeholders})
      GROUP BY tag ORDER BY count DESC, tag ASC
    `).all(...excludeTags);
  }
  return stmts.getAllTags.all();
}

function setTags(itemId, tags) {
  const update = db.transaction(() => {
    stmts.deleteTagsForItem.run(itemId);
    for (const tag of tags) {
      stmts.insertTag.run(itemId, tag);
    }
  });
  update();
  return getItem(itemId);
}

function setTranscriptStatus(id, status) {
  db.prepare(`UPDATE items SET transcript_status = ? WHERE id = ?`).run(status, id);
}

function setTranscript(id, transcript, status) {
  db.prepare(`UPDATE items SET transcript = ?, transcript_status = ? WHERE id = ?`).run(transcript, status, id);
}

// Audio items interrupted mid-transcription by a restart. Recordings from
// before this feature (status NULL) are deliberately left alone.
function getPendingTranscriptions() {
  return db.prepare(`
    SELECT id, filename FROM items
    WHERE type = 'audio' AND filename IS NOT NULL
      AND transcript_status = 'pending'
    ORDER BY created_at ASC
  `).all();
}

function close() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('Database closed cleanly.');
  } catch (err) {
    console.error('Error closing database:', err);
  }
}

module.exports = { createItem, getItem, listItems, deleteItem, getAllTags, setTags, setTranscriptStatus, setTranscript, getPendingTranscriptions, close };
