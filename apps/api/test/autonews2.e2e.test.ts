/**
 * Auto News Step 2: reading sources, robots.txt, AP/Telangana alerts only, duplicates, tips, and the check log.
 * Uses a small fake website on this computer so the test never depends on real sites.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import * as schema from '../src/db/schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { seed } from '../src/db/seed';
import { clearRobotsCache, fingerprint, parseRobots, robotsAllows } from '../src/auto-news/collector';

let app: INestApplication;
let api: ReturnType<typeof request>;
let pool: Pool;
let site: http.Server;
let base = '';
let admin = '';
const v1 = (p: string) => `/api/v1${p}`;
const as = () => ({ Authorization: `Bearer ${admin}` });

const now = new Date();
const old = new Date(Date.now() - 5 * 24 * 3600_000);
const later = new Date(Date.now() + 2 * 3600_000).toISOString();
const before = new Date(Date.now() - 2 * 3600_000).toISOString();
const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const item = (id: string, title: string, d: Date, extra = '') =>
  `<item><guid>${id}</guid><title>${title}</title><link>${base}/news/${id}</link><description>&lt;p&gt;Text of ${title}&lt;/p&gt;</description><pubDate>${d.toUTCString()}</pubDate>${extra}</item>`;
const cap = (area: string, expires: string) => `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:sender>Andhra-Pradesh-SDMA</cap:sender><cap:sent>${now.toISOString()}</cap:sent>
<cap:info><cap:language>en-IN</cap:language><cap:event>Lightning</cap:event><cap:severity>Severe</cap:severity><cap:urgency>Expected</cap:urgency><cap:certainty>Possible</cap:certainty>
<cap:expires>${expires}</cap:expires><cap:headline>Lightning is likely over ${area}.</cap:headline><cap:instruction>Stay indoors.</cap:instruction><cap:area><cap:areaDesc>${area}</cap:areaDesc></cap:area></cap:info>
<cap:info><cap:language>TL</cap:language><cap:event>Lightning</cap:event><cap:expires>${expires}</cap:expires><cap:headline>పిడుగులు పడే అవకాశం</cap:headline><cap:area><cap:areaDesc>${area}</cap:areaDesc></cap:area></cap:info></cap:alert>`;

function pages(): Record<string, string> {
  return {
    '/robots.txt': 'User-agent: *\nDisallow: /private\n',
    '/feed.xml': rss(item('a1', 'Collector reviews drinking water supply in Anantapur', now) + item('a2', 'Free health camp at Hindupur on Sunday', now) + item('a3', 'Old news', old)),
    '/feed2.xml': rss(item('b1', 'Collector reviews drinking-water supply in Anantapur!', now)),
    '/private/feed.xml': rss(item('p1', 'Hidden', now)),
    '/page.html': '<!doctype html><html><body><h1>Press releases</h1></body></html>',
    '/tips.xml': rss(item('t1', 'Big story on another channel', now)),
    '/alerts.xml': rss(
      `<item><guid>c1</guid><title>పిడుగులు</title><link>${base}/cap/c1</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author><pubDate>${now.toUTCString()}</pubDate></item>`
      + `<item><guid>c2</guid><title>മിന്നൽ</title><link>${base}/cap/c2</link><author>controlroom@ndma.gov.in (IMD Thiruvananthapuram)</author><pubDate>${now.toUTCString()}</pubDate></item>`
      + `<item><guid>c3</guid><title>పిడుగులు</title><link>${base}/cap/c3</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author><pubDate>${now.toUTCString()}</pubDate></item>`
      + `<item><guid>c4</guid><title>పిడుగులు</title><link>${base}/cap/missing</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author><pubDate>${now.toUTCString()}</pubDate></item>`
      + `<item><guid>c5</guid><title>పిడుగులు</title><link>${base}/cap/c1</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author><pubDate>${new Date(Date.now() - 30 * 3600_000).toUTCString()}</pubDate></item>`),
    '/cap/c1': cap('atp-Gooty Mandal', later),
    '/cap/c2': cap('Kochi', later),
    '/cap/c3': cap('atp-Tadipatri Mandal', before),
  };
}

beforeAll(async () => {
  site = http.createServer((req, res) => {
    const body = pages()[(req.url || '').split('?')[0]];
    if (!body) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', req.url?.endsWith('.html') ? 'text/html' : 'application/xml');
    res.end(body);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  await seed(db, { samples: false });
  // real sources must never be called from the test
  await pool.query('update auto_news_sources set enabled = false');
  process.env.AUTO_NEWS_ALLOW_PRIVATE = '1';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  api = request(app.getHttpServer()) as any;
  admin = (await api.post(v1('/auth/staff/login')).send({ email: 'admin', password: 'AdminPass12345' }).expect(200)).body.accessToken;
});
afterAll(async () => { delete process.env.AUTO_NEWS_ALLOW_PRIVATE; await app?.close(); await pool?.end(); site?.close(); });

async function addSource(name: string, p: string, kind: string) {
  return (await api.post(v1('/admin/auto-news/sources')).set(as()).send({ name, url: `${base}${p}`, kind }).expect(201)).body.source.id as string;
}
const items = async (q = '') => (await api.get(v1(`/admin/auto-news/items${q}`)).set(as()).expect(200)).body as any[];

describe('Starting sources', () => {
  it('AP I&PR is listed but switched off with a note; NDMA alerts and PIB are added', async () => {
    const { rows } = await pool.query('select name, kind, note from auto_news_sources order by created_at');
    expect(rows.map((r) => r.kind)).toEqual(['PRESS_RELEASE', 'OFFICIAL_ALERT', 'RSS']);
    expect(rows[0].note).toMatch(/no readable press-release list/);
  });
});

describe('Robots rules', () => {
  it('reads robots.txt the usual way', () => {
    const r = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\n');
    expect(robotsAllows(r, '/news/1')).toBe(true);
    expect(robotsAllows(r, '/admin/x')).toBe(false);
    expect(robotsAllows(r, '/admin/public/feed')).toBe(true);
    const mine = parseRobots('User-agent: MAVYNewsBot\nDisallow: /\nUser-agent: *\nDisallow:\n');
    expect(robotsAllows(mine, '/feed.xml')).toBe(false);
  });
});

describe('Collecting', () => {
  let feed = '';
  it('keeps new items, ignores items older than 3 days, and logs the check', async () => {
    feed = await addSource('Test press releases', '/feed.xml', 'RSS');
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: feed }).expect(200);
    expect(r.body.results[0]).toMatchObject({ found: 3, added: 2, skipped: 1, error: null });
    const list = await items();
    expect(list.map((x) => x.title)).toEqual(expect.arrayContaining(['Collector reviews drinking water supply in Anantapur', 'Free health camp at Hindupur on Sunday']));
    expect(list[0].summary).toMatch(/^Text of /);
    expect(list[0].summary).not.toMatch(/</);
    const runs = (await api.get(v1('/admin/auto-news/runs')).set(as()).expect(200)).body;
    expect(runs[0]).toMatchObject({ sourceName: 'Test press releases', trigger: 'manual', added: 2 });
  });
  it('checking again adds nothing new', async () => {
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: feed }).expect(200);
    expect(r.body.results[0]).toMatchObject({ added: 0, duplicates: 0 });
  });
  it('the same news from a second source is marked as a duplicate', async () => {
    const id = await addSource('Second source', '/feed2.xml', 'RSS');
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: id }).expect(200);
    expect(r.body.results[0]).toMatchObject({ added: 0, duplicates: 1 });
    const d = (await items('?status=DUPLICATE'))[0];
    expect(d.duplicateOf).toBeTruthy();
    expect(fingerprint('Collector reviews drinking-water supply in Anantapur!')).toBe(fingerprint('collector reviews drinking water supply in anantapur'));
  });
  it('tip-only sources keep only the headline and link', async () => {
    const id = await addSource('Other channel', '/tips.xml', 'TIP_ONLY');
    await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: id }).expect(200);
    const t = (await items('?status=TIP'))[0];
    expect(t).toMatchObject({ title: 'Big story on another channel', summary: null });
  });
  it('official alerts: only AP/Telangana, not expired, only with their details (place, expiry), with Telugu headline', async () => {
    const id = await addSource('Test alerts', '/alerts.xml', 'OFFICIAL_ALERT');
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: id }).expect(200);
    expect(r.body.results[0]).toMatchObject({ found: 5, added: 1, skipped: 4 });
    // an alert whose details cannot be read (no place, no expiry) is not saved — it is tried again next time
    const { rows } = await pool.query("select count(*)::int n from auto_news_items where external_id in ('c4','c5')");
    expect(rows[0].n).toBe(0);
    const a = (await items()).find((x) => x.alert);
    expect(a).toMatchObject({ title: 'Lightning is likely over atp-Gooty Mandal.', area: 'atp-Gooty Mandal' });
    expect(a.alert).toMatchObject({ event: 'Lightning', severity: 'Severe', headlineTe: 'పిడుగులు పడే అవకాశం' });
  });
  it('respects robots.txt and explains pages without a feed', async () => {
    const hidden = await addSource('Hidden', '/private/feed.xml', 'RSS');
    const r1 = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: hidden }).expect(200);
    expect(r1.body.results[0].error).toMatch(/robots\.txt/);
    const page = await addSource('Plain page', '/page.html', 'PRESS_RELEASE');
    const r2 = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: page }).expect(200);
    expect(r2.body.results[0].error).toMatch(/No news feed found/);
    const src = (await api.get(v1('/admin/auto-news')).set(as())).body.sources.find((s: any) => s.id === page);
    expect(src.lastError).toMatch(/No news feed found/);
    expect(src.lastCheckedAt).toBeTruthy();
  });
  it('never reads addresses inside a private network on the real server', async () => {
    delete process.env.AUTO_NEWS_ALLOW_PRIVATE;
    clearRobotsCache();
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({ sourceId: feed }).expect(200);
    expect(r.body.results[0].error).toMatch(/private network/);
    process.env.AUTO_NEWS_ALLOW_PRIVATE = '1';
  });
  it('shows today\'s counts on the settings page', async () => {
    const r = await api.get(v1('/admin/auto-news')).set(as()).expect(200);
    expect(r.body.today).toMatchObject({ new: 3, duplicates: 1, tips: 1, found: 5 });
  });
  it('"Check now" without a source checks all switched-on sources', async () => {
    const r = await api.post(v1('/admin/auto-news/check-now')).set(as()).send({}).expect(200);
    expect(r.body.results.length).toBe(6);
  });
});
