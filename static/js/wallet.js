/**
 * Bitcoin Wallet Connect - Template
 * Wallet connection with message signing verification using LaserEyes
 */

console.log('Wallet Connect Template Loading...');

// Wallet state
const walletState = {
    connected: false,
    address: null,
    provider: null,
    signature: null,
    client: null,
    pendingVerification: false
};

// Wallet configurations
const WALLETS = [
    { id: 'unisat', name: 'UniSat', icon: '/static/images/wallets/unisat.svg' },
    { id: 'xverse', name: 'Xverse', icon: '/static/images/wallets/xverse.svg' },
    { id: 'leather', name: 'Leather', icon: '/static/images/wallets/leather.svg' },
    { id: 'oyl', name: 'OYL', icon: '/static/images/wallets/oyl.svg' },
    { id: 'phantom', name: 'Phantom', icon: '/static/images/wallets/phantom.svg' },
    { id: 'magiceden', name: 'Magic Eden', icon: '/static/images/wallets/magiceden.svg' },
    { id: 'okx', name: 'OKX', icon: '/static/images/wallets/okx.svg' },
    { id: 'wizz', name: 'Wizz', icon: '/static/images/wallets/wizz.svg' }
];

// DOM Elements
const elements = {};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

function init() {
    console.log('Initializing wallet connect...');
    
    // Cache DOM elements
    elements.connectBtn = document.getElementById('connect-btn');
    elements.disconnectBtn = document.getElementById('disconnect-btn');
    elements.notConnected = document.getElementById('not-connected');
    elements.connected = document.getElementById('connected');
    elements.connectedBar = document.getElementById('connected-bar');
    elements.walletAddress = document.getElementById('wallet-address');
    elements.modal = document.getElementById('wallet-modal');
    elements.modalClose = document.getElementById('modal-close');
    elements.walletList = document.getElementById('wallet-list');
    elements.modalBackdrop = document.querySelector('.modal-backdrop');
    
    // Set up event listeners
    setupEventListeners();
    
    // Initialize LaserEyes
    initLaserEyes();
    
    // Check for existing session
    checkExistingSession();
}

function setupEventListeners() {
    elements.connectBtn?.addEventListener('click', showWalletModal);
    elements.disconnectBtn?.addEventListener('click', disconnect);
    elements.modalClose?.addEventListener('click', hideWalletModal);
    elements.modalBackdrop?.addEventListener('click', hideWalletModal);
    
    // Close modal on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideWalletModal();
    });
}

function initLaserEyes() {
    if (!window.LaserEyes) {
        console.log('Waiting for LaserEyes...');
        setTimeout(initLaserEyes, 100);
        return;
    }
    
    const { LaserEyesClient, createStores, createConfig, MAINNET } = window.LaserEyes;
    
    try {
        const stores = createStores();
        const config = createConfig({ network: MAINNET });
        const client = new LaserEyesClient(stores, config);
        client.initialize();
        
        walletState.client = client;
        
        // Track connection state changes
        let wasConnected = false;
        
        stores.$store.subscribe((state) => {
            console.log('State:', { connected: state.connected, address: state.address });
            
            if (state.connected && state.address && !wasConnected) {
                wasConnected = true;
                // Don't complete connection yet - need to verify with signature
                if (walletState.pendingVerification) {
                    onWalletConnected(state.address, state.provider);
                }
            } else if (!state.connected && wasConnected) {
                wasConnected = false;
                onDisconnected();
            }
        });
        
        console.log('LaserEyes initialized');
    } catch (error) {
        console.error('LaserEyes init failed:', error);
    }
}

function checkExistingSession() {
    const address = localStorage.getItem('wallet_address');
    const provider = localStorage.getItem('wallet_provider');
    const signature = localStorage.getItem('wallet_signature');
    
    if (address && provider && signature) {
        console.log('Restoring verified session...');
        walletState.signature = signature;
        onVerified(address, provider);
    }
}

function showWalletModal() {
    renderWalletList();
    elements.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function hideWalletModal() {
    elements.modal.style.display = 'none';
    document.body.style.overflow = '';
}

function renderWalletList() {
    const html = WALLETS.map(wallet => {
        const isInstalled = checkWalletInstalled(wallet.id);
        return `
            <div class="wallet-item ${isInstalled ? '' : 'not-installed'}" data-wallet="${wallet.id}">
                <div class="wallet-icon">
                    <img src="${wallet.icon}" alt="${wallet.name}" 
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <span class="wallet-icon-fallback" style="display: none;">${wallet.name[0]}</span>
                </div>
                <div class="wallet-info">
                    <div class="wallet-name">${wallet.name}</div>
                    <div class="wallet-status">${isInstalled ? 'Available' : 'Not installed'}</div>
                </div>
                <div class="wallet-arrow">→</div>
            </div>
        `;
    }).join('');
    
    elements.walletList.innerHTML = html;
    
    // Add click handlers
    elements.walletList.querySelectorAll('.wallet-item').forEach(item => {
        item.addEventListener('click', () => {
            const walletId = item.dataset.wallet;
            const isInstalled = checkWalletInstalled(walletId);
            
            if (!isInstalled) {
                openInstallPage(walletId);
                return;
            }
            
            connectAndSign(walletId, item);
        });
    });
}

function checkWalletInstalled(walletId) {
    const checks = {
        unisat: () => typeof window.unisat !== 'undefined',
        xverse: () => !!(window.XverseProviders?.BitcoinProvider || window.BitcoinProvider),
        leather: () => !!(window.LeatherProvider || window.HiroWalletProvider),
        oyl: () => typeof window.oyl !== 'undefined',
        phantom: () => !!window.phantom?.bitcoin,
        magiceden: () => !!window.magicEden?.bitcoin,
        okx: () => !!window.okxwallet?.bitcoin,
        wizz: () => typeof window.wizz !== 'undefined'
    };
    
    return checks[walletId] ? checks[walletId]() : false;
}

function openInstallPage(walletId) {
    const urls = {
        unisat: 'https://unisat.io/download',
        xverse: 'https://www.xverse.app/download',
        leather: 'https://leather.io/install-extension',
        oyl: 'https://oyl.io/',
        phantom: 'https://phantom.app/download',
        magiceden: 'https://wallet.magiceden.io/',
        okx: 'https://www.okx.com/web3',
        wizz: 'https://wizzwallet.io/'
    };
    
    if (urls[walletId]) {
        window.open(urls[walletId], '_blank');
        showToast('Please install the wallet and refresh', 'info');
    }
}

function generateSignMessage(address) {
    const timestamp = Date.now();
    const message = `Sign this message to verify you own this wallet.\n\nAddress: ${address}\nTimestamp: ${timestamp}`;
    return { message, timestamp };
}

async function connectAndSign(walletId, element) {
    console.log('Connecting to:', walletId);
    
    // Show connecting state
    element.classList.add('connecting');
    const originalContent = element.innerHTML;
    
    const updateStatus = (text, subtext) => {
        element.innerHTML = `
            <div class="wallet-icon"><span class="wallet-icon-fallback">...</span></div>
            <div class="wallet-info">
                <div class="wallet-name">${text}</div>
                <div class="wallet-status">${subtext}</div>
            </div>
        `;
    };
    
    updateStatus('Connecting...', 'Please check your wallet');
    
    try {
        const { UNISAT, XVERSE, LEATHER, OYL, PHANTOM, MAGIC_EDEN, OKX, WIZZ } = window.LaserEyes;
        
        const walletTypes = {
            unisat: UNISAT,
            xverse: XVERSE,
            leather: LEATHER,
            oyl: OYL,
            phantom: PHANTOM,
            magiceden: MAGIC_EDEN,
            okx: OKX,
            wizz: WIZZ
        };
        
        const walletType = walletTypes[walletId];
        
        if (!walletState.client || !walletType) {
            throw new Error('Wallet type not supported');
        }
        
        // Step 1: Connect and wait for address
        walletState.pendingVerification = true;
        await walletState.client.connect(walletType);
        
        // Wait for address to be available (comes through store subscription)
        const address = await waitForAddress(5000);
        if (!address) {
            throw new Error('No address returned from wallet');
        }
        
        console.log('Got address:', address);
        
        // Step 2: Request signature
        updateStatus('Signing...', 'Please sign the message');
        
        const { message } = generateSignMessage(address);
        console.log('Requesting signature for message:', message);
        
        const signature = await walletState.client.signMessage(message);
        
        if (!signature) {
            throw new Error('Signature rejected');
        }
        
        console.log('Signature received:', signature);
        
        // Step 3: Complete verification
        walletState.signature = signature;
        walletState.pendingVerification = false;
        
        onVerified(address, walletId);
        hideWalletModal();

        // Mark page as wallet-connected for CSS hooks
        try {
            document.body.classList.add('wallet-connected');
        } catch {}

        // Hide wallet connect card when connected
        try {
            const walletSection = document.getElementById('walletConnectSection');
            if (walletSection) walletSection.style.display = 'none';
        } catch {}
        
    } catch (error) {
        console.error('Connection/signing failed:', error);
        walletState.pendingVerification = false;
        
        // Disconnect if we connected but signing failed
        if (walletState.client) {
            try {
                walletState.client.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
        
        showToast(`Failed: ${error.message}`, 'error');
        
        // Restore button
        element.classList.remove('connecting');
        element.innerHTML = originalContent;
    }
}

function waitForAddress(timeout = 5000) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const check = () => {
            // Check client.address property
            if (walletState.client?.address) {
                resolve(walletState.client.address);
                return;
            }
            
            // Check if we have it in pendingAddress from subscription
            if (walletState.pendingAddress) {
                const addr = walletState.pendingAddress;
                walletState.pendingAddress = null;
                resolve(addr);
                return;
            }
            
            // Timeout check
            if (Date.now() - startTime > timeout) {
                resolve(null);
                return;
            }
            
            // Keep checking
            setTimeout(check, 100);
        };
        
        check();
    });
}

function onWalletConnected(address, provider) {
    // This is called when wallet connects but before signing
    // Store address for waitForAddress to pick up
    console.log('Wallet connected, awaiting signature:', { address, provider });
    walletState.pendingAddress = address;
}

function onVerified(address, provider) {
    console.log('Verified:', { address, provider });
    
    walletState.connected = true;
    walletState.address = address;
    walletState.provider = provider;
    
    // Store session
    localStorage.setItem('wallet_address', address);
    localStorage.setItem('wallet_provider', provider || 'unknown');
    localStorage.setItem('wallet_signature', walletState.signature);
    
    // Update UI
    updateUI();

    // Notify listeners (e.g., gallery app) that wallet has been verified
    try {
        window.dispatchEvent(new CustomEvent('wallet:verified', {
            detail: {
                address,
                provider,
                signature: walletState.signature
            }
        }));
    } catch (e) {
        console.warn('wallet:verified event failed:', e);
    }

    // Direct hook for ordinals gallery (fallback if events are missed)
    try {
        if (window.OrdinalsGallery && typeof window.OrdinalsGallery.loadForAddress === 'function') {
            window.OrdinalsGallery.loadForAddress(address);
        }
    } catch (e) {
        console.warn('OrdinalsGallery hook failed:', e);
    }
}

function onDisconnected() {
    console.log('Disconnected');
    
    walletState.connected = false;
    walletState.address = null;
    walletState.provider = null;
    walletState.signature = null;

    try {
        document.body.classList.remove('wallet-connected');
    } catch {}
    
    // Clear session
    localStorage.removeItem('wallet_address');
    localStorage.removeItem('wallet_provider');
    localStorage.removeItem('wallet_signature');
    
    // Update UI
    updateUI();

    // Notify listeners that wallet session ended
    try {
        window.dispatchEvent(new CustomEvent('wallet:disconnected'));
    } catch (e) {
        console.warn('wallet:disconnected event failed:', e);
    }
}

async function disconnect() {
    try {
        if (walletState.client) {
            walletState.client.disconnect();
        }
    } catch (error) {
        console.error('Disconnect error:', error);
    }
    
    onDisconnected();
}

function updateUI() {
    if (walletState.connected && walletState.address) {
        elements.notConnected.style.display = 'none';
        elements.connected.style.display = 'block';
        elements.connectedBar.style.display = 'flex';
        
        // Truncate address for display
        const addr = walletState.address;
        const displayAddr = `${addr.slice(0, 8)}...${addr.slice(-6)}`;
        elements.walletAddress.textContent = displayAddr;
        elements.walletAddress.title = addr;
    } else {
        elements.notConnected.style.display = 'block';
        elements.connected.style.display = 'none';
        elements.connectedBar.style.display = 'none';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-message">${message}</span>`;
    
    container.appendChild(toast);
    
    // Auto remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Export for external use
window.WalletConnect = {
    getAddress: () => walletState.address,
    getSignature: () => walletState.signature,
    isConnected: () => walletState.connected,
    getProvider: () => walletState.provider,
    connect: showWalletModal,
    disconnect: disconnect
};

console.log('Wallet Connect Template loaded');
