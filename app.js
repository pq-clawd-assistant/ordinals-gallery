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
    address: '',
    inscriptions: [],
    total: 0,
    offset: 0,
    loading: false,
    currentFilter: 'all',
    contentCache: new Map()
};

// ========================================
// DOM Elements
// ========================================

const elements = {
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
    totalInscriptions: () => document.getElementById('totalInscriptions')
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
    const raw = Array.isArray(data.inscriptions) ? data.inscriptions : [];

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
    elements.loadingIndicator().style.display = loading ? 'block' : 'none';
    elements.searchBtn().disabled = loading;
    
    const btnText = elements.searchBtn().querySelector('.btn-text');
    const btnLoading = elements.searchBtn().querySelector('.btn-loading');
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoading.style.display = loading ? 'inline' : 'none';
}

/**
 * Show error message
 */
function showError(message) {
    const errorEl = elements.errorMessage();
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

/**
 * Hide error message
 */
function hideError() {
    elements.errorMessage().style.display = 'none';
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
    
    elements.totalCount().textContent = state.total.toLocaleString();
    elements.imageCount().textContent = imageCount.toLocaleString();
    elements.textCount().textContent = textCount.toLocaleString();
    elements.otherCount().textContent = otherCount.toLocaleString();
    
    elements.showingCount().textContent = inscriptions.length.toLocaleString();
    elements.totalInscriptions().textContent = state.total.toLocaleString();
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
    
    card.innerHTML = `
        <div class="inscription-preview">
            ${renderPreview(inscription, category)}
            <span class="mime-badge">${inscription.mime_type || 'unknown'}</span>
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
    
    card.addEventListener('click', () => openModal(inscription));
    
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
        // Truncate for preview
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
    const gallery = elements.gallery();
    gallery.innerHTML = '';
    
    const filtered = filterInscriptions(state.inscriptions);
    
    filtered.forEach((inscription, index) => {
        const card = createInscriptionCard(inscription);
        card.style.animationDelay = `${index * 0.05}s`;
        gallery.appendChild(card);
    });
    
    // Update load more section
    const hasMore = state.inscriptions.length < state.total;
    elements.loadMoreSection().style.display = hasMore ? 'block' : 'none';
}

/**
 * Filter inscriptions based on current filter
 */
function filterInscriptions(inscriptions) {
    if (state.currentFilter === 'all') return inscriptions;
    return inscriptions.filter(insc => getContentCategory(insc.mime_type) === state.currentFilter);
}

// ========================================
// Modal Functions
// ========================================

/**
 * Open modal with inscription details
 */
async function openModal(inscription) {
    const modal = elements.modal();
    const modalBody = elements.modalBody();
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
    if (event && event.target !== elements.modal()) return;
    elements.modal().classList.remove('active');
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
 * Load inscriptions for the entered address
 * Now fetches ALL pages from Hiro and shows everything in one go
 */
async function loadInscriptions() {
    const address = elements.addressInput().value.trim();
    
    if (!address) {
        showError('Please enter a Bitcoin address');
        return;
    }
    
    // Basic address validation
    if (!isValidBitcoinAddress(address)) {
        showError('Invalid Bitcoin address format. Supported: bc1p... (taproot), bc1q... (segwit), 1... or 3... (legacy)');
        return;
    }
    
    // Reset state
    state.address = address;
    state.inscriptions = [];
    state.offset = 0;
    state.total = 0;
    
    hideError();
    elements.gallery().innerHTML = '';
    elements.statsSection().style.display = 'none';
    elements.filterSection().style.display = 'none';
    elements.loadMoreSection().style.display = 'none';
    
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
        elements.statsSection().style.display = 'grid';
        elements.filterSection().style.display = 'flex';
        
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
 * (No-op now – we fetch everything up front)
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
    // Search on Enter key
    elements.addressInput().addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadInscriptions();
    });
    
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
    
    // Check for address in URL params
    const urlParams = new URLSearchParams(window.location.search);
    const addressParam = urlParams.get('address');
    if (addressParam) {
        elements.addressInput().value = addressParam;
        loadInscriptions();
    }
});

// Make functions globally accessible for onclick handlers
window.loadInscriptions = loadInscriptions;
window.loadMore = loadMore;
window.closeModal = closeModal;
