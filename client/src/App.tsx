import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownUp, ArrowRight, BarChart3, Check, ChevronDown, Clock3, Copy, ExternalLink, Globe2, Link2, LoaderCircle, MousePointer2, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';

type Link = { id: string; shortCode: string; originalUrl: string; shortUrl: string; createdAt: string; expiresAt: string | null; totalClicks: number; isExpired: boolean };
type ClickEvent = { id: string; clickedAt: string; referrer: string | null };
type Stats = { shortCode: string; originalUrl: string; totalClicks: number; clicks: ClickEvent[] };
type Status = 'all' | 'active' | 'expired' | 'never';
type Sort = 'newest' | 'oldest' | 'most' | 'least';

const API = `${import.meta.env.VITE_API_URL || ""}/api`;
function prettyDate(date: string) { return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function prettyTime(date: string) { return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function domain(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
function expired(link: Link) { return !!link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now(); }
async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
  return body as T;
}

function App() {
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [expiration, setExpiration] = useState('never');
  const [links, setLinks] = useState<Link[]>([]);
  const [created, setCreated] = useState<Link | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [formError, setFormError] = useState('');
  const [dashboardError, setDashboardError] = useState('');
  const [copied, setCopied] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [selected, setSelected] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const analyticsRef = useRef<HTMLDivElement | null>(null);

  const loadLinks = useCallback(async () => {
    setRefreshing(true);
    setDashboardError('');
    try { setLinks(await parseResponse<Link[]>(await fetch(`${API}/links`, { cache: 'no-store' }))); }
    catch (err) { setDashboardError(err instanceof Error ? err.message : 'Unable to load links.'); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);
  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => analyticsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => window.clearTimeout(timer);
  }, [selected]);

  const totalClicks = links.reduce((total, link) => total + link.totalClicks, 0);
  const activeLinks = links.filter(link => !expired(link)).length;
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return links.filter(link => {
      const match = !search || [link.shortCode, link.originalUrl, link.shortUrl].some(text => text.toLowerCase().includes(search));
      const isExpired = expired(link);
      const matchStatus = status === 'all' || (status === 'active' && !isExpired) || (status === 'expired' && isExpired) || (status === 'never' && !link.expiresAt);
      return match && matchStatus;
    }).sort((a, b) => {
      if (sort === 'most') return b.totalClicks - a.totalClicks;
      if (sort === 'least') return a.totalClicks - b.totalClicks;
      if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [links, query, status, sort]);

  async function createLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setCreated(null);
    if (!url.trim()) { setFormError('Paste a URL to get started.'); return; }
    setLoading(true);
    try {
      const link = await parseResponse<Link>(await fetch(`${API}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalUrl: url.trim(), customAlias: alias.trim(), expirationDays: expiration === 'never' ? null : Number(expiration) })
      }));
      setCreated(link);
      setUrl(''); setAlias(''); setExpiration('never');
      await loadLinks();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Unable to create link.'); }
    finally { setLoading(false); }
  }
  async function copyLink(link: Link) {
    try { await navigator.clipboard.writeText(link.shortUrl); setCopied(link.shortCode); window.setTimeout(() => setCopied(current => current === link.shortCode ? '' : current), 2200); }
    catch { setDashboardError('Clipboard access failed. Select and copy the URL manually.'); }
  }
  async function showStats(code: string) {
    setStatsLoading(true); setSelected(null); setDashboardError('');
    try { setSelected(await parseResponse<Stats>(await fetch(`${API}/links/${encodeURIComponent(code)}/stats`))); }
    catch (err) { setDashboardError(err instanceof Error ? err.message : 'Unable to load analytics.'); }
    finally { setStatsLoading(false); }
  }
  async function deleteLink(code: string) {
    if (!window.confirm(`Delete the link “${code}” and its click history? This cannot be undone.`)) return;
    setDeleting(code); setDashboardError('');
    try {
      await parseResponse<{ success: boolean }>(await fetch(`${API}/links/${encodeURIComponent(code)}`, { method: 'DELETE' }));
      setLinks(current => current.filter(link => link.shortCode !== code));
      setSelected(current => current?.shortCode === code ? null : current);
      setCreated(current => current?.shortCode === code ? null : current);
    } catch (err) { setDashboardError(err instanceof Error ? err.message : 'Unable to delete link.'); }
    finally { setDeleting(null); }
  }
  async function clearAll() {
    if (!window.confirm('Delete ALL links and their click history? This cannot be undone.')) return;
    setDeleting('all'); setDashboardError('');
    try {
      await parseResponse<{ success: boolean }>(await fetch(`${API}/links`, { method: 'DELETE' }));
      setLinks([]); setSelected(null); setCreated(null); setCopied('');
    } catch (err) { setDashboardError(err instanceof Error ? err.message : 'Unable to clear links.'); }
    finally { setDeleting(null); }
  }

  const activityDays = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - i));
      return { date: day, label: day.toLocaleDateString(undefined, { weekday: 'short' }), count: 0 };
    });
    for (const click of selected?.clicks ?? []) {
      const day = new Date(click.clickedAt); day.setHours(0, 0, 0, 0);
      const entry = days.find(item => item.date.getTime() === day.getTime());
      if (entry) entry.count++;
    }
    return days;
  }, [selected]);
  const maxActivity = Math.max(1, ...activityDays.map(day => day.count));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#top" className="logo" aria-label="LinkForge home"><span className="logo-mark"><Link2 size={21} strokeWidth={2.7}/></span><span>linkforge<span className="logo-dot">.</span></span></a>
          <nav><a href="#workspace" className="nav-link">Dashboard <ArrowRight size={15}/></a></nav>
        </div>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-eyebrow"><span className="pulse-dot"/> YOUR LINKS, SIMPLIFIED</div>
          <h1>Make every link<br/><span>work harder.</span></h1>
          <p className="hero-description">Turn long URLs into clean, shareable links. Track every click, stay organized, and keep everything in one place.</p>

          <form className="create-card" onSubmit={event => void createLink(event)}>
            <div className="card-heading"><div><div className="card-kicker">CREATE A NEW LINK</div><h2>Shorten your URL</h2></div><div className="card-heading-icon"><Sparkles size={21}/></div></div>
            <label className="field-label" htmlFor="long-url">Destination URL</label>
            <div className="input-with-icon"><Globe2 size={19}/><input id="long-url" type="url" placeholder="https://example.com/your-long-link" value={url} onChange={event => setUrl(event.target.value)} required maxLength={2048}/></div>
            <div className="form-grid">
              <div><label className="field-label" htmlFor="custom-alias">Custom alias <span className="optional">(optional)</span></label><div className="input-with-icon"><Link2 size={18}/><input id="custom-alias" type="text" placeholder="my-awesome-link" value={alias} onChange={event => setAlias(event.target.value)} maxLength={30}/></div></div>
              <div><label className="field-label" htmlFor="expires">Expiration</label><div className="select-wrap"><Clock3 size={18}/><select id="expires" value={expiration} onChange={event => setExpiration(event.target.value)}><option value="never">Never expires</option><option value="1">After 1 day</option><option value="7">After 7 days</option><option value="30">After 30 days</option></select><ChevronDown className="select-chevron" size={16}/></div></div>
            </div>
            <div className="form-footer"><span className="helper-text"><ShieldCheck size={15}/> No account needed. Free to use.</span><button className="primary-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={18} className="spin"/> Creating...</> : <>Shorten link <ArrowRight size={18}/></>}</button></div>
            {formError && <p className="alert error" role="alert">{formError}</p>}
            {created && <div className="created-result"><div><span className="result-caption"><Check size={14}/> YOUR LINK IS READY</span><a href={created.shortUrl} target="_blank" rel="noreferrer">{created.shortUrl} <ExternalLink size={14}/></a></div><button type="button" className="result-copy" onClick={() => void copyLink(created)}>{copied === created.shortCode ? <Check size={17}/> : <Copy size={17}/>} {copied === created.shortCode ? 'Copied' : 'Copy'}</button></div>}
          </form>
          <div className="hero-benefits"><span><span className="benefit-icon"><Link2 size={15}/></span> Custom short links</span><span><span className="benefit-icon"><Activity size={15}/></span> Click analytics</span><span><span className="benefit-icon"><Clock3 size={15}/></span> Flexible expiration</span></div>
        </section>

        <section className="workspace" id="workspace"><div className="container">
          <div className="section-heading"><div><span className="section-eyebrow">YOUR WORKSPACE</span><h2>Link dashboard<span className="heading-dot">.</span></h2><p>All your links and insights, at a glance.</p></div><div className="heading-actions"><button className="secondary-button" type="button" onClick={() => void loadLinks()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/> Refresh</button><button className="danger-outline" type="button" disabled={!links.length || deleting !== null} onClick={() => void clearAll()}><Trash2 size={16}/> Clear all</button></div></div>
          <div className="overview-grid"><div className="metric-card"><div className="metric-label">Total links <span className="metric-icon green"><Link2 size={18}/></span></div><strong>{links.length}</strong><span className="metric-foot">Links created</span></div><div className="metric-card"><div className="metric-label">Total clicks <span className="metric-icon blue"><MousePointer2 size={18}/></span></div><strong>{totalClicks}</strong><span className="metric-foot">All-time visits</span></div><div className="metric-card"><div className="metric-label">Active links <span className="metric-icon purple"><Activity size={18}/></span></div><strong>{activeLinks}</strong><span className="metric-foot">Ready to share</span></div><div className="metric-card"><div className="metric-label">Avg. clicks / link <span className="metric-icon orange"><BarChart3 size={18}/></span></div><strong>{links.length ? (totalClicks / links.length).toFixed(1) : '0'}</strong><span className="metric-foot">Across all links</span></div></div>
          <div className="list-panel"><div className="list-header"><div><h3>My links <span className="count-badge">{links.length}</span></h3><p>Search, sort, and manage your shortened URLs.</p></div></div>
            <div className="toolbar"><div className="search-box"><Search size={18}/><input type="search" aria-label="Search links" placeholder="Search links or aliases..." value={query} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</div><div className="toolbar-select"><select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value as Status)}><option value="all">All statuses</option><option value="active">Active</option><option value="expired">Expired</option><option value="never">Never expires</option></select><ChevronDown size={15}/></div><div className="toolbar-select sort-select"><ArrowDownUp size={15}/><select aria-label="Sort links" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="most">Most clicks</option><option value="least">Fewest clicks</option></select><ChevronDown size={15}/></div></div>
            {dashboardError && <p className="alert error dashboard-alert" role="alert">{dashboardError}</p>}
            {refreshing && !links.length ? <div className="empty-state"><LoaderCircle className="spin" size={28}/><h4>Loading your links...</h4></div> : !links.length ? <div className="empty-state"><div className="empty-icon"><Link2 size={26}/></div><h4>No links yet</h4><p>Your shortened links will appear here. Create your first one above.</p><a href="#top" className="empty-cta"><Plus size={16}/> Create a link</a></div> : !filtered.length ? <div className="empty-state"><div className="empty-icon"><Search size={26}/></div><h4>No matching links</h4><p>Try another search or adjust your filters.</p><button className="empty-cta" type="button" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</button></div> : <div className="link-list">{filtered.map(link => <article className="link-row" key={link.id}><div className="link-avatar"><Link2 size={19}/></div><div className="link-details"><div className="link-title-line"><a className="link-title" href={link.shortUrl} target="_blank" rel="noreferrer">{link.shortUrl.replace(/^https?:\/\//, '')} <ExternalLink size={13}/></a><span className={`status-pill ${expired(link) ? 'expired' : 'active'}`}><span className="status-dot"/>{expired(link) ? 'Expired' : 'Active'}</span></div><div className="link-original" title={link.originalUrl}>{link.originalUrl}</div><div className="link-meta"><span><Globe2 size={13}/>{domain(link.originalUrl)}</span><span><Clock3 size={13}/>{prettyDate(link.createdAt)}</span><span>{link.expiresAt ? `Expires ${prettyDate(link.expiresAt)}` : 'No expiration'}</span></div></div><div className="link-right"><div className="click-total"><strong>{link.totalClicks}</strong><span>clicks</span></div><div className="row-actions"><button type="button" className="action-button copy-action" onClick={() => void copyLink(link)}><span>{copied === link.shortCode ? <Check size={15}/> : <Copy size={15}/>}</span>{copied === link.shortCode ? 'Copied' : 'Copy'}</button><button type="button" className="action-button" onClick={() => void showStats(link.shortCode)}><BarChart3 size={15}/> Analytics</button><button type="button" className="action-button delete-action" disabled={deleting === link.shortCode} onClick={() => void deleteLink(link.shortCode)}><Trash2 size={15}/> Delete</button></div></div></article>)}</div>}
            {links.length > 0 && <div className="list-footer">Showing <strong>{filtered.length}</strong> of <strong>{links.length}</strong> links</div>}
          </div>
          {statsLoading && <div className="analytics-loading"><LoaderCircle className="spin" size={18}/> Loading analytics...</div>}
          {selected && <div className="analytics-panel" ref={analyticsRef}><div className="analytics-header"><div><span className="section-eyebrow">LINK INSIGHTS</span><h3>Analytics for /{selected.shortCode}</h3><p className="analytics-destination">{selected.originalUrl}</p></div><button type="button" className="icon-close" onClick={() => setSelected(null)} aria-label="Close analytics"><X size={19}/></button></div><div className="analytics-body"><div className="analytics-summary"><span>Total link clicks</span><strong>{selected.totalClicks}</strong><p>All-time recorded visits</p></div><div className="chart-card"><div className="chart-title">Clicks over the last 7 days</div><div className="bar-chart">{activityDays.map(day => <div className="bar-column" key={day.date.toISOString()}><span className="bar-value">{day.count}</span><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(day.count ? 9 : 3, (day.count / maxActivity) * 100)}%` }}/></div><span className="bar-label">{day.label}</span></div>)}</div></div></div><div className="activity-section"><h4>Recent activity <span className="count-badge">{selected.clicks.length}</span></h4>{selected.clicks.length === 0 ? <p className="activity-empty">No visits yet. Share your link to start tracking clicks.</p> : <div className="activity-list">{selected.clicks.slice(0, 20).map(click => <div className="activity-item" key={click.id}><span className="activity-indicator"><MousePointer2 size={15}/></span><div><strong>Link visited</strong><span>{click.referrer ? `From ${domain(click.referrer)}` : 'Direct / unknown source'}</span></div><time>{prettyTime(click.clickedAt)}</time></div>)}</div>}{selected.clicks.length > 20 && <p className="activity-note">Showing the 20 most recent visits.</p>}</div></div>}
        </div></section>
      </main>
      <footer className="footer"><div className="container footer-inner"><div className="footer-brand"><span className="footer-logo"><Link2 size={15}/></span> linkforge<span className="logo-dot">.</span></div><span>Shorter links. Bigger possibilities.</span><span>© {new Date().getFullYear()} LinkForge</span></div></footer>
    </div>
  );
}
export default App;
