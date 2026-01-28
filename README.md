# Bitcoin Ordinals Gallery

A clean, responsive web application to view Bitcoin ordinals inscriptions held by any wallet address.

![Gallery Preview](https://via.placeholder.com/800x400/1a1a1a/f7931a?text=Ordinals+Gallery)

## Features

- 🔐 **Wallet Connect (LaserEyes)** - Connect and verify your own Bitcoin wallet (no manual address entry)
- 🔍 **Address Search** - (Optional, dev-only) legacy address search still supported when enabled
- 🖼️ **Visual Gallery** - Grid layout with thumbnails for images
- 📄 **Content Preview** - Text/JSON inscriptions displayed inline
- 🏷️ **Content Filtering** - Filter by type: Images, Text/JSON, HTML, Other
- 📊 **Statistics** - Overview of inscription counts by type
- 🔎 **Detail Modal** - Click any inscription for full details
- 📱 **Responsive** - Works on desktop and mobile
- ⚡ **Client-Side** - No backend required, runs entirely in browser

## How It Works (current setup)

### Auth / Wallet Flow (LaserEyes)

The gallery now uses the LaserEyes wallet connector (see `static/js/lasereyes-bundle.js` and `static/js/wallet.js`) instead of asking users to paste addresses:

1. User clicks **Connect Wallet** in the gallery UI.
2. LaserEyes shows a wallet picker (UniSat, Xverse, Leather, OYL, Phantom, Magic Eden, OKX, Wizz).
3. The selected wallet connects and returns the active Bitcoin address.
4. The user is prompted to **sign a verification message**. We store the address + signature in `localStorage`.
5. After a successful signature, the app automatically loads inscriptions for the verified address.

The wallet state is also restored from `localStorage` on page load, so a previously verified session will reconnect automatically and reload the gallery.

### Data Source (Best in Slot via proxy)

The gallery reads inscriptions via our Best in Slot (BIS) proxy (see `bis-proxy.example.js`):

- Frontend → **BIS proxy** → Best in Slot API
- Proxy adds proper CORS headers and keeps the Best in Slot API key secret
- Frontend never calls `api.bestinslot.xyz` directly (avoids CORS failures)

The main endpoint in use is:

- `GET /wallet/inscriptions?address={addr}&sort_by=inscr_num&order=desc&offset=0&count=2000&exclude_brc20=false`

Only the **verified wallet address** from LaserEyes is used when calling this proxy in the production flow.

## Supported Address Types

- **Taproot (bc1p...)** - Most common for ordinals
- **Native SegWit (bc1q...)**
- **Legacy P2PKH (1...)**
- **Legacy P2SH (3...)**

## Usage

### Quick Start (Wallet Connect)

1. Open `index.html` in any modern browser.
2. Click **Connect Wallet**.
3. Pick your preferred Bitcoin wallet in the LaserEyes modal.
4. Approve the connection and sign the verification message.
5. The gallery will automatically load all inscriptions for your verified address.

### Optional: Legacy Address Search (dev/testing only)

The code still contains a legacy "manual address" path for local testing and debugging. In the production UI this is hidden; inscriptions are fetched **only** for the connected + signed wallet address.

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

### Backend / Proxy (Best in Slot)

The gallery talks to Best in Slot **only** through a small backend proxy (see `bis-proxy.example.js`):

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
