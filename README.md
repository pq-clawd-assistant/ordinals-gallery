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

## How It Works

The gallery uses the [Hiro Ordinals API](https://docs.hiro.so/ordinals) to fetch inscription data:

1. User enters a Bitcoin wallet address (taproot, segwit, or legacy)
2. App queries the API: `GET /ordinals/v1/inscriptions?address={address}`
3. Results are displayed in a responsive grid
4. Click any inscription to view details and content
5. Pagination loads more results as needed

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

This app uses the Hiro Ordinals API:

| Endpoint | Purpose |
|----------|---------|
| `GET /ordinals/v1/inscriptions?address={addr}` | Fetch inscriptions by owner |
| `GET /ordinals/v1/inscriptions/{id}/content` | Get inscription content |

**Rate Limits:** 20 requests/second, 50 requests/minute (without API key)

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
