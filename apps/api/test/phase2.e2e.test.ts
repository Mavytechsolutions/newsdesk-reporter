/**
 * Phase 2 end-to-end tests: personalised feed, search, bookmarks, likes, history.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import * as schema from '../src/db/schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { seed } from '../src/db/seed';
import { SMS_PROVIDER, ConsoleSmsProvider } from '../src/auth/sms/sms.provider';

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let loc: Record<string, string>;
let admin: string, reader: string, guest: string;
const cat: Record<string, string> = {};
const ids: Record<string, string> = {};

const api = (p: string) => `/api/v1${p}`;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

async function publish(key: string, headline: string, categorySlug: string, locationIds: string[], extra: Record<string, unknown> = {}) {
  const r = await http.post(api('/newsroom/articles')).set(as(admin)).send({
    categoryId: cat[categorySlug], locationIds,
    translations: [
      { language: 'te', headline: `తెలుగు ${headline}`, summary: 'పరీక్ష సారాంశం ఇక్కడ ఉంది.', body: 'పూర్తి వార్త పరీక్ష కోసం.' },
      { language: 'en', headline, summary: `Summary about ${headline}.`, body: 'Full story text for testing.' },
    ],
    ...extra,
  }).expect(201);
  for (const action of ['submit', 'start_review', 'approve', 'publish'])
    await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(admin)).send({ action }).expect(200);
  ids[key] = r.body.id;
}

beforeAll(async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  loc = (await seed(db, { samples: false })).ids;
  for (const r of (await pool.query('select id, slug from categories')).rows) cat[r.slug] = r.id;

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;

  admin = (await http.post(api('/auth/staff/login')).send({ email: 'admin@test.mavy', password: 'AdminPass12345' })).body.accessToken;
  await http.post(api('/auth/otp/request')).send({ phone: '9876500000' }).expect(200);
  const code = app.get<ConsoleSmsProvider>(SMS_PROVIDER).sent.get('+919876500000');
  reader = (await http.post(api('/auth/otp/verify')).send({ phone: '9876500000', code })).body.accessToken;
  guest = (await http.post(api('/auth/guest'))).body.accessToken;

  await publish('lepakshi', 'Lepakshi temple festival', 'education', [loc['mandal-lepakshi--sri-sathya-sai']], { tags: ['festival'] });
  await publish('tadipatri', 'Tadipatri road works', 'business', [loc['mandal-tadipatri--anantapur']]);
  await publish('state', 'Andhra Pradesh cabinet meeting', 'politics', [loc['andhra-pradesh']]);
  await publish('breaking', 'Heavy rain alert in Hindupur', 'health', [loc['muni-hindupur--sri-sathya-sai']], { isBreaking: true });
  await publish('crop', 'Groundnut prices rise', 'agriculture', [loc['mandal-kadiri--sri-sathya-sai']]);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

const idsOf = (r: any) => r.body.items.map((a: any) => a.id);

describe('Personalised feed', () => {
  it('with no preferences, For You shows everything newest first', async () => {
    const r = await http.get(api('/feed')).set(as(reader)).expect(200);
    expect(idsOf(r)).toEqual([ids.crop, ids.breaking, ids.state, ids.tadipatri, ids.lepakshi]);
  });

  it('For You = my places + my categories + breaking + statewide news', async () => {
    await http.put(api('/me/locations')).set(as(reader)).send({ locationIds: [loc['dist-anantapur']] }).expect(200);
    await http.put(api('/me/categories')).set(as(reader)).send({ categoryIds: [cat.agriculture] }).expect(200);
    const r = await http.get(api('/feed?tab=for-you')).set(as(reader)).expect(200);
    expect(idsOf(r).sort()).toEqual([ids.crop, ids.breaking, ids.state, ids.tadipatri].sort());
    expect(idsOf(r)).not.toContain(ids.lepakshi);
  });

  it('Local tab shows only my places; guests send places from the phone', async () => {
    const mine = await http.get(api('/feed?tab=local')).set(as(reader)).expect(200);
    expect(idsOf(mine)).toEqual([ids.tadipatri]);
    const g = await http.get(api(`/feed?tab=local&locationIds=${loc['dist-sri-sathya-sai']}`)).set(as(guest)).expect(200);
    expect(idsOf(g).sort()).toEqual([ids.crop, ids.breaking, ids.lepakshi].sort());
    const none = await http.get(api('/feed?tab=local')).expect(200);
    expect(none.body.needsLocation).toBe(true);
  });

  it('Breaking and category tabs filter correctly; unknown tab is 404', async () => {
    expect(idsOf(await http.get(api('/feed?tab=breaking')).expect(200))).toEqual([ids.breaking]);
    expect(idsOf(await http.get(api('/feed?tab=politics')).expect(200))).toEqual([ids.state]);
    await http.get(api('/feed?tab=nonsense')).expect(404);
  });
});

describe('Search', () => {
  it('finds by Telugu or English words, tags, and place names', async () => {
    expect(idsOf(await http.get(api('/search?q=road')).expect(200))).toEqual([ids.tadipatri]);
    expect(idsOf(await http.get(api(`/search?q=${encodeURIComponent('తెలుగు Groundnut')}`)).expect(200))).toEqual([ids.crop]);
    expect(idsOf(await http.get(api('/search?q=festival')).expect(200))).toEqual([ids.lepakshi]);
    expect(idsOf(await http.get(api('/search?q=Hindupur')).expect(200))).toEqual([ids.breaking]);
  });

  it('filters by district and suggests a spelling when nothing is found', async () => {
    const r = await http.get(api(`/search?q=a&locationId=${loc['dist-anantapur']}`)).expect(400); // too short
    const f = await http.get(api(`/search?q=summary&locationId=${loc['dist-anantapur']}`)).expect(200);
    expect(idsOf(f).sort()).toEqual([ids.tadipatri].sort());
    const typo = await http.get(api('/search?q=Lepaksi')).expect(200);
    expect(typo.body.items).toHaveLength(0);
    expect(typo.body.didYouMean).toBe('Lepakshi');
    void r;
  });

  it('autocomplete returns places and tags', async () => {
    const r = await http.get(api('/search/suggest?q=lep')).expect(200);
    expect(r.body.locations[0].nameEn).toBe('Lepakshi');
    const t = await http.get(api('/search/suggest?q=fest')).expect(200);
    expect(t.body.tags).toEqual(['festival']);
  });
});

describe('Bookmarks, likes, shares, history', () => {
  it('reader bookmarks a story; feed and article show it as bookmarked', async () => {
    await http.put(api(`/me/bookmarks/${ids.state}`)).set(as(reader)).expect(200);
    await http.put(api(`/me/bookmarks/${ids.state}`)).set(as(reader)).expect(200); // twice is fine
    const list = await http.get(api('/me/bookmarks?lang=en')).set(as(reader)).expect(200);
    expect(list.body.map((a: any) => a.id)).toEqual([ids.state]);
    expect(list.body[0].body).toBeTruthy(); // full text, so the phone can keep it for offline reading
    const feed = await http.get(api('/feed?tab=politics')).set(as(reader)).expect(200);
    expect(feed.body.items[0].bookmarked).toBe(true);
    await http.delete(api(`/me/bookmarks/${ids.state}`)).set(as(reader)).expect(200);
    expect((await http.get(api('/me/bookmarks')).set(as(reader))).body).toHaveLength(0);
  });

  it('likes count once per reader and can be undone', async () => {
    const a = await http.post(api(`/articles/${ids.crop}/like`)).set(as(reader)).send({ liked: true }).expect(200);
    await http.post(api(`/articles/${ids.crop}/like`)).set(as(reader)).send({ liked: true }).expect(200);
    expect(a.body.likeCount).toBe(1);
    const slug = (await pool.query('select slug from articles where id=$1', [ids.crop])).rows[0].slug;
    const art = await http.get(api(`/articles/${slug}`)).set(as(reader)).expect(200);
    expect(art.body.liked).toBe(true);
    expect(art.body.likeCount).toBe(1);
    const un = await http.post(api(`/articles/${ids.crop}/like`)).set(as(reader)).send({ liked: false }).expect(200);
    expect(un.body.likeCount).toBe(0);
  });

  it('guests must log in to like or bookmark, but shares are counted', async () => {
    await http.post(api(`/articles/${ids.crop}/like`)).set(as(guest)).send({ liked: true }).expect(403);
    await http.put(api(`/me/bookmarks/${ids.crop}`)).set(as(guest)).expect(403);
    const s = await http.post(api(`/articles/${ids.crop}/share`)).expect(200);
    expect(s.body.shareCount).toBe(1);
  });

  it('reading history is recorded and can be reset', async () => {
    await http.post(api(`/articles/${ids.lepakshi}/read`)).set(as(reader)).expect(200);
    await http.post(api(`/articles/${ids.tadipatri}/read`)).set(as(reader)).expect(200);
    const h = await http.get(api('/me/history')).set(as(reader)).expect(200);
    expect(h.body.map((a: any) => a.id)).toEqual([ids.tadipatri, ids.lepakshi]);
    await http.delete(api('/me/personalization')).set(as(reader)).expect(200);
    expect((await http.get(api('/me/history')).set(as(reader))).body).toHaveLength(0);
    expect((await http.get(api('/me')).set(as(reader))).body.categories).toHaveLength(0);
  });
});
