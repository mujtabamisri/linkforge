import express from 'express';
import cors from 'cors';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Link { id: string; shortCode: string; originalUrl: string; createdAt: string; expiresAt: string | null; }
interface Click { id: string; shortCode: string; clickedAt: string; referrer: string | null; }
interface Store { links: Link[]; clicks: Click[]; }

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');
let store: Store = { links: [], clicks: [] };
let pendingWrite: Promise<void> = Promise.resolve();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '16kb' }));

async function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  pendingWrite = pendingWrite.catch(() => {}).then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await writeFile(tempFile, snapshot, 'utf8');
    await rename(tempFile, DATA_FILE);
  });
  return pendingWrite;
}
function expired(link: Link) { return !!link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now(); }
function formatLink(link: Link) {
  return { ...link, shortUrl: `${PUBLIC_BASE_URL}/r/${encodeURIComponent(link.shortCode)}`, totalClicks: store.clicks.filter(c => c.shortCode === link.shortCode).length, isExpired: expired(link) };
}
function validUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const parsed = new URL(input.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch { return null; }
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unexpected server error'; }

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/links', (_req, res) => res.json([...store.links].reverse().map(formatLink)));
app.post('/api/links', async (req, res) => {
  try {
    const originalUrl = validUrl(req.body?.originalUrl);
    if (!originalUrl) { res.status(400).json({ error: 'Enter a valid http or https URL.' }); return; }
    const alias = typeof req.body?.customAlias === 'string' ? req.body.customAlias.trim() : '';
    if (alias && !/^[a-zA-Z0-9_-]{3,30}$/.test(alias)) {
      res.status(400).json({ error: 'Custom aliases must contain 3–30 letters, numbers, hyphens, or underscores.' }); return;
    }
    if (alias && ['api', 'r', 'admin'].includes(alias.toLowerCase())) {
      res.status(400).json({ error: 'That alias is reserved. Choose another.' }); return;
    }
    const days = req.body?.expirationDays ?? null;
    if (days !== null && ![1, 7, 30].includes(days)) {
      res.status(400).json({ error: 'Choose a valid expiration period.' }); return;
    }
    let shortCode = alias;
    if (alias && store.links.some(l => l.shortCode.toLowerCase() === alias.toLowerCase())) {
      res.status(409).json({ error: 'That alias is already in use.' }); return;
    }
    if (!shortCode) {
      do { shortCode = randomBytes(4).toString('hex'); }
      while (store.links.some(l => l.shortCode.toLowerCase() === shortCode.toLowerCase()));
    }
    const createdAt = new Date().toISOString();
    const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    const link: Link = { id: randomBytes(12).toString('hex'), shortCode, originalUrl, createdAt, expiresAt };
    store.links.push(link);
    await persist();
    res.status(201).json(formatLink(link));
  } catch (err) { res.status(500).json({ error: errorMessage(err) }); }
});
app.get('/api/links/:shortCode/stats', (req, res) => {
  const link = store.links.find(l => l.shortCode === req.params.shortCode);
  if (!link) { res.status(404).json({ error: 'Link not found.' }); return; }
  const clicks = store.clicks.filter(c => c.shortCode === link.shortCode).reverse();
  res.json({ shortCode: link.shortCode, originalUrl: link.originalUrl, totalClicks: clicks.length, clicks });
});
app.delete('/api/links/:shortCode', async (req, res) => {
  const index = store.links.findIndex(l => l.shortCode === req.params.shortCode);
  if (index < 0) { res.status(404).json({ error: 'Link not found.' }); return; }
  store.links.splice(index, 1);
  store.clicks = store.clicks.filter(c => c.shortCode !== req.params.shortCode);
  try { await persist(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: errorMessage(err) }); }
});
app.delete('/api/links', async (_req, res) => {
  store = { links: [], clicks: [] };
  try { await persist(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: errorMessage(err) }); }
});
app.get('/r/:shortCode', async (req, res) => {
  const link = store.links.find(l => l.shortCode === req.params.shortCode);
  if (!link) { res.status(404).send('This short link does not exist.'); return; }
  if (expired(link)) { res.status(410).send('This short link has expired.'); return; }
  store.clicks.push({ id: randomBytes(12).toString('hex'), shortCode: link.shortCode, clickedAt: new Date().toISOString(), referrer: req.get('referer') || null });
  try { await persist(); } catch (err) { console.error('Unable to save click:', err); }
  res.redirect(302, link.originalUrl);
});

async function start() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8')) as Store;
    if (!Array.isArray(parsed.links) || !Array.isArray(parsed.clicks)) throw new Error('Invalid database format');
    store = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  app.listen(PORT, () => console.log(`LinkForge API running at ${PUBLIC_BASE_URL}`));
}
start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
