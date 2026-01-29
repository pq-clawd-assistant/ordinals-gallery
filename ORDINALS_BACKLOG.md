# Ordinals Gallery Backlog

Small, concrete tasks for Dev ticks. Always take the first unchecked item.

## UX & Feedback
- [ ] Replace gallery save `alert()` with an inline success toast/banner at the top of the page
- [ ] Show an inline error banner when saving a gallery fails (no reliance on console)
- [ ] Show an inline error banner when deleting a gallery fails
- [ ] After saving a gallery, briefly highlight its row in **My galleries** and scroll it into view
- [ ] Add a subtle "Copied!" tooltip/flash when the share URL is copied (instead of only `alert`)

## My Galleries & Sharing
- [ ] Add a simple rename flow for galleries (prompt for new name, `PUT /galleries/:id` or reuse POST semantics)
- [ ] Show the number of galleries for the connected wallet in the My Galleries header (e.g. "My galleries (3)")
- [ ] Persist and restore the last-opened gallery via localStorage so reloads land you back in context

## Browsing & Filters
- [ ] Add a sort dropdown above the gallery grid: { Newest first (default), Oldest first, Inscription number }
- [ ] Add an optional filter chip for common mime groups (e.g. "Images", "Text", "Other") on top of current filter
- [ ] Show a small badge on cards for the gallery context (e.g. "In gallery: <name>") when viewing a gallery link

## Polish & Performance
- [ ] Add a loading skeleton state for inscription cards while BIS data is loading
- [ ] Cap the number of inscriptions rendered at once and add lazy-load (virtualize or simple "Load more" batches)
- [ ] Add basic error retry button when BIS or the proxy fails
