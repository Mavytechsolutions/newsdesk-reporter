/**
 * Auto News — Step 2: read sources and keep a list of new items. No Claude here, so this step costs nothing.
 *
 * Reading rules:
 *  - Only http(s) addresses on the public internet (no server-internal addresses), 20 s time limit, 3 MB size limit.
 *  - We honour each site's robots.txt: if a site says automatic readers may not read the address, we don't.
 *  - We identify ourselves honestly: "MAVYNewsBot/1.0 (+https://www.mavynews.com/contact)".
 *  - Official alerts (NDMA Sachet CAP feed): only Andhra Pradesh / Telangana alerts that have not expired are kept.
 *  - Tip-only sources (other news outlets): only the headline + link are kept, never their text or photos.
 *  - Items older than 3 days are ignored. The same news from two sources is kept once (the second is marked duplicate).
 */
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { XMLParser } from 'fast-xml-parser';

export const USER_AGENT = 'MAVYNewsBot/1.0 (+https://www.mavynews.com/contact)';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_AGE_MS = 3 * 24 * 3600_000;

export class SourceError extends Error {}

// ---------- safe fetching ----------
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')) return true;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateAddress(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function checkHost(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SourceError('Only web addresses (http/https) can be read.');
  if (process.env.AUTO_NEWS_ALLOW_PRIVATE === '1') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
  if (!addrs.length) throw new SourceError(`The website ${u.hostname} could not be found.`);
  if (addrs.some(privateAddress)) throw new SourceError('This address points inside a private network and cannot be read.');
}

export async function safeFetch(url: string, accept = 'application/rss+xml, application/xml, text/xml, */*;q=0.5'): Promise<{ status: number; text: string; url: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    await checkHost(u);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: accept } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, u).toString();
        continue;
      }
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new SourceError('The page is too large to read.');
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) { await reader.cancel(); throw new SourceError('The page is too large to read.'); }
          chunks.push(value);
        }
      }
      return { status: res.status, text: Buffer.concat(chunks).toString('utf8'), url: current };
    } catch (e: any) {
      if (e instanceof SourceError) throw e;
      if (e?.name === 'AbortError') throw new SourceError('The website took too long to answer (more than 20 seconds).');
      throw new SourceError(`Could not reach the website (${e?.cause?.code || e?.message || 'network error'}).`);
    } finally { clearTimeout(timer); }
  }
  throw new SourceError('The website redirected too many times.');
}

// ---------- robots.txt ----------
const robotsCache = new Map<string, { at: number; rules: { allow: string[]; disallow: string[] } }>();
function toMatcher(pattern: string) {
  const re = '^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (pattern.endsWith('$') ? '' : '');
  return new RegExp(re.replace(/\\\$$/, '$'));
}
export function parseRobots(txt: string): { allow: string[]; disallow: string[] } {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' && val) cur.allow.push(val);
    if (key === 'disallow' && val) cur.disallow.push(val);
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && 'mavynewsbot'.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}
export function robotsAllows(rules: { allow: string[]; disallow: string[] }, pathAndQuery: string): boolean {
  const longest = (list: string[]) => list.filter((p) => toMatcher(p).test(pathAndQuery)).reduce((m, p) => Math.max(m, p.length), -1);
  const d = longest(rules.disallow);
  if (d < 0) return true;
  return longest(rules.allow) >= d;
}
export async function checkRobots(url: string) {
  const u = new URL(url);
  const key = u.origin;
  let entry = robotsCache.get(key);
  if (!entry || Date.now() - entry.at > 6 * 3600_000) {
    let rules = { allow: [] as string[], disallow: [] as string[] };
    try {
      const r = await safeFetch(`${u.origin}/robots.txt`, 'text/plain, */*;q=0.5');
      if (r.status === 200 && !/<html/i.test(r.text.slice(0, 500))) rules = parseRobots(r.text);
    } catch { /* no robots.txt reachable → allowed */ }
    entry = { at: Date.now(), rules };
    robotsCache.set(key, entry);
  }
  if (!robotsAllows(entry.rules, u.pathname + u.search)) {
    throw new SourceError('This website does not allow automatic reading of this address (robots.txt), so we skip it.');
  }
}
export function clearRobotsCache() { robotsCache.clear(); }

// ---------- feeds ----------
export interface FeedItem { id: string; title: string; link: string; summary: string; published: Date | null; author: string }
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, trimValues: true, processEntities: true, htmlEntities: true });
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => {
  if (x === undefined || x === null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (typeof x === 'object') return txt(x['#text'] ?? x['@href'] ?? '');
  return '';
};
export function plain(html: string, max = 1500): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function date(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeed(body: string): FeedItem[] {
  const head = body.slice(0, 2000);
  if (!/<(rss|feed|rdf:RDF|RDF)\b/i.test(head) && !/<\?xml/i.test(head)) {
    throw new SourceError('No news feed found at this address. (It is a normal web page; it needs a special reader.)');
  }
  let doc: any;
  try { doc = xml.parse(body); } catch { throw new SourceError('The feed could not be read (broken XML).'); }
  if (doc.rss || doc.RDF) {
    const ch = doc.rss?.channel ?? doc.RDF;
    const items = arr(ch?.item ?? doc.RDF?.item);
    return items.map((it: any) => {
      const link = txt(it.link) || txt(it.guid);
      return {
        id: txt(it.guid) || link || txt(it.title),
        title: plain(txt(it.title), 300),
        link,
        summary: plain(txt(it.description) || txt(it.encoded), 1500),
        published: date(txt(it.pubDate) || txt(it.date)),
        author: plain(txt(it.author) || txt(it.creator), 200),
      };
    });
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: any) => {
      const links = arr(e.link);
      const alt = links.find((l: any) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
      const link = typeof alt === 'string' ? alt : alt?.['@href'] ?? '';
      return {
        id: txt(e.id) || link,
        title: plain(txt(e.title), 300),
        link,
        summary: plain(txt(e.summary) || txt(e.content), 1500),
        published: date(txt(e.published) || txt(e.updated)),
        author: plain(txt(e.author?.name ?? e.author), 200),
      };
    });
  }
  throw new SourceError('No news feed found at this address.');
}

// ---------- official alerts (CAP: Common Alerting Protocol, used by NDMA Sachet / IMD / APSDMA) ----------
export interface AlertInfo {
  event: string; severity: string; urgency: string; certainty: string; sender: string;
  sent: string | null; expires: string | null; area: string;
  headlineEn: string; headlineTe: string; instructionEn: string; instructionTe: string;
}
export function parseCap(body: string): AlertInfo | null {
  if (!/<(cap:)?alert\b/i.test(body.slice(0, 1000))) return null;
  let doc: any;
  try { doc = xml.parse(body); } catch { return null; }
  const a = doc.alert;
  if (!a) return null;
  const infos = arr(a.info);
  const en = infos.find((i: any) => /^en/i.test(txt(i.language))) ?? infos[0];
  const te = infos.find((i: any) => /^(te|tl)/i.test(txt(i.language)));
  if (!en) return null;
  const areas = arr(en.area).map((x: any) => plain(txt(x.areaDesc), 300)).filter(Boolean);
  return {
    event: plain(txt(en.event), 100), severity: txt(en.severity), urgency: txt(en.urgency), certainty: txt(en.certainty),
    sender: plain(txt(a.sender), 120), sent: txt(a.sent) || null, expires: txt(en.expires) || null,
    area: areas.join('; ').slice(0, 500),
    headlineEn: plain(txt(en.headline), 500), headlineTe: te ? plain(txt(te.headline), 500) : '',
    instructionEn: plain(txt(en.instruction), 500), instructionTe: te ? plain(txt(te.instruction), 500) : '',
  };
}
/** Andhra Pradesh / Telangana alerts only. */
export function isOurRegion(...texts: string[]): boolean {
  return /andhra|telangana|amaravati|hyderabad|\bapsdma\b|\btgsdma\b|\bap\s*sdma\b|ఆంధ్ర|తెలంగాణ/i.test(texts.join(' '));
}

// ---------- duplicates ----------
export function fingerprint(title: string, area = ''): string {
  const norm = `${title} | ${area}`.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
  return createHash('sha1').update(norm).digest('hex');
}
