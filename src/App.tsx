import React, { useState, useEffect, useCallback } from 'react';
import { Activity, ShieldCheck, Zap, Server, ChevronRight, CheckCircle2, XCircle, Wallet, Tag } from 'lucide-react';
import './index.css';

interface DashboardStatus {
  isTracking: boolean;
  autoMint: boolean;
  mevProtection: boolean;
  gasBribeGwei: string;
  maxMintLimit: string;
  activeRPC: string;
  totalUsers: number;
  totalWallets: number;
  trackedAddressesCount: number;
}

interface AnalyticsData {
  totalEthSpent: string;
  successfulTrades: number;
  failedTrades: number;
  profitHits: number;
}

interface MintEvent {
  timestamp: number;
  project: string;
  supply: string;
  value: string;
  from: string;
  to: string;
}

interface ListingStatus {
  profitCronActive: boolean;
  offerAcceptCronActive: boolean;
  autoAcceptOffers: boolean;
  minAcceptOfferEth: number;
  trackedCollections: { address: string; targetFloor: string }[];
  profitHits: number;
  autoListEnabled: boolean;
  autoDelistEnabled: boolean;
}

interface TradeEvent {
  timestamp: number;
  target: string;
  wallet: string;
  hash: string;
  status: 'Success' | 'Failed';
  error?: string;
}

const btnStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '8px',
  border: 'none',
  background: 'rgba(255,255,255,0.1)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const App: React.FC = () => {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [listingStatus, setListingStatus] = useState<ListingStatus | null>(null);
  const [mints, setMints] = useState<MintEvent[]>([]);
  const [trades, setTrades] = useState<TradeEvent[]>([]);

  const [walletUserId, setWalletUserId] = useState('');
  const [walletLabels, setWalletLabels] = useState<string[]>([]);
  const [walletCount, setWalletCount] = useState(0);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('dashboard_api_key') || '');
  const [labelsMessage, setLabelsMessage] = useState('');

  const loadWalletLabels = useCallback(async (userId: string) => {
    if (!userId.trim()) return;
    try {
      const res = await fetch(`/api/user/wallet-labels?userId=${encodeURIComponent(userId.trim())}`);
      const data = await res.json();
      if (data.error) {
        setLabelsMessage(data.error);
        return;
      }
      setWalletLabels(data.labels || []);
      setWalletCount(data.walletCount || 0);
      setLabelsMessage('');
    } catch {
      setLabelsMessage('Failed to load wallet labels');
    }
  }, []);

  const saveWalletLabels = async () => {
    if (!walletUserId.trim()) {
      setLabelsMessage('Enter a Telegram user ID');
      return;
    }
    try {
      const res = await fetch('/api/user/wallet-labels', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify({ userId: walletUserId.trim(), labels: walletLabels }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLabelsMessage(data.error || 'Save failed (check API key)');
        return;
      }
      setWalletLabels(data.labels);
      setLabelsMessage('Labels saved');
    } catch {
      setLabelsMessage('Save request failed');
    }
  };

  useEffect(() => {
    if (apiKey) localStorage.setItem('dashboard_api_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statRes, mintRes, tradeRes, analyticsRes, listingRes] = await Promise.all([
          fetch('/api/status').then(r => r.json()),
          fetch('/api/mints').then(r => r.json()),
          fetch('/api/trades').then(r => r.json()),
          fetch('/api/analytics').then(r => r.json()),
          fetch('/api/listing/status').then(r => r.json()),
        ]);

        setStatus(statRes);
        setMints(mintRes);
        setTrades(tradeRes);
        setAnalytics(analyticsRes);
        setListingStatus(listingRes);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexDirection: 'column', gap: '20px' }}>
        <Activity size={48} className="spin" />
        <h2>Connecting to Core Node...</h2>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px 20px' }}>
      <header style={{ marginBottom: '40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '3.5rem', fontWeight: '900', marginBottom: '8px', letterSpacing: '-2px' }}>
          ULTRA DADS <span style={{ background: 'linear-gradient(to right, #6366f1, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>DASHBOARD</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', fontWeight: '500' }}>Live Multichain Command Center</p>
      </header>

      {/* Deep Analytics Row */}
      {analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>

          <div className="glass-card" style={{ padding: '20px', borderTop: '4px solid #6366f1' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '5px' }}>Total Outflow Volume</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff' }}>
              {analytics.totalEthSpent} <span style={{ fontSize: '1rem', color: '#6366f1' }}>ETH</span>
            </div>
          </div>

          <div className="glass-card" style={{ padding: '20px', borderTop: '4px solid #10b981' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '5px' }}>Trade Win/Loss Ratio</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#fff', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ color: '#10b981' }}>{analytics.successfulTrades}</span>
              <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>/</span>
              <span style={{ color: '#ef4444' }}>{analytics.failedTrades}</span>
            </div>
          </div>

          <div className="glass-card" style={{ padding: '20px', borderTop: '4px solid #f59e0b' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '5px' }}>Auto-Seller Strikes</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#f59e0b' }}>
              {analytics.profitHits} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>profits locked</span>
            </div>
          </div>

        </div>
      )}

      {listingStatus && (
        <section className="glass-card" style={{ padding: '20px', marginBottom: '30px' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.2rem', marginBottom: '16px' }}>
            <Tag size={22} color="#a855f7" /> Listing &amp; Offers
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '0.9rem' }}>
            <div>Profit cron: <b style={{ color: listingStatus.profitCronActive ? '#10b981' : '#ef4444' }}>{listingStatus.profitCronActive ? 'ON' : 'OFF'}</b></div>
            <div>Auto-list: <b style={{ color: listingStatus.autoListEnabled ? '#10b981' : '#ef4444' }}>{listingStatus.autoListEnabled ? 'ON' : 'OFF'}</b></div>
            <div>Auto-delist: <b style={{ color: listingStatus.autoDelistEnabled ? '#10b981' : '#ef4444' }}>{listingStatus.autoDelistEnabled ? 'ON' : 'OFF'}</b></div>
            <div>Auto-accept: <b style={{ color: listingStatus.autoAcceptOffers ? '#10b981' : '#ef4444' }}>{listingStatus.autoAcceptOffers ? 'ON' : 'OFF'}</b></div>
            <div>Offer cron: <b style={{ color: listingStatus.offerAcceptCronActive ? '#10b981' : '#ef4444' }}>{listingStatus.offerAcceptCronActive ? 'ON' : 'OFF'}</b></div>
            <div>Monitored: <b>{listingStatus.trackedCollections.length}</b> collections</div>
          </div>
        </section>
      )}

      <section className="glass-card" style={{ padding: '20px', marginBottom: '30px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.2rem', marginBottom: '16px' }}>
          <Wallet size={22} color="#10b981" /> Wallet Labels
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <input type="text" placeholder="Telegram user ID" value={walletUserId} onChange={e => setWalletUserId(e.target.value)} style={{ flex: '1 1 200px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#fff' }} />
          <input type="password" placeholder="API key (PATCH)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ flex: '1 1 200px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#fff' }} />
          <button type="button" onClick={() => loadWalletLabels(walletUserId)} style={btnStyle}>Load</button>
          <button type="button" onClick={saveWalletLabels} style={{ ...btnStyle, background: '#6366f1' }}>Save</button>
        </div>
        {labelsMessage && <p style={{ fontSize: '0.85rem', color: '#a855f7', marginBottom: '10px' }}>{labelsMessage}</p>}
        {walletCount === 0 && walletUserId && <p style={{ color: 'var(--text-secondary)' }}>No wallets for this user.</p>}
        {walletLabels.map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ width: '48px', color: 'var(--text-secondary)' }}>#{i + 1}</span>
            <input type="text" placeholder={`W#${i + 1}`} value={label} onChange={e => { const next = [...walletLabels]; next[i] = e.target.value; setWalletLabels(next); }} style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)', color: '#fff' }} />
          </div>
        ))}
      </section>

      {/* Top Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Server size={32} color={status.isTracking ? '#10b981' : '#ef4444'} />
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Tracker Engine</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: status.isTracking ? '#10b981' : '#ef4444' }}>{status.isTracking ? 'ONLINE' : 'STOPPED'}</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Zap size={32} color={status.autoMint ? '#a855f7' : 'var(--text-secondary)'} />
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Auto-Mint Driver</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{status.autoMint ? 'ACTIVE' : 'IDLE'}</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <ShieldCheck size={32} color={status.mevProtection ? '#3b82f6' : 'var(--text-secondary)'} />
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>MEV Shield</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{status.mevProtection ? 'DEPLOYED' : 'OFF'}</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Activity size={32} color="#f59e0b" />
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>Active Nodes</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{status.totalWallets} <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>wallets</span></div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(350px, 1.2fr) minmax(350px, 1fr)', gap: '30px' }}>

        {/* Left Column - Mints */}
        <section className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.4rem' }}>
              <Zap size={26} color="#f59e0b" /> Live Whale Activity
            </h2>
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '4px 10px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold' }}>
              Tracking {status.trackedAddressesCount} Targets
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto', paddingRight: '5px' }}>
            {mints.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.1)', padding: '40px 0' }}>No mints detected yet</div>
            ) : mints.map((mint, i) => (
              <div key={i} style={{ borderLeft: '3px solid #f59e0b', background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: '800', fontSize: '1.1rem', color: 'white' }}>{mint.project}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{new Date(mint.timestamp).toLocaleTimeString()}</div>
                </div>

                <div style={{ display: 'flex', gap: '15px', fontSize: '0.85rem' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>Paid:</span> <span style={{ color: '#10b981', fontWeight: 600 }}>{mint.value} ETH</span></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>Supply:</span> {mint.supply}</div>
                </div>

                <div style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                  <div style={{ color: 'var(--text-secondary)' }}>Target: <code style={{ color: 'var(--primary)' }}>{mint.to.slice(0, 8)}...</code></div>
                  <div style={{ color: 'var(--text-secondary)' }}>Whale: <code>{mint.from.slice(0, 8)}...</code></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right Column - Copy Trades & Config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

          <section className="glass-card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.4rem', marginBottom: '24px' }}>
              <Server size={26} color="#3b82f6" /> System Internals
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>RPC Node</div>
                <code style={{ color: '#3b82f6', fontSize: '0.8rem' }}>{status.activeRPC}</code>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Max Mint Limit</div>
                <div style={{ fontWeight: 'bold' }}>{status.maxMintLimit} ETH</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gas Bribe Tip</div>
                <div style={{ fontWeight: 'bold', color: '#f59e0b' }}>+{status.gasBribeGwei} GWEI</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Active Telegram Users</div>
                <div style={{ fontWeight: 'bold' }}>{status.totalUsers} Admins</div>
              </div>
            </div>
          </section>

          <section className="glass-card" style={{ flex: 1 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '1.4rem', marginBottom: '24px' }}>
              <Activity size={26} color="#10b981" /> Output Console
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
              {trades.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.1)', padding: '40px 0' }}>No trades executed yet</div>
              ) : trades.map((trade, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 15px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', borderLeft: trade.status === 'Success' ? '3px solid #10b981' : '3px solid #ef4444' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {trade.status === 'Success' ? <CheckCircle2 size={14} color="#10b981" /> : <XCircle size={14} color="#ef4444" />}
                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: trade.status === 'Success' ? '#10b981' : '#ef4444' }}>
                        {trade.status === 'Success' ? 'BROADCAST OK' : 'EXECUTION REVERT'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Target: <code>{trade.target.slice(0, 10)}...</code></div>
                    {trade.error && <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '2px' }}>{trade.error}</div>}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{new Date(trade.timestamp).toLocaleTimeString()}</div>
                    {trade.status === 'Success' && trade.hash !== 'N/A' && (
                      <a href={`https://etherscan.io/tx/${trade.hash}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#3b82f6', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Etherscan <ChevronRight size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>

      <style>{`
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default App;
