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

// DATABASE_URL can be either a full SQLite URI ("file:..."), or a plain
// filesystem path. Fallback to a local file next to this script.
const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'galleries.sqlite');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

// ----------------------------------------
// Startup
// ----------------------------------------

app.listen(PORT, () => {
  console.log(`BIS proxy + galleries API listening on port ${PORT}`);
});
