# Bitcoin Ordinals Gallery

A clean, responsive web application to view Bitcoin ordinals inscriptions held by any wallet address.

![Gallery Preview](https://via.placeholder.com/800x400/1a1a1a/f7931a?text=Ordinals+Gallery)

## Features

- 🔍 **Address Search** - Enter any Bitcoin address to view its inscriptions
- 🖼️ **Visual Gallery** - Grid layout with thumbnails for images
- 📄 **Content Preview** - Text/JSON inscriptions displayed inline
- 🏷️ **Content Filtering** - Filter by type: Images, Text/JSON, HTML, Other
- 📊 **Statistics** - Overview of inscription counts by type
- 🔎 **Detail Modal** - Click any inscription for full details
- 📱 **Responsive** - Works on desktop and mobile
- ⚡ **Client-Side** - No backend required, runs entirely in browser

## How It Works (current setup)

### Frontend (GitHub Pages)

Right now the **browser app** uses the [Hiro Ordinals API](https://docs.hiro.so/ordinals) because it is CORS-friendly for static sites:

1. User enters a Bitcoin wallet address (taproot, segwit, or legacy)
2. App queries Hiro: `GET /ordinals/v1/inscriptions?address={address}&offset={offset}&limit=60`
3. It discovers the `total` from the first page, then walks pages until it has everything Hiro reports
4. Results are displayed in a responsive grid with filters and a detail modal

### Backend (planned)

Hiro under‑indexes some wallets (e.g. Craig’s), so we also use [Best in Slot](https://docs.bestinslot.xyz/) **server‑side only** via a small proxy (see `bis-proxy.example.js`). The plan is:

- Frontend → our proxy → Best in Slot API
- Proxy adds proper CORS headers and keeps the Best in Slot API key secret
- Frontend never calls `api.bestinslot.xyz` directly (avoids CORS failures)

Until that proxy is live, the public site stays on Hiro for stability.

## Supported Address Types

- **Taproot (bc1p...)** - Most common for ordinals
- **Native SegWit (bc1q...)**
- **Legacy P2PKH (1...)**
- **Legacy P2SH (3...)**

## Usage

### Quick Start

1. Open `index.html` in any modern browser
2. Enter a Bitcoin address in the search box
3. Press Enter or click "Search"
4. Browse the inscription gallery

### URL Parameters

You can link directly to an address:
```
index.html?address=bc1p...your-address-here
```

### Testing

Try these example addresses with inscriptions:
- Copy an address from [ordinals.com](https://ordinals.com) to test

## File Structure

```
ordinals-gallery/
├── index.html    # Main HTML page
├── styles.css    # Styling (dark theme, responsive)
├── app.js        # Application logic
└── README.md     # This file
```

## API Reference

### Browser (Hiro)

The live GitHub Pages app talks directly to the Hiro Ordinals API:

| Endpoint | Purpose |
|----------|---------|
| `GET /ordinals/v1/inscriptions?address={addr}&offset={offset}&limit=60` | Fetch inscriptions by owner (paged) |
| `GET /ordinals/v1/inscriptions/{id}/content` | Get inscription content |

> Note: For some wallets, Hiro currently reports fewer inscriptions than Best in Slot.

### Backend / Proxy (Best in Slot)

Planned / server-side only (see `bis-proxy.example.js`):

| Endpoint (upstream) | Purpose |
|---------------------|---------|
| `GET https://api.bestinslot.xyz/v3/wallet/inscriptions?...` | Rich inscription data by wallet address |

The proxy exposes a browser-safe endpoint, for example:

| Proxy Endpoint | Purpose |
|----------------|---------|
| `GET /wallet/inscriptions?address={addr}` | For the frontend to call (adds CORS + hides API key) |

## Customization

### Theme Colors

Edit CSS variables in `styles.css`:
```css
:root {
    --bg-primary: #0d0d0d;
    --accent: #f7931a;  /* Bitcoin orange */
    /* ... */
}
```

### Page Size

Adjust items per page in `app.js`:
```javascript
const CONFIG = {
    PAGE_SIZE: 20,  // Change this
    // ...
};
```

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

Requires JavaScript enabled.

## License

MIT - Free to use and modify.

## Links

- [Hiro Ordinals API Docs](https://docs.hiro.so/ordinals)
- [Ordinals Protocol](https://docs.ordinals.com/)
- [ordinals.com Explorer](https://ordinals.com)
