// Minimal Best in Slot proxy (Node + Express-style) for server-side use.
// This is NOT used by the GitHub Pages frontend directly; you deploy this
// somewhere with Node (Render, Railway, Fly, your own VPS, etc.), then point
// the frontend at your proxy instead of api.bestinslot.xyz.

import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const BIS_API_KEY = process.env.BIS_API_KEY || '95bd3666-917f-4305-9d35-caefa0a70d07';
const BIS_BASE = 'https://api.bestinslot.xyz/v3';

app.get('/wallet/inscriptions', async (req, res) => {
  const { address, sort_by = 'inscr_num', order = 'desc', offset = '0', count = '2000', exclude_brc20 = 'false' } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Missing address' });
  }

  const url = `${BIS_BASE}/wallet/inscriptions?address=${encodeURIComponent(address)}&sort_by=${sort_by}&order=${order}&offset=${offset}&count=${count}&exclude_brc20=${exclude_brc20}`;

  try {
    const bisRes = await fetch(url, {
      headers: {
        'x-api-key': BIS_API_KEY,
        'Accept': 'application/json'
      }
    });

    const body = await bisRes.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (!bisRes.ok) {
      return res.status(bisRes.status).send(body);
    }

    res.type('application/json').send(body);
  } catch (err) {
    console.error('BIS proxy error:', err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
});

app.options('/wallet/inscriptions', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log(`BIS proxy listening on port ${PORT}`);
});
