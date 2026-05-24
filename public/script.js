// Ultra Dads Dashboard — Phase 5
const API = '/api';
let lastData = {};

async function fetchJSON(path) {
    try {
        const res = await fetch(`${API}${path}`);
        if (!res.ok) throw new Error(res.status);
        return await res.json();
    } catch (e) {
        console.warn(`Fetch ${path} failed:`, e);
        return null;
    }
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function shortAddr(addr) {
    if (!addr) return '—';
    return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ---- Update Functions ----

async function updateAll() {
    const [status, mints, trades, analytics, health] = await Promise.all([
        fetchJSON('/status'),
        fetchJSON('/mints'),
        fetchJSON('/trades'),
        fetchJSON('/analytics'),
        fetch('/health').then(r => r.json()).catch(() => null)
    ]);

    if (status) renderStatus(status);
    if (mints) renderMints(mints);
    if (trades) renderTrades(trades);
    if (analytics) renderAnalytics(analytics);
    if (health) renderHealth(health);

    document.getElementById('last-update').textContent = `Updated ${formatTime(Date.now())}`;
}

function renderStatus(s) {
    const trackerEl = document.getElementById('stat-tracker');
    trackerEl.textContent = s.isTracking ? 'ONLINE' : 'STOPPED';
    trackerEl.className = `stat-value ${s.isTracking ? 'online' : 'offline'}`;

    const autoEl = document.getElementById('stat-automint');
    autoEl.textContent = s.autoMint ? 'ACTIVE' : 'OFF';
    autoEl.className = `stat-value ${s.autoMint ? 'online' : 'offline'}`;

    document.getElementById('stat-wallets').textContent = s.totalWallets;
    document.getElementById('tracked-count').textContent = `${s.trackedAddressesCount} targets`;

    // Config panel
    setToggle('conf-automint', s.autoMint);
    setToggle('conf-mev', s.mevProtection);
    setToggle('conf-sim', !s.skipSimulation, 'SAFE', 'BLIND');
    document.getElementById('conf-bribe').textContent = `+${s.gasBribeGwei || '0'} GWEI`;
    document.getElementById('conf-maxmint').textContent = `${s.maxMintLimit || '0'} ETH`;
    document.getElementById('conf-rpc').textContent = s.activeRPC || '—';
}

function setToggle(id, isOn, onLabel = 'ON', offLabel = 'OFF') {
    const el = document.getElementById(id);
    el.textContent = isOn ? onLabel : offLabel;
    el.classList.toggle('on', isOn);
    el.classList.toggle('off', !isOn);
}

function renderAnalytics(a) {
    document.getElementById('stat-eth').textContent = a.totalEthSpent;
    document.getElementById('stat-profit').textContent = `${a.netProfit} ETH`;
    document.getElementById('exec-ratio').textContent = `${a.successfulTrades}✓ / ${a.failedTrades}✗`;
}

function renderHealth(h) {
    const rpcEl = document.getElementById('stat-rpc');
    if (h.rpcLatencyMs > 0) {
        rpcEl.textContent = `${h.rpcLatencyMs}ms`;
        rpcEl.className = `stat-value ${h.rpcLatencyMs < 500 ? 'online' : 'offline'}`;
    } else {
        rpcEl.textContent = 'ERR';
        rpcEl.className = 'stat-value offline';
    }

    const dot = document.querySelector('.dot');
    dot.classList.toggle('offline', h.status !== 'ok');
    document.getElementById('system-status').textContent = h.status === 'ok' ? 'System Live' : 'Degraded';

    const mins = Math.floor(h.uptime / 60);
    const hrs = Math.floor(mins / 60);
    document.getElementById('uptime').textContent = `Uptime: ${hrs}h ${mins % 60}m`;
}

function renderMints(mints) {
    const container = document.getElementById('mint-feed');
    if (!mints || mints.length === 0) {
        container.innerHTML = '<div class="empty-state">🔭 Monitoring blockchain...</div>';
        return;
    }
    container.innerHTML = mints.slice(0, 30).map(m => `
        <div class="feed-item">
            <div class="feed-icon">🖼️</div>
            <div class="feed-info">
                <h4>${m.project || 'Unknown'}</h4>
                <p>${shortAddr(m.from)} → ${shortAddr(m.to)} • ${formatTime(m.timestamp)}</p>
            </div>
            <div class="feed-value">${m.value} ETH</div>
        </div>
    `).join('');
}

function renderTrades(trades) {
    const container = document.getElementById('exec-list');
    if (!trades || trades.length === 0) {
        container.innerHTML = '<div class="empty-state">No trades yet</div>';
        return;
    }
    container.innerHTML = trades.slice(0, 15).map(t => {
        const icon = t.status === 'Success' ? '✅' : '❌';
        const link = t.hash && t.hash !== 'N/A'
            ? `<a href="https://etherscan.io/tx/${t.hash}" target="_blank">tx↗</a>`
            : '';
        const err = t.error ? ` — ${t.error.slice(0, 25)}` : '';
        return `
            <div class="exec-item">
                <span class="icon">${icon}</span>
                <span class="detail">${shortAddr(t.target)}${err}</span>
                <span class="time">${formatTime(t.timestamp)} ${link}</span>
            </div>
        `;
    }).join('');
}

// ---- Interactive Controls ----

document.addEventListener('click', async (e) => {
    const el = e.target.closest('.config-value');
    if (!el) return;

    const key = el.dataset.key;
    if (!key) return;

    if (el.classList.contains('toggle')) {
        const current = el.classList.contains('on');
        await postConfig(key, !current);
    } else if (el.classList.contains('editable')) {
        const label = el.closest('.config-item')?.querySelector('.config-label')?.textContent || key;
        const val = prompt(`Set ${label}:`);
        if (val === null) return;
        await postConfig(key, val);
    }
});

async function postConfig(key, value) {
    try {
        await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        // Refresh immediately
        setTimeout(updateAll, 300);
    } catch (e) {
        console.error('Config update failed:', e);
    }
}

// ---- Init ----
updateAll();
setInterval(updateAll, 5000);
