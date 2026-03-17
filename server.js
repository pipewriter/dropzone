const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DROPZONE_TOKEN;

if (!TOKEN) {
  console.error('DROPZONE_TOKEN environment variable is required');
  process.exit(1);
}

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer config
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const id = req._itemId || uuidv4();
    req._itemId = id;
    const ext = path.extname(file.originalname);
    cb(null, id + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (token !== TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Auth routes ---

app.post('/api/auth', express.json(), (req, res) => {
  const { token } = req.body;
  if (token !== TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// --- Item routes ---

app.post('/api/items', requireAuth, upload.single('file'), (req, res) => {
  try {
    const id = req._itemId || uuidv4();
    const tagsRaw = req.body.tags || '';
    const tags = tagsRaw
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    let type = req.body.type || 'text';
    let body = req.body.body || null;
    let filename = null;
    let mime_type = null;
    let file_size = null;

    if (req.file) {
      filename = req.file.filename;
      mime_type = req.file.mimetype;
      file_size = req.file.size;

      if (mime_type.startsWith('image/')) type = 'image';
      else if (mime_type.startsWith('video/')) type = 'video';
      else if (mime_type.startsWith('audio/')) type = 'audio';
      else type = 'file';
    }

    const item = db.createItem({ id, type, body, filename, mime_type, file_size, tags });
    res.status(201).json(item);
  } catch (err) {
    console.error('Create item error:', err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.get('/api/items', requireAuth, (req, res) => {
  const { cursor, limit, tag } = req.query;
  const result = db.listItems({
    cursor,
    limit: Math.min(parseInt(limit) || 20, 100),
    tag: tag || undefined
  });
  res.json(result);
});

app.get('/api/items/:id', requireAuth, (req, res) => {
  const item = db.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/items/:id', requireAuth, (req, res) => {
  const item = db.deleteItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  // Delete file if exists
  if (item.filename) {
    const filePath = path.join(uploadsDir, item.filename);
    fs.unlink(filePath, () => {}); // ignore errors
  }

  res.json({ ok: true });
});

app.patch('/api/items/:id/tags', requireAuth, (req, res) => {
  const { tags } = req.body;
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: 'tags must be an array' });
  }
  const item = db.getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const cleaned = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
  const updated = db.setTags(req.params.id, cleaned);
  res.json(updated);
});

// --- Tags ---

app.get('/api/tags', requireAuth, (req, res) => {
  res.json(db.getAllTags());
});

// --- File serving ---

app.get('/api/files/:id/:filename', requireAuth, (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  // Prevent directory traversal
  if (!filePath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.sendFile(filePath);
});

// SPA fallback - serve index.html for capture, feed.html for /feed
app.get('/feed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feed.html'));
});

app.get('/feed/:tag', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feed.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Dropzone running on http://localhost:${PORT}`);
});

// Graceful shutdown — close DB cleanly so WAL is checkpointed
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    require('./db').close();
    process.exit(0);
  });
  // Force exit after 5s if connections hang
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
