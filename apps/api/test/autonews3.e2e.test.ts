/**
 * Auto News Step 3: Claude key (saved encrypted, never shown), Quick convert (WhatsApp press note → Telugu + English
 * post waiting for approval by "MAVY Desk"), safety rules, area rules for sub-admins, and the rupee daily limit.
 * A pretend Claude runs on this computer: the real Claude is never called and nothing is charged.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import http from 'http';
import { AddressInfo } from 'net';
import sharp from 'sharp';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import * as schema from '../src/db/schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { seed } from '../src/db/seed';

const GOOD = 'sk-ant-api03-GOODKEY0123456789abcdefghijklmnop-WXYZ';
let app: INestApplication;
let api: ReturnType<typeof request>;
let pool: Pool;
let fake: http.Server;
let admin = '';
let subAdmin = '';
const v1 = (p: string) => `/api/v1${p}`;
const as = (t = admin) => ({ Authorization: `Bearer ${t}` });

/** What the pretend Claude answers next. */
let reply: any = null;
let replyStatus = 200;
const seen: any[] = [];
const post = (over: any = {}) => ({
  te_headline: 'గుత్తిలో తాగునీటి సరఫరాపై కలెక్టర్ సమీక్ష', te_story: 'గుత్తి మండలంలో తాగునీటి సరఫరాపై జిల్లా కలెక్టర్ బుధవారం అధికారులతో సమీక్ష నిర్వహించారు. వేసవిలో ఇబ్బందులు లేకుండా చర్యలు తీసుకోవాలని ఆదేశించారు.',
  en_headline: 'Collector reviews drinking water supply in Gooty', en_story: 'The district Collector held a review meeting with officials on drinking water supply in Gooty mandal on Wednesday and directed them to take steps to avoid shortages in summer.',
  category: 'general', state: 'Andhra Pradesh', district: 'Anantapur', mandal: 'Gooty',
  needs_verification: false, verification_reason: '', missing_info: '', not_news: false, ...over,
});

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const key = req.headers['x-api-key'];
      res.setHeader('Content-Type', 'application/json');
      if (key !== GOOD) { res.statusCode = 401; return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
      if (req.url?.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5' }] }));
      seen.push(JSON.parse(body));
      res.statusCode = replyStatus;
      if (replyStatus !== 200) return res.end(JSON.stringify({ type: 'error', error: { message: 'Your credit balance is too low' } }));
      res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'write_post', input: reply ?? post() }], usage: { input_tokens: 3000, output_tokens: 1200 } }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  delete process.env.ANTHROPIC_API_KEY;

  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  await seed(db, { samples: false });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  api = request(app.getHttpServer()) as any;
  admin = (await api.post(v1('/auth/staff/login')).send({ email: 'admin', password: 'AdminPass12345' }).expect(200)).body.accessToken;
  const { rows } = await pool.query("select id from locations where type = 'DISTRICT' and name_en = 'Sri Sathya Sai'");
  await api.post(v1('/admin/staff')).set(as()).send({ email: 'ssd@test.mavy', password: 'SubAdmin12345', name: 'SSS sub-admin', role: 'DISTRICT_EDITOR', locationIds: [rows[0].id] }).expect(201);
  subAdmin = (await api.post(v1('/auth/staff/login')).send({ email: 'ssd@test.mavy', password: 'SubAdmin12345' }).expect(200)).body.accessToken;
});
afterAll(async () => { delete process.env.ANTHROPIC_BASE_URL; await app?.close(); await pool?.end(); fake?.close(); });

const quick = (fields: Record<string, string>, token = admin) => {
  const r = api.post(v1('/admin/quick-news')).set(as(token));
  Object.entries(fields).forEach(([k, v]) => r.field(k, v));
  return r;
};
const NOTE = 'జిల్లా కలెక్టర్ బుధవారం గుత్తి మండలంలో తాగునీటి సరఫరాపై అధికారులతో సమీక్ష నిర్వహించారు. — I&PR Anantapur';

describe('Claude key', () => {
  it('starts with no key; Quick convert explains it', async () => {
    const r = await api.get(v1('/admin/auto-news')).set(as()).expect(200);
    expect(r.body.keyConfigured).toBe(false);
    const q = await quick({ text: NOTE, sourceKind: 'OFFICIAL', sourceName: 'I&PR Anantapur' }).expect(503);
    expect(q.body.message).toMatch(/key is not set/);
  });
  it('refuses something that is not a key, and a key Claude rejects', async () => {
    await api.put(v1('/admin/auto-news/api-key')).set(as()).send({ key: 'hello this is not a key at all' }).expect(400);
    const r = await api.put(v1('/admin/auto-news/api-key')).set(as()).send({ key: 'sk-ant-api03-BADKEY0123456789abcdefghijklmnop' }).expect(400);
    expect(r.body.message).toMatch(/not valid/);
  });
  it('only the master admin can save it', async () => {
    await api.put(v1('/admin/auto-news/api-key')).set(as(subAdmin)).send({ key: GOOD }).expect(403);
  });
  it('saves a good key encrypted; only the last 4 characters are ever shown', async () => {
    const r = await api.put(v1('/admin/auto-news/api-key')).set(as()).send({ key: GOOD }).expect(200);
    expect(r.body).toMatchObject({ configured: true, where: 'saved', last4: 'WXYZ' });
    const o = await api.get(v1('/admin/auto-news')).set(as()).expect(200);
    expect(JSON.stringify(o.body)).not.toContain('GOODKEY');
    const { rows } = await pool.query('select * from auto_news_secrets');
    expect(JSON.stringify(rows)).not.toContain('GOODKEY');
    const audit = await pool.query("select metadata from audit_logs where action = 'auto_news.api_key_saved'");
    expect(JSON.stringify(audit.rows)).not.toContain('GOODKEY');
  });
});

describe('Quick convert', () => {
  let articleId = '';
  it('turns an official press note into a Telugu + English post waiting for approval, by MAVY Desk, at the right mandal', async () => {
    const r = await quick({ text: NOTE, sourceKind: 'OFFICIAL', sourceName: 'I&PR Anantapur', sourceUrl: 'https://ananthapuramu.ap.gov.in/x' }).expect(201);
    articleId = r.body.articleId;
    expect(r.body).toMatchObject({ notNews: false, status: 'SUBMITTED', placeFound: true, needsVerification: false });
    expect(r.body.place).toContain('Gooty');
    expect(r.body.costInr).toBeGreaterThan(0);
    const a = (await pool.query(`select a.status, a.source_type, a.source_name, u.name author from articles a join users u on u.id = a.author_id where a.id = $1`, [articleId])).rows[0];
    expect(a).toMatchObject({ status: 'SUBMITTED', source_type: 'AI_ASSISTED', source_name: 'I&PR Anantapur', author: 'MAVY Desk' });
    const tr = (await pool.query('select language, headline, body from article_translations where article_id = $1 order by language', [articleId])).rows;
    tr.sort((x, y) => x.language.localeCompare(y.language));
    expect(tr.map((t) => t.language)).toEqual(['en', 'te']);
    expect(tr[0].body).toContain('Source: I&PR Anantapur — https://ananthapuramu.ap.gov.in/x');
    const loc = (await pool.query('select l.name_en, l.type from article_locations al join locations l on l.id = al.location_id where al.article_id = $1', [articleId])).rows[0];
    expect(loc.name_en).toBe('Gooty');
    // Claude was told the rules and given only our district list
    const req = seen[seen.length - 1];
    expect(req.system).toMatch(/Use ONLY facts stated in the material/);
    expect(req.system).toMatch(/Never name or identify a victim of rape/);
    expect(JSON.stringify(req.messages)).toContain('Anantapur (అనంతపురం) — Andhra Pradesh');
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'write_post' });
  });
  it('records the cost in rupees and the log of where it came from', async () => {
    const { rows } = await pool.query('select origin, source_kind, source_name, input_text, cost_paise, article_id from auto_news_posts where article_id = $1', [articleId]);
    expect(rows[0]).toMatchObject({ origin: 'quick', source_kind: 'OFFICIAL', source_name: 'I&PR Anantapur', input_text: NOTE });
    // 3000 in × $2 + 1200 out × $10 per million = $0.018 → ₹1.62 at ₹90/$
    expect(rows[0].cost_paise).toBe(162);
    const u = await api.get(v1('/admin/quick-news/usage')).set(as()).expect(200);
    expect(u.body).toMatchObject({ spentTodayInr: 1.62, limitInr: 100, keyConfigured: true });
  });
  it('can be edited and then approved like any story; readers see "MAVY Desk"', async () => {
    await api.patch(v1(`/newsroom/articles/${articleId}`)).set(as()).send({ translations: [
      { language: 'te', headline: 'గుత్తిలో తాగునీటిపై కలెక్టర్ సమీక్ష', summary: 'గుత్తి మండలంలో తాగునీటి సరఫరాపై కలెక్టర్ సమీక్షించారు.', body: 'గుత్తి మండలంలో తాగునీటి సరఫరాపై కలెక్టర్ సమీక్షించారు.' },
      { language: 'en', headline: 'Collector reviews water supply in Gooty', summary: 'The Collector reviewed drinking water supply in Gooty mandal.', body: 'The Collector reviewed drinking water supply in Gooty mandal.' },
    ] }).expect(200);
    for (const action of ['start_review', 'approve', 'publish'])
      await api.post(v1(`/newsroom/articles/${articleId}/transition`)).set(as()).send({ action }).expect(200);
    const slug = (await pool.query('select slug, status from articles where id = $1', [articleId])).rows[0];
    expect(slug.status).toBe('PUBLISHED');
    const pub = await api.get(v1(`/articles/${slug.slug}?lang=te`)).expect(200);
    expect(pub.body.reporter).toBe('MAVY Desk');
  });
  it('unverified forwards are flagged, and their photos can never be used', async () => {
    reply = post({ needs_verification: true, verification_reason: 'Forwarded claim without an official source' });
    const r = await quick({ text: 'ఫార్వర్డ్: గుత్తిలో ప్రమాదం అని వార్త', sourceKind: 'UNVERIFIED', sourceName: 'WhatsApp group forward' }).expect(201);
    expect(r.body).toMatchObject({ needsVerification: true, verificationReason: 'Forwarded claim without an official source' });
    const tags = (await pool.query('select tag from article_tags where article_id = $1', [r.body.articleId])).rows.map((x) => x.tag);
    expect(tags).toEqual(expect.arrayContaining(['mavy-desk', 'needs-verification']));
    const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const bad = await quick({ text: 'x forward', sourceKind: 'UNVERIFIED', sourceName: 'WhatsApp', usePhoto: 'true' }).attach('photos', jpg, 'a.jpg').expect(400);
    expect(bad.body.message).toMatch(/cannot be used/);
    reply = null;
  });
  it('reads a photo of a press note and can use an official photo in the story, credited to the source', async () => {
    const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ddd' } }).jpeg().toBuffer();
    const r = await quick({ sourceKind: 'OFFICIAL', sourceName: 'Collectorate PRO', usePhoto: 'true' }).attach('photos', jpg, 'note.jpg').expect(201);
    expect(r.body.heroImageUrl).toMatch(/\.jpg$/);
    const a = (await pool.query('select hero_image_credit from articles where id = $1', [r.body.articleId])).rows[0];
    expect(a.hero_image_credit).toBe('Collectorate PRO');
    const req = seen[seen.length - 1];
    expect(req.messages[0].content[0].type).toBe('image');
  });
  it('makes no post when Claude says it is not news', async () => {
    reply = post({ not_news: true });
    const before = (await pool.query('select count(*)::int n from articles')).rows[0].n;
    const r = await quick({ text: 'Good morning friends 🌞', sourceKind: 'UNVERIFIED', sourceName: 'Group' }).expect(201);
    expect(r.body.notNews).toBe(true);
    expect((await pool.query('select count(*)::int n from articles')).rows[0].n).toBe(before);
    reply = null;
  });
  it('a sub-admin can convert news only for their own district', async () => {
    const r = await quick({ text: NOTE, sourceKind: 'OFFICIAL', sourceName: 'I&PR Anantapur' }, subAdmin).expect(403);
    expect(r.body.message).toMatch(/outside your area/);
    reply = post({ district: 'Sri Sathya Sai', mandal: 'Hindupur', te_headline: 'హిందూపురంలో ఆరోగ్య శిబిరం', en_headline: 'Health camp in Hindupur' });
    const ok = await quick({ text: 'Hindupur health camp on Sunday — DMHO', sourceKind: 'OFFICIAL', sourceName: 'DMHO Sri Sathya Sai' }, subAdmin).expect(201);
    expect(ok.body.place).toMatch(/Sri Sathya Sai|Hindupur/);
    reply = null;
  });
  it('needs text or a photo', async () => {
    await quick({ text: '', sourceKind: 'OFFICIAL', sourceName: 'x' }).expect(400);
  });
  it('explains a Claude account without credit', async () => {
    replyStatus = 400;
    const r = await quick({ text: NOTE, sourceKind: 'OFFICIAL', sourceName: 'I&PR' });
    expect(r.body.message).toMatch(/no credit left/);
    replyStatus = 200;
  });
  it('stops for the day when the rupee limit is reached', async () => {
    await api.patch(v1('/admin/auto-news/settings')).set(as()).send({ dailyCostLimitInr: 5 }).expect(200);
    const r = await quick({ text: NOTE, sourceKind: 'OFFICIAL', sourceName: 'I&PR' }).expect(429);
    expect(r.body.message).toMatch(/limit \(₹5\) is used up/);
    await api.patch(v1('/admin/auto-news/settings')).set(as()).send({ dailyCostLimitInr: 100 }).expect(200);
  });
  it('the MAVY Desk byline cannot log in', async () => {
    await api.post(v1('/auth/staff/login')).send({ email: 'desk@mavynews.in', password: 'anything-at-all-1' }).expect(401);
  });
  it('the key can be removed', async () => {
    const r = await api.delete(v1('/admin/auto-news/api-key')).set(as()).expect(200);
    expect(r.body.configured).toBe(false);
  });
});
