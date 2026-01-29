/**
 * Bitcoin Ordinals Gallery
 *
 * A client-side web application to view Bitcoin ordinals inscriptions
 * held by any Bitcoin wallet address.
 *
 * Uses the Hiro Ordinals API in the browser (Best in Slot planned via a backend proxy): https://docs.hiro.so/ordinals
 */

// ========================================
// Configuration
// ========================================

const CONFIG = {
    // Backend proxy for Best in Slot (Railway)
    PROXY_BASE: 'https://bis-proxy-production.up.railway.app',

    // Fallback Hiro Ordinals API base URL (not used by default in browser now)
    API_BASE: 'https://api.hiro.so/ordinals/v1',

    // Number of inscriptions to request from proxy/BIS
    PAGE_SIZE: 2000,

    // Content URL for viewing inscription content (fallback)
    CONTENT_URL: (id) => `https://ordinals.com/content/${id}`,

    // External links
    ORDINALS_COM: (id) => `https://ordinals.com/inscription/${id}`,

    // Supported image MIME types (display inline)
    IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'],

    // Text/JSON types (display as text)
    TEXT_TYPES: ['text/plain', 'application/json', 'text/json'],

    // HTML types (display in iframe)
    HTML_TYPES: ['text/html', 'application/xhtml+xml']
};

// ========================================
// State Management
// ========================================

const state = {
    // Address whose inscriptions are currently shown in the grid
    address: '',
    inscriptions: [],
    total: 0,
    offset: 0,
    loading: false,
    currentFilter: 'all',
    contentCache: new Map(),
    selectedIds: new Set(),
    currentGalleryId: null,
    viewingSharedGallery: false,
    sharedGalleryMeta: null,
    // Currently connected wallet (if any)
    connectedAddress: null,
    // Whether the currently viewed shared gallery belongs to connectedAddress
    ownsCurrentGallery: false
};

// ========================================
// DOM Elements (namespaced to avoid clashes with wallet.js)
// ========================================

const galleryElements = {
    addressInput: () => document.getElementById('addressInput'),
    searchBtn: () => document.getElementById('searchBtn'),
    statsSection: () => document.getElementById('statsSection'),
    filterSection: () => document.getElementById('filterSection'),
    gallery: () => document.getElementById('gallery'),
    loadingIndicator: () => document.getElementById('loadingIndicator'),
    errorMessage: () => document.getElementById('errorMessage'),
    loadMoreSection: () => document.getElementById('loadMoreSection'),
    loadMoreBtn: () => document.getElementById('loadMoreBtn'),
    modal: () => document.getElementById('modal'),
    modalBody: () => document.getElementById('modalBody'),
    totalCount: () => document.getElementById('totalCount'),
    imageCount: () => document.getElementById('imageCount'),
    textCount: () => document.getElementById('textCount'),
    otherCount: () => document.getElementById('otherCount'),
    showingCount: () => document.getElementById('showingCount'),
    totalInscriptions: () => document.getElementById('totalInscriptions'),
    // Gallery sharing elements
    galleryActions: () => document.getElementById('galleryActions'),
    saveGalleryBtn: () => document.getElementById('saveGalleryBtn'),
    selectionInfo: () => document.getElementById('selectionInfo'),
    sharedGalleryName: () => document.getElementById('sharedGalleryName'),
    sharedGalleryAddress: () => document.getElementById('sharedGalleryAddress'),
    sharedGalleryMeta: () => document.getElementById('sharedGalleryMeta'),
    // My galleries
    myGalleriesSection: () => document.getElementById('myGalleriesSection'),
    myGalleriesList: () => document.getElementById('myGalleriesList'),
    myGalleriesEmpty: () => document.getElementById('myGalleriesEmpty')
};

// ========================================
// API Functions
// ========================================

/**
 * Fetch inscriptions for a given address via our BIS proxy
 *
 * @param {string} address - Bitcoin wallet address
 * @param {number} offset - Ignored (proxy/BIS call is all-in-one)
 * @param {number} limit - Ignored (proxy/BIS call is all-in-one)
 * @returns {Promise<{results: Array, total: number}>}
 */
async function fetchInscriptions(address, offset = 0, limit = CONFIG.PAGE_SIZE) {
    const url = `${CONFIG.PROXY_BASE}/wallet/inscriptions?address=${encodeURIComponent(address)}&sort_by=inscr_num&order=desc&offset=0&count=${CONFIG.PAGE_SIZE}&exclude_brc20=false`;

    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Address not found or has no inscriptions');
        }
        if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        }
        throw new Error(`Proxy/BIS API error: ${response.status}`);
    }

    const data = await response.json();
    // Best in Slot returns { data: [ ... ], block_height: ... }
    const raw = Array.isArray(data.data) ? data.data : [];

    const results = raw.map(ins => ({
        id: ins.inscription_id,
        number: ins.inscription_number,
        mime_type: ins.mime_type || '',
        genesis_timestamp: ins.genesis_ts,
        genesis_block_height: ins.genesis_height,
        address: ins.owner_wallet_addr,
        content_url: ins.content_url,
        render_url: ins.render_url,
        bis_url: ins.bis_url,
        content_length: ins.output_value || 0,
        sat_rarity: 'Unknown'
    }));

    return {
        results,
        total: results.length
    };
}

/**
 * Fetch inscription content (for text types)
 * @param {string} inscriptionId - Inscription ID
 * @returns {Promise<string>}
 */
async function fetchInscriptionContent(inscriptionId) {
    // Check cache first
    if (state.contentCache.has(inscriptionId)) {
        return state.contentCache.get(inscriptionId);
    }

    const url = CONFIG.CONTENT_URL(inscriptionId);
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error('Failed to fetch content');
    }

    const text = await response.text();

    // Cache the result (limit cache size)
    if (state.contentCache.size > 100) {
        const firstKey = state.contentCache.keys().next().value;
        state.contentCache.delete(firstKey);
    }
    state.contentCache.set(inscriptionId, text);

    return text;
}

// ========================================
// UI Functions
// ========================================

/**
 * Show/hide loading indicator
 */
function setLoading(loading) {
    state.loading = loading;
    const loadingEl = galleryElements.loadingIndicator();
    if (loadingEl) {
        loadingEl.style.display = loading ? 'block' : 'none';
    }

    const btn = galleryElements.searchBtn ? galleryElements.searchBtn() : null;
    if (btn) {
        btn.disabled = loading;
        const btnText = btn.querySelector('.btn-text');
        const btnLoading = btn.querySelector('.btn-loading');
        if (btnText && btnLoading) {
            btnText.style.display = loading ? 'none' : 'inline';
            btnLoading.style.display = loading ? 'inline' : 'none';
        }
    }
}

/**
 * Show error message
 */
function showError(message) {
    const errorEl = galleryElements.errorMessage();
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function showToast(message, type = 'success', timeoutMs = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    toast.innerHTML = `
        <div class="toast-message">${escapeHtml(message)}</div>
        <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
    `;

    const close = () => {
        if (!toast.parentNode) return;
        toast.parentNode.removeChild(toast);
    };

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', close);
    }

    container.appendChild(toast);

    if (timeoutMs > 0) {
        setTimeout(close, timeoutMs);
    }
}

/**
 * Hide error message
 */
function hideError() {
    galleryElements.errorMessage().style.display = 'none';
}

/**
 * Update statistics display
 */
function updateStats() {
    const inscriptions = state.inscriptions;

    let imageCount = 0;
    let textCount = 0;
    let otherCount = 0;

    inscriptions.forEach(insc => {
        const type = getContentCategory(insc.mime_type);
        if (type === 'image') imageCount++;
        else if (type === 'text') textCount++;
        else otherCount++;
    });

    galleryElements.totalCount().textContent = state.total.toLocaleString();
    galleryElements.imageCount().textContent = imageCount.toLocaleString();
    galleryElements.textCount().textContent = textCount.toLocaleString();
    galleryElements.otherCount().textContent = otherCount.toLocaleString();

    galleryElements.showingCount().textContent = inscriptions.length.toLocaleString();
    galleryElements.totalInscriptions().textContent = state.total.toLocaleString();
}

/**
 * Get content category for a MIME type
 */
function getContentCategory(mimeType) {
    if (!mimeType) return 'other';
    if (CONFIG.IMAGE_TYPES.includes(mimeType)) return 'image';
    if (CONFIG.TEXT_TYPES.includes(mimeType) || mimeType.startsWith('text/')) return 'text';
    if (CONFIG.HTML_TYPES.includes(mimeType)) return 'html';
    return 'other';
}

/**
 * Get icon for content type
 */
function getTypeIcon(mimeType) {
    const category = getContentCategory(mimeType);
    const icons = {
        image: '🖼️',
        text: '📄',
        html: '🌐',
        other: '📦'
    };
    return icons[category] || '📦';
}

/**
 * Format file size
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format timestamp to readable date
 */
function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Truncate inscription ID for display
 */
function truncateId(id) {
    if (!id || id.length < 20) return id;
    return `${id.slice(0, 8)}...${id.slice(-8)}`;
}

// ========================================
// Card Rendering
// ========================================

/**
 * Create an inscription card element
 */
function createInscriptionCard(inscription) {
    const card = document.createElement('div');
    card.className = 'inscription-card';
    card.dataset.id = inscription.id;
    card.dataset.category = getContentCategory(inscription.mime_type);

    const category = getContentCategory(inscription.mime_type);
    const isSelected = state.selectedIds.has(inscription.id);

    if (isSelected) {
        card.classList.add('selected');
    }

    const isConnected = !!(state.connectedAddress || (window.WalletConnect && window.WalletConnect.isConnected && window.WalletConnect.isConnected()));
    const allowSelectionInShared = state.viewingSharedGallery && state.ownsCurrentGallery && isConnected;
    const allowSelectionInWalletView = !state.viewingSharedGallery && isConnected;
    const showSelectionToggle = allowSelectionInShared || allowSelectionInWalletView;

    const selectionToggleHtml = showSelectionToggle ? `
        <button class="selection-toggle" type="button" title="Select inscription">
            <span class="selection-checkbox">${isSelected ? '✓' : ''}</span>
        </button>
    ` : '';

    card.innerHTML = `
        <div class="inscription-preview">
            ${renderPreview(inscription, category)}
            <span class="mime-badge">${inscription.mime_type || 'unknown'}</span>
            ${selectionToggleHtml}
        </div>
        <div class="inscription-info">
            <div class="inscription-number">#${inscription.number?.toLocaleString() || 'N/A'}</div>
            <div class="inscription-id">${truncateId(inscription.id)}</div>
            <div class="inscription-meta">
                <span>${formatSize(inscription.content_length || 0)}</span>
                <span>${formatDate(inscription.genesis_timestamp)}</span>
            </div>
        </div>
    `;

    // Card click selects/deselects when selection is enabled; otherwise opens modal
    card.addEventListener('click', (event) => {
        if (event.target.closest && event.target.closest('.selection-toggle')) {
            return;
        }

        if (showSelectionToggle) {
            toggleInscriptionSelection(inscription.id);
        } else {
            openModal(inscription);
        }
    });

    if (showSelectionToggle) {
        const toggleBtn = card.querySelector('.selection-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleInscriptionSelection(inscription.id);
            });
        }
    }

    // Load text preview if applicable
    if (category === 'text') {
        loadTextPreview(card, inscription.id);
    }

    return card;
}

/**
 * Render preview based on content type
 */
function renderPreview(inscription, category) {
    const contentUrl = inscription.render_url || inscription.content_url || CONFIG.CONTENT_URL(inscription.id);

    switch (category) {
        case 'image':
            return `<img src="${contentUrl}" alt="Inscription #${inscription.number}" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'type-icon\\'>🖼️</span><span class=\\'mime-badge\\'>${inscription.mime_type}</span>'">`;

        case 'html':
            // Use sandbox for security
            return `<iframe src="${contentUrl}" sandbox="allow-scripts" loading="lazy"></iframe>`;

        case 'text':
            return `<div class="text-preview" data-inscription-id="${inscription.id}">Loading...</div>`;

        default:
            return `<span class="type-icon">${getTypeIcon(inscription.mime_type)}</span>`;
    }
}

/**
 * Load text preview for text inscriptions
 */
async function loadTextPreview(card, inscriptionId) {
    const previewEl = card.querySelector('.text-preview');
    if (!previewEl) return;

    try {
        const content = await fetchInscriptionContent(inscriptionId);

        // If the content looks like HTML/JS markup, render the inscription content in an iframe
        if (typeof content === 'string' && /<\s*(html|div|script)/i.test(content)) {
            const previewContainer = card.querySelector('.inscription-preview') || card;
            const contentUrl = CONFIG.CONTENT_URL(inscriptionId);
            previewContainer.innerHTML = `<iframe src="${contentUrl}" sandbox="allow-scripts" loading="lazy"></iframe>`;
            return;
        }

        // Otherwise show a truncated text preview
        const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content;
        previewEl.textContent = truncated;
    } catch (error) {
        previewEl.textContent = 'Unable to load preview';
    }
}

// ========================================
// Gallery Rendering
// ========================================

/**
 * Render all inscriptions to the gallery
 */
function renderGallery() {
    const gallery = galleryElements.gallery();
    gallery.innerHTML = '';

    const filtered = filterInscriptions(state.inscriptions);

    // Shared gallery: minimalist image-only grid with ordinals.com links
    if (state.viewingSharedGallery) {
        const isOwnerView = state.ownsCurrentGallery && !!state.connectedAddress;

        filtered.forEach((inscription) => {
            const category = getContentCategory(inscription.mime_type);
            const contentUrl = inscription.render_url || inscription.content_url || CONFIG.CONTENT_URL(inscription.id);
            const ordUrl = CONFIG.ORDINALS_COM(inscription.id);
            const frame = inscription.frame || 'none';

            const wrapper = document.createElement('a');
            wrapper.href = ordUrl;
            wrapper.target = '_blank';
            wrapper.rel = 'noopener noreferrer';
            wrapper.className = `shared-gallery-card frame-${frame}`;

            if (category === 'image') {
                const img = document.createElement('img');
                img.src = contentUrl;
                img.alt = `Inscription #${inscription.number}`;
                img.loading = 'lazy';
                wrapper.appendChild(img);
            } else {
                wrapper.innerHTML = `<div class="inscription-preview">${renderPreview(inscription, category)}</div>`;
            }

            // Owner-only frame selector overlay
            if (isOwnerView) {
                const frameSelector = document.createElement('div');
                frameSelector.className = 'frame-selector';
                frameSelector.innerHTML = `
                    <button type="button" data-frame="none" class="frame-chip ${frame === 'none' ? 'active' : ''}">None</button>
                    <button type="button" data-frame="black" class="frame-chip ${frame === 'black' ? 'active' : ''}">Black</button>
                    <button type="button" data-frame="gold" class="frame-chip ${frame === 'gold' ? 'active' : ''}">Gold</button>
                `;

                frameSelector.addEventListener('click', (event) => {
                    const btn = event.target.closest('button[data-frame]');
                    if (!btn) return;
                    event.preventDefault();
                    const newFrame = btn.dataset.frame;

                    inscription.frame = newFrame;
                    wrapper.className = `shared-gallery-card frame-${newFrame}`;

                    frameSelector.querySelectorAll('.frame-chip').forEach((chip) => {
                        chip.classList.toggle('active', chip === btn);
                    });
                });

                wrapper.appendChild(frameSelector);
            }

            gallery.appendChild(wrapper);
        });

        // No pagination controls or selection state in shared view
        galleryElements.loadMoreSection().style.display = 'none';
        updateSelectionInfo();
        return;
    }

    // Wallet view: full cards with overlays and metadata
    filtered.forEach((inscription, index) => {
        const card = createInscriptionCard(inscription);
        card.style.animationDelay = `${index * 0.05}s`;
        gallery.appendChild(card);
    });

    // Update load more section
    const hasMore = state.inscriptions.length < state.total;
    galleryElements.loadMoreSection().style.display = hasMore ? 'block' : 'none';

    updateSelectionInfo();
}

/**
 * Filter inscriptions based on current filter
 */
function filterInscriptions(inscriptions) {
    if (state.currentFilter === 'all') return inscriptions;
    return inscriptions.filter(insc => getContentCategory(insc.mime_type) === state.currentFilter);
}

// ========================================
// Gallery selection & sharing
// ========================================

function toggleInscriptionSelection(id) {
    if (!id) return;
    if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
    } else {
        state.selectedIds.add(id);
    }

    // Update card UI if present
    const card = document.querySelector(`.inscription-card[data-id="${id}"]`);
    if (card) {
        const checkbox = card.querySelector('.selection-checkbox');
        if (state.selectedIds.has(id)) {
            card.classList.add('selected');
            if (checkbox) checkbox.textContent = '✓';
        } else {
            card.classList.remove('selected');
            if (checkbox) checkbox.textContent = '';
        }
    }

    updateSelectionInfo();
}

function updateSelectionInfo() {
    const selectionInfoEl = galleryElements.selectionInfo && galleryElements.selectionInfo();
    const galleryActionsEl = galleryElements.galleryActions && galleryElements.galleryActions();
    const sharedMetaEl = galleryElements.sharedGalleryMeta && galleryElements.sharedGalleryMeta();

    if (!selectionInfoEl || !galleryActionsEl) return;

    const isConnected = !!(state.connectedAddress || (window.WalletConnect && window.WalletConnect.isConnected && window.WalletConnect.isConnected()));

    // Default: hide everything when not connected
    if (!isConnected) {
        galleryActionsEl.style.display = 'none';
        if (sharedMetaEl) sharedMetaEl.style.display = 'none';
        return;
    }

    const isOwnSharedGallery = state.viewingSharedGallery && state.ownsCurrentGallery;

    // When viewing a shared gallery that is not owned by the connected wallet,
    // hide selection + save UI, but show the shared gallery meta pill.
    if (state.viewingSharedGallery && !isOwnSharedGallery) {
        galleryActionsEl.style.display = 'none';
        if (sharedMetaEl) sharedMetaEl.style.display = 'inline-flex';
        return;
    }

    // Wallet view or own gallery: show selection UI; shared meta only when in shared mode
    galleryActionsEl.style.display = state.inscriptions.length > 0 ? 'flex' : 'none';
    if (sharedMetaEl) {
        sharedMetaEl.style.display = state.viewingSharedGallery ? 'inline-flex' : 'none';
    }

    const count = state.selectedIds.size;
    if (count === 0) {
        selectionInfoEl.textContent = 'No inscriptions selected';
    } else if (count === 1) {
        selectionInfoEl.textContent = '1 inscription selected';
    } else {
        selectionInfoEl.textContent = `${count} inscriptions selected`;
    }
}

async function saveCurrentSelectionAsGallery() {
    const connectedAddress = state.connectedAddress || (window.WalletConnect && window.WalletConnect.getAddress && window.WalletConnect.getAddress());
    if (!connectedAddress) {
        showError('Connect your wallet before saving a gallery');
        return;
    }

    if (state.address && connectedAddress !== state.address && !state.viewingSharedGallery) {
        // Safety: in wallet view, only allow saving galleries for the active wallet address.
        showError('You can only save galleries for your connected wallet address');
        return;
    }

    if (state.selectedIds.size === 0) {
        showError('Select at least one inscription to save a gallery');
        return;
    }

    const name = window.prompt('Name your gallery');
    if (!name) return;

    const selectedInscriptions = state.inscriptions.filter(ins => state.selectedIds.has(ins.id));

    try {
        const response = await fetch(`${CONFIG.PROXY_BASE}/galleries`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                address: connectedAddress,
                name,
                inscriptions: selectedInscriptions
            })
        });

        if (!response.ok) {
            const errPayload = await response.json().catch(() => null);
            const message = errPayload?.error || `Failed to save gallery (status ${response.status})`;
            throw new Error(message);
        }

        const data = await response.json();
        state.currentGalleryId = data.id;

        const shareUrl = new URL(window.location.href);
        shareUrl.searchParams.set('gallery', data.id);
        shareUrl.searchParams.delete('address');

        hideError();

        try {
            await navigator.clipboard.writeText(shareUrl.toString());
            showToast('Gallery saved. Share link copied to your clipboard.', 'success');
        } catch {
            showToast('Gallery saved. Copy the share link from your browser address bar.', 'success');
        }

        // Refresh "My galleries" list for the connected wallet
        refreshMyGalleries();
    } catch (err) {
        console.error('Error saving gallery:', err);
        showToast(err.message || 'Failed to save gallery', 'error');
        showError(err.message || 'Failed to save gallery');
    }
}

function getConnectedWalletAddress() {
    if (state.connectedAddress) return state.connectedAddress;
    if (window.WalletConnect && typeof window.WalletConnect.getAddress === 'function') {
        return window.WalletConnect.getAddress();
    }
    try {
        const fromStorage = window.localStorage && window.localStorage.getItem('wallet_address');
        return fromStorage || null;
    } catch {
        return null;
    }
}

async function refreshMyGalleries() {
    const address = getConnectedWalletAddress();
    state.connectedAddress = address || null;

    const sectionEl = galleryElements.myGalleriesSection && galleryElements.myGalleriesSection();
    const listEl = galleryElements.myGalleriesList && galleryElements.myGalleriesList();
    const emptyEl = galleryElements.myGalleriesEmpty && galleryElements.myGalleriesEmpty();

    if (!sectionEl || !listEl || !emptyEl) return;

    if (!address) {
        sectionEl.style.display = 'none';
        listEl.innerHTML = '';
        emptyEl.style.display = 'none';
        return;
    }

    try {
        const resp = await fetch(`${CONFIG.PROXY_BASE}/galleries?address=${encodeURIComponent(address)}`, {
            headers: { 'Accept': 'application/json' }
        });

        if (!resp.ok) {
            console.warn('Failed to load galleries list for address', address, resp.status);
            sectionEl.style.display = 'none';
            return;
        }

        const payload = await resp.json();
        const galleries = Array.isArray(payload.galleries) ? payload.galleries : [];

        if (galleries.length === 0) {
            sectionEl.style.display = 'block';
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }

        sectionEl.style.display = 'block';
        emptyEl.style.display = 'none';

        listEl.innerHTML = '';
        galleries.forEach((g) => {
            const item = document.createElement('div');
            item.className = 'my-gallery-item';
            item.dataset.id = g.id;

            // Highlight currently open gallery
            if (state.currentGalleryId && String(state.currentGalleryId) === String(g.id)) {
                item.classList.add('active');
            }

            const created = g.createdAt ? new Date(g.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

            item.innerHTML = `
                <div class="my-gallery-main">
                    <span class="my-gallery-name">${escapeHtml(g.name || 'Untitled gallery')}</span>
                    <span class="my-gallery-meta">${g.inscriptionCount || 0} inscriptions · ${created}</span>
                </div>
                <div class="my-gallery-actions">
                    <button class="btn btn-secondary" data-action="open" type="button">Open</button>
                    <button class="btn btn-secondary" data-action="edit" type="button">Edit selection</button>
                    <button class="btn btn-secondary" data-action="copy" type="button">Copy link</button>
                    <button class="btn btn-danger" data-action="delete" type="button">Delete</button>
                </div>
            `;

            const actionsEl = item.querySelector('.my-gallery-actions');
            if (actionsEl) {
                actionsEl.addEventListener('click', (event) => {
                    const btn = event.target.closest('button');
                    if (!btn) return;
                    const action = btn.dataset.action;
                    const id = g.id;
                    if (action === 'open' || action === 'edit') {
                        const asEdit = action === 'edit';
                        loadSharedGallery(id, { fromMyGalleries: true, editMode: asEdit });
                    } else if (action === 'copy') {
                        const shareUrl = new URL(window.location.href);
                        shareUrl.searchParams.set('gallery', id);
                        shareUrl.searchParams.delete('address');
                        const link = shareUrl.toString();
                        (async () => {
                            try {
                                await navigator.clipboard.writeText(link);
                                showToast('Gallery link copied to clipboard.', 'success');
                            } catch {
                                showToast('Copy failed. You can copy the link from your browser address bar.', 'error');
                            }
                        })();
                    } else if (action === 'delete') {
                        const confirmed = window.confirm('Delete this gallery? This cannot be undone.');
                        if (!confirmed) return;
                        deleteGallery(id, address);
                    }
                });
            }

            listEl.appendChild(item);
        });
    } catch (err) {
        console.warn('Error loading galleries list', err);
        sectionEl.style.display = 'none';
    }
}

async function deleteGallery(id, address) {
    try {
        const resp = await fetch(`${CONFIG.PROXY_BASE}/galleries/${encodeURIComponent(id)}?address=${encodeURIComponent(address)}`, {
            method: 'DELETE'
        });

        if (!resp.ok && resp.status !== 204) {
            const errPayload = await resp.json().catch(() => null);
            const message = errPayload?.error || `Failed to delete gallery (status ${resp.status})`;
            throw new Error(message);
        }

        // If we just deleted the gallery we're viewing, clear it back to wallet view
        if (state.currentGalleryId === String(id)) {
            state.currentGalleryId = null;
            state.viewingSharedGallery = false;
            state.sharedGalleryMeta = null;
            state.ownsCurrentGallery = false;
            state.selectedIds = new Set();
            hideError();
            galleryElements.gallery().innerHTML = '';
            galleryElements.statsSection().style.display = 'none';
            galleryElements.filterSection().style.display = 'none';
            updateSelectionInfo();
        }

        await refreshMyGalleries();
    } catch (err) {
        console.error('Failed to delete gallery', err);
        showToast(err.message || 'Failed to delete gallery', 'error');
        showError(err.message || 'Failed to delete gallery');
    }
}

async function loadSharedGallery(galleryId, options = {}) {
    if (!galleryId) return;

    hideError();
    setLoading(true);

    try {
        const response = await fetch(`${CONFIG.PROXY_BASE}/galleries/${encodeURIComponent(galleryId)}`, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            const errPayload = await response.json().catch(() => null);
            const message = errPayload?.error || `Failed to load gallery (status ${response.status})`;
            throw new Error(message);
        }

        const data = await response.json();

        state.address = data.address;
        state.inscriptions = Array.isArray(data.inscriptions) ? data.inscriptions : [];
        state.total = state.inscriptions.length;
        state.offset = state.total;
        state.currentGalleryId = data.id;
        state.viewingSharedGallery = true;
        state.sharedGalleryMeta = {
            name: data.name,
            address: data.address
        };

        const connected = getConnectedWalletAddress();
        state.connectedAddress = connected || state.connectedAddress || null;
        state.ownsCurrentGallery = !!(connected && connected === data.address);

        // In "edit selection" mode for an owned gallery, pre-select all
        if (options.editMode && state.ownsCurrentGallery) {
            state.selectedIds = new Set(state.inscriptions.map((ins) => ins.id));
        } else {
            state.selectedIds = new Set();
        }

        // Show UI sections
        // In shared gallery view, hide stats/filters and show minimal header
        const sharedHeaderEl = document.getElementById('sharedGalleryHeader');
        const sharedTitleEl = document.getElementById('sharedGalleryTitle');

        galleryElements.statsSection().style.display = 'none';
        galleryElements.filterSection().style.display = 'none';

        const galleryActionsEl = galleryElements.galleryActions();
        if (galleryActionsEl) {
            galleryActionsEl.style.display = 'none';
        }

        if (sharedHeaderEl && sharedTitleEl) {
            sharedHeaderEl.style.display = 'flex';
            sharedTitleEl.textContent = data.name || 'Gallery';
        }

        const sharedNameEl = galleryElements.sharedGalleryName();
        const sharedAddressEl = galleryElements.sharedGalleryAddress();
        if (sharedNameEl) sharedNameEl.textContent = data.name;
        if (sharedAddressEl) sharedAddressEl.textContent = truncateId(data.address);

        updateStats();
        renderGallery();
        updateSelectionInfo();
    } catch (err) {
        console.error('Error loading shared gallery:', err);
        showError(err.message || 'Failed to load shared gallery');
    } finally {
        setLoading(false);
    }
}

// ========================================
// Modal Functions
// ========================================

/**
 * Open modal with inscription details
 */
async function openModal(inscription) {
    const modal = galleryElements.modal();
    const modalBody = galleryElements.modalBody();
    const category = getContentCategory(inscription.mime_type);
    const contentUrl = inscription.render_url || inscription.content_url || CONFIG.CONTENT_URL(inscription.id);

    let contentHtml = '';

    // Render content based on type
    switch (category) {
        case 'image':
            contentHtml = `<div class="modal-preview"><img src="${contentUrl}" alt="Inscription #${inscription.number}"></div>`;
            break;

        case 'html':
            contentHtml = `<div class="modal-preview"><iframe src="${contentUrl}" sandbox="allow-scripts"></iframe></div>`;
            break;

        case 'text':
            try {
                const content = await fetchInscriptionContent(inscription.id);
                // Try to pretty-print JSON
                let displayContent = content;
                try {
                    const parsed = JSON.parse(content);
                    displayContent = JSON.stringify(parsed, null, 2);
                } catch {}
                contentHtml = `<div class="modal-preview"><pre class="text-content">${escapeHtml(displayContent)}</pre></div>`;
            } catch {
                contentHtml = `<div class="modal-preview"><p class="text-content">Unable to load content</p></div>`;
            }
            break;

        default:
            contentHtml = `<div class="modal-preview" style="padding: 2rem; text-align: center;">
                <span style="font-size: 4rem;">${getTypeIcon(inscription.mime_type)}</span>
                <p style="margin-top: 1rem; color: var(--text-secondary);">Preview not available for ${inscription.mime_type}</p>
                <a href="${contentUrl}" target="_blank" style="color: var(--accent); margin-top: 0.5rem; display: inline-block;">View raw content →</a>
            </div>`;
    }

    modalBody.innerHTML = `
        ${contentHtml}
        <div class="modal-details">
            <h2>Inscription #${inscription.number?.toLocaleString() || 'N/A'}</h2>
            <div class="detail-row">
                <span class="detail-label">Inscription ID</span>
                <span class="detail-value"><a href="${CONFIG.ORDINALS_COM(inscription.id)}" target="_blank">${truncateId(inscription.id)}</a></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Content Type</span>
                <span class="detail-value">${inscription.mime_type || 'Unknown'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Content Size</span>
                <span class="detail-value">${formatSize(inscription.content_length || 0)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Created</span>
                <span class="detail-value">${formatDate(inscription.genesis_timestamp)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Genesis Block</span>
                <span class="detail-value">${inscription.genesis_block_height?.toLocaleString() || 'Unknown'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Sat Rarity</span>
                <span class="detail-value">${inscription.sat_rarity || 'Unknown'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Current Owner</span>
                <span class="detail-value">${truncateId(inscription.address)}</span>
            </div>
            ${inscription.recursive ? `<div class="detail-row">
                <span class="detail-label">Recursive</span>
                <span class="detail-value">Yes</span>
            </div>` : ''}
        </div>
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Close modal
 */
function closeModal(event) {
    if (event && event.target !== galleryElements.modal()) return;
    galleryElements.modal().classList.remove('active');
    document.body.style.overflow = '';
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// Main Functions
// ========================================

/**
 * Load inscriptions for the active wallet address
 * (Wallet must be connected and verified via LaserEyes)
 */
async function loadInscriptions() {
    let address = null;

    // Prefer verified LaserEyes session
    if (window.WalletConnect && window.WalletConnect.isConnected()) {
        address = window.WalletConnect.getAddress();
    } else {
        const inputEl = galleryElements.addressInput ? galleryElements.addressInput() : null;
        if (inputEl) {
            address = inputEl.value.trim();
        }
    }

    if (!address) {
        showError('Connect your wallet to view inscriptions');
        return;
    }

    // For now, trust the wallet-provided address and let the backend/proxy enforce validity.
    // This avoids blocking on wallets that return non-standard-but-usable formats.

    console.log('loadInscriptions called with address:', address);

    // Reset state
    state.address = address;
    state.inscriptions = [];
    state.offset = 0;
    state.total = 0;
    state.selectedIds = new Set();
    state.currentGalleryId = null;
    state.viewingSharedGallery = false;
    state.sharedGalleryMeta = null;

    hideError();
    galleryElements.gallery().innerHTML = '';
    galleryElements.statsSection().style.display = 'none';
    galleryElements.filterSection().style.display = 'none';
    galleryElements.loadMoreSection().style.display = 'none';

    setLoading(true);

    try {
        // First page to discover total
        const first = await fetchInscriptions(address, 0, CONFIG.PAGE_SIZE);

        if (first.total === 0) {
            showError('No inscriptions found for this address');
            return;
        }

        state.total = first.total;
        state.inscriptions = [...first.results];
        state.offset = first.results.length;

        // If there are more, pull the rest in a loop
        while (state.inscriptions.length < state.total) {
            const next = await fetchInscriptions(address, state.offset, CONFIG.PAGE_SIZE);
            if (!next.results || next.results.length === 0) break; // safety
            state.inscriptions = [...state.inscriptions, ...next.results];
            state.offset += next.results.length;
        }

        // Show UI sections
        galleryElements.statsSection().style.display = 'grid';
        galleryElements.filterSection().style.display = 'flex';

        updateStats();
        renderGallery();

    } catch (error) {
        showError(error.message || 'Failed to fetch inscriptions');
        console.error('Error loading inscriptions:', error);
    } finally {
        setLoading(false);
    }
}

/**
 * Load more inscriptions (pagination)
 * (No-op now - we fetch everything up front)
 */
async function loadMore() {
    // Kept for backwards-compatibility with the button, but we
    // now fetch all pages in a single go in loadInscriptions.
    return;
}

/**
 * Validate Bitcoin address format
 */
function isValidBitcoinAddress(address) {
    // Taproot (bc1p)
    if (/^bc1p[a-z0-9]{58}$/i.test(address)) return true;
    // Native SegWit (bc1q)
    if (/^bc1q[a-z0-9]{38,58}$/i.test(address)) return true;
    // Legacy P2PKH (1...)
    if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
    // Legacy P2SH (3...)
    if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
    return false;
}

// ========================================
// Event Listeners
// ========================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wire up save gallery button if present
    const saveGalleryBtn = galleryElements.saveGalleryBtn && galleryElements.saveGalleryBtn();
    if (saveGalleryBtn) {
        saveGalleryBtn.addEventListener('click', () => {
            saveCurrentSelectionAsGallery();
        });
    }

    // (Optional) legacy manual address input support if present in DOM
    const addressInputEl = galleryElements.addressInput ? galleryElements.addressInput() : null;
    if (addressInputEl) {
        addressInputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadInscriptions();
        });
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.filter;
            renderGallery();
        });
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Keep "My galleries" in sync with any existing session
    refreshMyGalleries();

    // Auto-load when wallet is verified (skip overwriting a shared gallery view)
    window.addEventListener('wallet:verified', (ev) => {
        console.log('wallet:verified event detail:', ev.detail);
        if (ev?.detail?.address) {
            state.connectedAddress = ev.detail.address;
        }
        refreshMyGalleries();
        if (state.viewingSharedGallery) return;
        hideError();
        loadInscriptions();
    });

    // When wallet disconnects, clear connected state + hide wallet-only UI
    window.addEventListener('wallet:disconnected', () => {
        state.connectedAddress = null;
        state.ownsCurrentGallery = false;
        refreshMyGalleries();
        updateSelectionInfo();
    });

    // URL param support
    const urlParams = new URLSearchParams(window.location.search);
    const galleryParam = urlParams.get('gallery');
    const isShared = !!galleryParam;

    if (isShared) {
        // Hide wallet connect UI, main header, and footer for shared gallery view
        const headerEl = document.querySelector('header.header');
        const walletSection = document.getElementById('walletConnectSection');
        const footerEl = document.getElementById('footer');
        if (headerEl) headerEl.style.display = 'none';
        if (walletSection) walletSection.style.display = 'none';
        if (footerEl) footerEl.style.display = 'none';

        loadSharedGallery(galleryParam);
    }
});

// Make functions globally accessible for onclick handlers and wallet hook
window.loadInscriptions = loadInscriptions;
window.loadMore = loadMore;
window.closeModal = closeModal;

// Direct hook used by wallet.js when verification succeeds
window.OrdinalsGallery = {
    loadForAddress(address) {
        console.log('OrdinalsGallery.loadForAddress called with:', address);
        if (address) {
            state.connectedAddress = address;
        }

        // Never overwrite an explicitly shared gallery view (?gallery=...)
        const urlParams = new URLSearchParams(window.location.search);
        const galleryParam = urlParams.get('gallery');
        if (galleryParam) {
            refreshMyGalleries();
            updateSelectionInfo();
            return;
        }

        loadInscriptions();
    }
};
