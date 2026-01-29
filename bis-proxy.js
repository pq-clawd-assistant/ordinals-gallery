// Best in Slot proxy + simple SQLite-backed galleries API
//
// This file is intended to be deployed on Railway / Render / any Node host.
// It exposes:
//   - GET  /wallet/inscriptions  -> thin proxy to api.bestinslot.xyz
//   - POST /galleries            -> create a named gallery for a wallet
//   - GET  /galleries/:id        -> fetch a read-only gallery by id
//
// Galleries are designed to be minimal and stable:
//   - Stored in a local SQLite database (file path configurable via DATABASE_URL)
//   - Tied to a wallet address (string only, no on-chain auth performed here)
//   - Store the selected inscriptions as a JSON blob so viewers do not need
//     to re-hit the Best in Slot API.

import express from 'express';
import fetch from 'node-fetch';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;
const BIS_API_KEY = process.env.BIS_API_KEY || '95bd3666-917f-4305-9d35-caefa0a70d07';
const BIS_BASE = 'https://api.bestinslot.xyz/v3';

// ----------------------------------------
// SQLite setup
// ----------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GALLERIES_DB_PATH can point at a Railway volume (e.g. /data/galleries.sqlite)
// or fall back to a local file next to this script.
const DB_PATH = process.env.GALLERIES_DB_PATH || path.join(__dirname, 'galleries.sqlite');

// Task inbox path (for simple shared tasks UI)
const TASKS_PATH = process.env.TASKS_PATH || path.join(__dirname, 'tasks.json');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open SQLite database', err);
    process.exit(1);
  }
  console.log('SQLite database opened at', DB_PATH);
});

// Create galleries table if it does not exist yet.
// Schema is intentionally simple and stable.
// - inscription_ids: comma-separated list of inscription ids for quick debugging
// - inscriptions_json: full JSON array of inscription objects as sent by frontend

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      name TEXT NOT NULL,
      inscription_ids TEXT NOT NULL,
      inscriptions_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    (err) => {
      if (err) {
        console.error('Failed to create galleries table', err);
      } else {
        console.log('Ensured galleries table exists');
      }
    }
  );
});

// ----------------------------------------
// Middleware
// ----------------------------------------

app.use(express.json({ limit: '1mb' }));

// Very small CORS helper suitable for a single frontend origin or GitHub Pages.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// ----------------------------------------
// Best in Slot proxy
// ----------------------------------------

app.get('/wallet/inscriptions', async (req, res) => {
  const {
    address,
    sort_by = 'inscr_num',
    order = 'desc',
    offset = '0',
    count = '2000',
    exclude_brc20 = 'false',
  } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Missing address' });
  }

  const url = `${BIS_BASE}/wallet/inscriptions?address=${encodeURIComponent(
    address
  )}&sort_by=${sort_by}&order=${order}&offset=${offset}&count=${count}&exclude_brc20=${exclude_brc20}`;

  try {
    const bisRes = await fetch(url, {
      headers: {
        'x-api-key': BIS_API_KEY,
        Accept: 'application/json',
      },
    });

    const body = await bisRes.text();

    if (!bisRes.ok) {
      return res.status(bisRes.status).send(body);
    }

    res.type('application/json').send(body);
  } catch (err) {
    console.error('BIS proxy error:', err);
    res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
});

// ----------------------------------------
// Galleries API
// ----------------------------------------

// Shape of a gallery in the database / API:
// {
//   id: string,
//   address: string,
//   name: string,
//   inscriptionCount: number,
//   createdAt: string (ISO-ish),
//   inscriptions: Array<Inscription>
// }
//
// Inscription objects are passed through from the frontend and *not* validated
// in detail here; the gallery endpoint is simply a durable store for whatever
// subset the user chose.

// List galleries for an address (metadata only)
app.get('/galleries', (req, res) => {
  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid address' });
  }

  db.all(
    'SELECT id, address, name, inscription_ids, created_at FROM galleries WHERE address = ? ORDER BY created_at DESC',
    [address],
    (err, rows) => {
      if (err) {
        console.error('Failed to list galleries', err);
        return res.status(500).json({ error: 'Failed to list galleries' });
      }

      const galleries = (rows || []).map((row) => ({
        id: String(row.id),
        address: row.address,
        name: row.name,
        inscriptionCount: (row.inscription_ids || '').split(',').filter(Boolean).length,
        createdAt: row.created_at,
      }));

      res.json({ address, galleries });
    }
  );
});

app.post('/galleries', (req, res) => {
  const { address, name, inscriptions } = req.body || {};

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid address' });
  }
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid name' });
  }
  if (!Array.isArray(inscriptions) || inscriptions.length === 0) {
    return res.status(400).json({ error: 'Gallery must contain at least one inscription' });
  }

  // Light-size guard rails; this is not a hard protocol guarantee, just a
  // safety valve for the shared Railway instance.
  if (inscriptions.length > 200) {
    return res.status(400).json({ error: 'Gallery too large (max 200 inscriptions)' });
  }

  const inscriptionIds = inscriptions
    .map((i) => (i && typeof i.id === 'string' ? i.id : null))
    .filter(Boolean);

  if (inscriptionIds.length === 0) {
    return res.status(400).json({ error: 'No valid inscription ids provided' });
  }

  const inscriptionsJson = JSON.stringify(inscriptions);

  const stmt = db.prepare(
    'INSERT INTO galleries (address, name, inscription_ids, inscriptions_json) VALUES (?, ?, ?, ?)'
  );

  stmt.run(address, name, inscriptionIds.join(','), inscriptionsJson, function (err) {
    if (err) {
      console.error('Failed to insert gallery', err);
      return res.status(500).json({ error: 'Failed to save gallery' });
    }

    const id = String(this.lastID);

    db.get('SELECT created_at FROM galleries WHERE id = ?', [id], (getErr, row) => {
      if (getErr) {
        console.error('Failed to read back gallery metadata', getErr);
      }

      res.status(201).json({
        id,
        address,
        name,
        inscriptionCount: inscriptionIds.length,
        createdAt: row?.created_at || null,
      });
    });
  });
});

app.get('/galleries/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM galleries WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Failed to load gallery', err);
      return res.status(500).json({ error: 'Failed to load gallery' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Gallery not found' });
    }

    let inscriptions = [];
    try {
      inscriptions = JSON.parse(row.inscriptions_json || '[]');
    } catch (parseErr) {
      console.error('Failed to parse inscriptions_json for gallery', id, parseErr);
      return res.status(500).json({ error: 'Gallery data is corrupted' });
    }

    res.json({
      id: String(row.id),
      address: row.address,
      name: row.name,
      inscriptionCount: inscriptions.length,
      createdAt: row.created_at,
      inscriptions,
    });
  });
});

// Update a gallery (e.g. frames or name) – requires matching address
app.put('/galleries/:id', (req, res) => {
  const { id } = req.params;
  const { address, name, inscriptions } = req.body || {};

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid address' });
  }

  if (!Array.isArray(inscriptions) || inscriptions.length === 0) {
    return res.status(400).json({ error: 'Inscriptions array is required' });
  }

  const inscriptionIds = inscriptions
    .map((i) => (i && typeof i.id === 'string' ? i.id : null))
    .filter(Boolean);

  if (inscriptionIds.length === 0) {
    return res.status(400).json({ error: 'No valid inscription ids provided' });
  }

  const inscriptionsJson = JSON.stringify(inscriptions);

  db.get('SELECT address FROM galleries WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Failed to look up gallery for update', err);
      return res.status(500).json({ error: 'Failed to update gallery' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Gallery not found' });
    }

    if (row.address !== address) {
      return res.status(403).json({ error: 'Address does not own this gallery' });
    }

    const newName = typeof name === 'string' && name.trim() ? name.trim() : row.name;

    db.run(
      'UPDATE galleries SET name = ?, inscription_ids = ?, inscriptions_json = ? WHERE id = ?',
      [newName, inscriptionIds.join(','), inscriptionsJson, id],
      (updateErr) => {
        if (updateErr) {
          console.error('Failed to update gallery', updateErr);
          return res.status(500).json({ error: 'Failed to update gallery' });
        }

        return res.json({
          id: String(id),
          address,
          name: newName,
          inscriptionCount: inscriptionIds.length,
        });
      }
    );
  });
});

// Delete a gallery (requires matching address for lightweight auth)
app.delete('/galleries/:id', (req, res) => {
  const { id } = req.params;
  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid address' });
  }

  db.get('SELECT address FROM galleries WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Failed to look up gallery for delete', err);
      return res.status(500).json({ error: 'Failed to delete gallery' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Gallery not found' });
    }

    if (row.address !== address) {
      return res.status(403).json({ error: 'Address does not own this gallery' });
    }

    db.run('DELETE FROM galleries WHERE id = ?', [id], (deleteErr) => {
      if (deleteErr) {
        console.error('Failed to delete gallery', deleteErr);
        return res.status(500).json({ error: 'Failed to delete gallery' });
      }

      return res.status(204).send();
    });
  });
});

// ----------------------------------------
// Simple Tasks Inbox (for Craig)
// ----------------------------------------

// Serve a tiny HTML form for adding tasks
app.get('/tasks', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Craig's Task Inbox</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem 1.5rem; max-width: 480px; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin-bottom: 0.4rem; }
    p { font-size: 0.9rem; color: #444; margin: 0.25rem 0 0.75rem; }
    textarea { width: 100%; min-height: 4rem; margin: 0.5rem 0; padding: 0.5rem; font-family: inherit; font-size: 0.95rem; }
    button { padding: 0.5rem 1rem; font-size: 0.9rem; }
    .status { margin-top: 0.5rem; font-size: 0.85rem; color: #333; }
  </style>
</head>
<body>
  <h1>Add a task for Craig</h1>
  <p>Type something Craig should remember or do. It goes into his shared task inbox.</p>
  <textarea id="taskText" placeholder="e.g. Book dentist for Craig next week"></textarea>
  <br />
  <button id="submitBtn">Add task</button>
  <div id="status" class="status"></div>
  <script>
    const btn = document.getElementById('submitBtn');
    const textEl = document.getElementById('taskText');
    const statusEl = document.getElementById('status');
    btn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text) {
        statusEl.textContent = 'Please enter a task.';
        return;
      }
      btn.disabled = true;
      statusEl.textContent = 'Saving...';
      try {
        const resp = await fetch('/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok) {
          throw new Error(data?.error || 'Failed to save task');
        }
        statusEl.textContent = 'Task added.';
        textEl.value = '';
      } catch (err) {
        statusEl.textContent = 'Error: ' + (err.message || 'Failed to save task');
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

// JSON API to append a task to tasks.json
app.post('/tasks', (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'Missing or empty text' });
  }

  let tasks = [];
  try {
    if (fs.existsSync(TASKS_PATH)) {
      const raw = fs.readFileSync(TASKS_PATH, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) tasks = parsed;
    }
  } catch (e) {
    console.warn('Failed to read existing tasks.json, starting fresh', e);
    tasks = [];
  }

  const now = new Date().toISOString();
  const task = { id: now, text: text.trim(), createdAt: now };
  tasks.push(task);

  try {
    fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
    return res.status(201).json({ ok: true, task });
  } catch (err) {
    console.error('Failed to write tasks.json', err);
    return res.status(500).json({ ok: false, error: 'Failed to save task' });
  }
});

// JSON API to read all tasks (for local sync)
app.get('/tasks.json', (req, res) => {
  try {
    if (!fs.existsSync(TASKS_PATH)) {
      return res.json([]);
    }
    const raw = fs.readFileSync(TASKS_PATH, 'utf8');
    const tasks = JSON.parse(raw || '[]');
    if (!Array.isArray(tasks)) return res.json([]);
    res.json(tasks);
  } catch (err) {
    console.error('Failed to read tasks.json', err);
    res.status(500).json({ error: 'Failed to read tasks' });
  }
});

// ----------------------------------------
// Startup
// ----------------------------------------

app.listen(PORT, () => {
  console.log(`BIS proxy + galleries API listening on port ${PORT}`);
});
