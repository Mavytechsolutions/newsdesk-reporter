/**
 * Phase 1 end-to-end tests: real HTTP calls against a real PostgreSQL test database.
 * Run with: npm test   (needs PostgreSQL running; uses database "mavy_test")
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
import { ArticlesService } from '../src/articles/articles.service';

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let loc: Record<string, string>;
const tok: Record<string, string> = {};
let categoryId: string;

const api = (p: string) => `/api/v1${p}`;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

async function otpLogin(phone: string) {
  await http.post(api('/auth/otp/request')).send({ phone }).expect(200);
  const sms = app.get<ConsoleSmsProvider>(SMS_PROVIDER);
  const code = sms.sent.get(`+91${phone.slice(-10)}`)!;
  const res = await http.post(api('/auth/otp/verify')).send({ phone, code }).expect(200);
  return res.body as { accessToken: string; refreshToken: string; userId: string; isNewUser: boolean };
}

const article = (headline: string, locationIds: string[], extra: Record<string, unknown> = {}) => ({
  categoryId,
  locationIds,
  translations: [
    { language: 'te', headline: `తెలుగు ${headline}`, summary: 'ఇది పరీక్ష సారాంశం. స్థానిక వార్త వివరాలు.', body: 'పూర్తి వార్త వివరాలు ఇక్కడ ఉంటాయి.' },
    { language: 'en', headline, summary: 'This is a test summary of a local story.', body: 'The full story text goes here for testing.' },
  ],
  ...extra,
});

beforeAll(async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await admin.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await admin.query('CREATE DATABASE mavy_test');
  await admin.end();

  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  const seeded = await seed(db, { samples: false });
  loc = seeded.ids;
  categoryId = (await pool.query("select id from categories where slug='agriculture'")).rows[0].id;

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('Health & reference data', () => {
  it('health check reports database ok', async () => {
    const r = await http.get(api('/health')).expect(200);
    expect(r.body.database).toBe('ok');
  });
  it('lists categories in Telugu and English', async () => {
    const r = await http.get(api('/categories')).expect(200);
    expect(r.body).toHaveLength(19);
    expect(r.body.find((c: any) => c.slug === 'agriculture').nameTe).toBe('వ్యవసాయం');
  });
  it('browses the location tree and searches in Telugu', async () => {
    const states = await http.get(api('/locations')).expect(200);
    expect(states.body.map((s: any) => s.nameEn)).toEqual(['Andhra Pradesh', 'Telangana']);
    const districts = await http.get(api(`/locations?parentId=${loc['andhra-pradesh']}`)).expect(200);
    expect(districts.body).toHaveLength(28); // AP after the Dec 2025 reorganisation
    expect(districts.body.map((d: any) => d.nameEn)).toEqual(expect.arrayContaining(['Anantapur', 'Sri Sathya Sai', 'Polavaram', 'Markapuram']));
    const found = await http.get(api('/locations/search').concat('?q=' + encodeURIComponent('లేపాక్షి'))).expect(200);
    expect(found.body[0].nameEn).toBe('Lepakshi');
    const one = await http.get(api(`/locations/${loc['mandal-lepakshi--sri-sathya-sai']}`)).expect(200);
    expect(one.body.breadcrumb.map((b: any) => b.nameEn)).toEqual(['Andhra Pradesh', 'Sri Sathya Sai']);
  });
});

describe('Reader accounts (phone OTP)', () => {
  it('rejects an invalid phone number', async () => {
    await http.post(api('/auth/otp/request')).send({ phone: '12345' }).expect(400);
  });

  it('wrong OTP is refused, right OTP logs in and creates the reader', async () => {
    await http.post(api('/auth/otp/request')).send({ phone: '9876543210' }).expect(200);
    await http.post(api('/auth/otp/verify')).send({ phone: '9876543210', code: '000000' }).expect(401);
    const code = app.get<ConsoleSmsProvider>(SMS_PROVIDER).sent.get('+919876543210')!;
    const r = await http.post(api('/auth/otp/verify')).send({ phone: '+91 98765 43210', code }).expect(200);
    expect(r.body.isNewUser).toBe(true);
    tok.reader = r.body.accessToken;
    tok.readerRefresh = r.body.refreshToken;
    const stored = await pool.query("select code_hash from otp_requests where phone='+919876543210'");
    expect(stored.rows[0].code_hash).not.toBe(code); // OTPs are never stored in plain text
  });

  it('reader updates profile, locations and categories', async () => {
    await http.patch(api('/me')).set(as(tok.reader)).send({ name: 'Ravi', language: 'en' }).expect(200);
    await http.put(api('/me/locations')).set(as(tok.reader))
      .send({ locationIds: [loc['dist-anantapur'], loc['mandal-lepakshi--sri-sathya-sai']], primaryId: loc['dist-anantapur'] }).expect(200);
    const r = await http.put(api('/me/categories')).set(as(tok.reader)).send({ categoryIds: [categoryId] }).expect(200);
    expect(r.body.name).toBe('Ravi');
    expect(r.body.language).toBe('en');
    expect(r.body.locations).toHaveLength(2);
    expect(r.body.locations.find((l: any) => l.isPrimary).nameEn).toBe('Anantapur');
    expect(r.body.categories[0].slug).toBe('agriculture');
    expect(r.body.passwordHash).toBeUndefined();
  });

  it('refresh token rotates and the old one stops working', async () => {
    const r = await http.post(api('/auth/refresh')).send({ refreshToken: tok.readerRefresh }).expect(200);
    await http.post(api('/auth/refresh')).send({ refreshToken: tok.readerRefresh }).expect(401);
    tok.readerRefresh = r.body.refreshToken;
  });

  it('blocks more than 5 OTPs per phone per hour', async () => {
    await pool.query(`insert into otp_requests (phone, code_hash, expires_at) select '+919000000001', 'x', now() from generate_series(1,5)`);
    await http.post(api('/auth/otp/request')).send({ phone: '9000000001' }).expect(429);
  });

  it('guest can read news but not use a profile', async () => {
    const g = await http.post(api('/auth/guest')).expect(200);
    await http.get(api('/articles')).set(as(g.body.accessToken)).expect(200);
    await http.get(api('/me')).set(as(g.body.accessToken)).expect(403);
    await http.get(api('/me')).expect(401);
  });
});

describe('Newsroom staff and roles', () => {
  it('staff login: wrong password refused, admin logs in', async () => {
    await http.post(api('/auth/staff/login')).send({ email: 'admin@test.mavy', password: 'wrongpassword' }).expect(401);
    const r = await http.post(api('/auth/staff/login')).send({ email: 'admin@test.mavy', password: 'AdminPass12345' }).expect(200);
    expect(r.body.role).toBe('SUPER_ADMIN');
    tok.admin = r.body.accessToken;
  });

  it('readers cannot reach admin or newsroom', async () => {
    await http.get(api('/admin/staff')).set(as(tok.reader)).expect(403);
    await http.post(api('/newsroom/articles')).set(as(tok.reader)).send(article('x', [loc['dist-anantapur']])).expect(403);
  });

  it('super admin creates reporter, sub-editor and district editor for Anantapur', async () => {
    const mk = async (email: string, role: string) => {
      await http.post(api('/admin/staff')).set(as(tok.admin))
        .send({ email, password: 'StaffPass123', name: role, role, locationIds: [loc['dist-anantapur']] }).expect(201);
      const r = await http.post(api('/auth/staff/login')).send({ email, password: 'StaffPass123' }).expect(200);
      return r.body as { accessToken: string; userId: string };
    };
    const rep = await mk('reporter@test.mavy', 'REPORTER');
    tok.reporter = rep.accessToken; tok.reporterId = rep.userId;
    tok.sub = (await mk('sub@test.mavy', 'SUB_EDITOR')).accessToken;
    tok.de = (await mk('de@test.mavy', 'DISTRICT_EDITOR')).accessToken;
    await http.post(api('/admin/staff')).set(as(tok.admin))
      .send({ email: 'weak@test.mavy', password: 'short', name: 'x', role: 'REPORTER' }).expect(400);
  });
});

describe('Editorial workflow', () => {
  let id: string;
  let slug: string;

  it('reporter cannot file a story outside the assigned district', async () => {
    await http.post(api('/newsroom/articles')).set(as(tok.reporter)).send(article('Outside', [loc['muni-hindupur--sri-sathya-sai']])).expect(403);
  });

  it('summaries over 100 words and uncredited photos are refused', async () => {
    const long = article('Long', [loc['mandal-anantapur-rural--anantapur']]);
    long.translations[1].summary = 'word '.repeat(101);
    await http.post(api('/newsroom/articles')).set(as(tok.reporter)).send(long).expect(400);
    await http.post(api('/newsroom/articles')).set(as(tok.reporter))
      .send(article('Photo', [loc['mandal-anantapur-rural--anantapur']], { heroImageUrl: 'https://cdn.example.com/a.jpg' })).expect(400);
  });

  it('reporter creates a draft and submits it; cannot approve it', async () => {
    const r = await http.post(api('/newsroom/articles')).set(as(tok.reporter))
      .send(article('Borewell repaired in Anantapur Rural', [loc['mandal-anantapur-rural--anantapur']], { tags: ['Water', 'water'] })).expect(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.tags).toHaveLength(1);
    id = r.body.id; slug = r.body.slug;
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.reporter)).send({ action: 'approve' }).expect(403);
    const s = await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.reporter)).send({ action: 'submit' }).expect(200);
    expect(s.body.status).toBe('SUBMITTED');
    await http.patch(api(`/newsroom/articles/${id}`)).set(as(tok.reporter)).send({ tags: ['late edit'] }).expect(403);
  });

  it('unpublished story is invisible to the public', async () => {
    await http.get(api(`/articles/${slug}`)).expect(404);
  });

  it('sub-editor reviews; sub-editor cannot approve; district editor approves and publishes', async () => {
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.sub)).send({ action: 'start_review' }).expect(200);
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.sub)).send({ action: 'approve' }).expect(403);
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.de)).send({ action: 'approve' }).expect(200);
    const p = await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.de)).send({ action: 'publish' }).expect(200);
    expect(p.body.status).toBe('PUBLISHED');
    expect(p.body.publishedAt).toBeTruthy();
    const h = await http.get(api(`/newsroom/articles/${id}`)).set(as(tok.de)).expect(200);
    expect(h.body.history.map((x: any) => x.toStatus)).toEqual(['PUBLISHED', 'APPROVED', 'IN_REVIEW', 'SUBMITTED']);
  });

  it('published story appears in its district feed, not in another district', async () => {
    const inDistrict = await http.get(api(`/articles?locationId=${loc['dist-anantapur']}&lang=en`)).expect(200);
    expect(inDistrict.body.items.map((a: any) => a.id)).toContain(id);
    const other = await http.get(api(`/articles?locationId=${loc['dist-sri-sathya-sai']}`)).expect(200);
    expect(other.body.items.map((a: any) => a.id)).not.toContain(id);
    const cat = await http.get(api('/articles?category=agriculture')).expect(200);
    expect(cat.body.items[0].language).toBe('te');
  });

  it('article page returns chosen language, counts views, shows source', async () => {
    const r = await http.get(api(`/articles/${slug}?lang=en`)).expect(200);
    expect(r.body.headline).toBe('Borewell repaired in Anantapur Rural');
    expect(r.body.availableLanguages.sort()).toEqual(['en', 'te']);
    expect(r.body.sourceLabel).toBe('MAVY NEWS');
    expect(r.body.reporter).toBe('REPORTER');
    await http.get(api(`/articles/${slug}`)).expect(200);
    const v = await pool.query('select view_count from articles where id=$1', [id]);
    expect(v.rows[0].view_count).toBe(2);
  });

  it('editing a published story needs a correction note and is audit-logged', async () => {
    await http.patch(api(`/newsroom/articles/${id}`)).set(as(tok.de)).send({ isFeatured: true }).expect(400);
    await http.patch(api(`/newsroom/articles/${id}`)).set(as(tok.de)).send({ isFeatured: true, correctionNote: 'Featured on home' }).expect(200);
    const logs = await http.get(api(`/admin/audit-logs?entity=article&entityId=${id}`)).set(as(tok.admin)).expect(200);
    expect(logs.body.items.map((l: any) => l.action)).toEqual(expect.arrayContaining(['article.correction', 'article.publish', 'article.approve', 'article.create']));
    await http.get(api('/admin/audit-logs')).set(as(tok.reporter)).expect(403);
  });

  it('takedown (archive) requires a note and a managing role', async () => {
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.de)).send({ action: 'archive', note: 'x' }).expect(403);
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.admin)).send({ action: 'archive' }).expect(400);
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(tok.admin)).send({ action: 'archive', note: 'Grievance #1 upheld' }).expect(200);
    await http.get(api(`/articles/${slug}`)).expect(404);
  });

  it('rejecting needs a reason', async () => {
    const r = await http.post(api('/newsroom/articles')).set(as(tok.reporter)).send(article('To reject', [loc['dist-anantapur']])).expect(201);
    await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(tok.reporter)).send({ action: 'submit' }).expect(200);
    await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(tok.de)).send({ action: 'reject' }).expect(400);
    const x = await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(tok.de)).send({ action: 'reject', note: 'Not verified' }).expect(200);
    expect(x.body.status).toBe('REJECTED');
  });

  it('scheduled story goes live automatically when its time comes', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const r = await http.post(api('/newsroom/articles')).set(as(tok.reporter)).send(article('Scheduled', [loc['dist-anantapur']], { scheduledAt: future })).expect(201);
    const sid = r.body.id;
    for (const [t, action] of [[tok.reporter, 'submit'], [tok.sub, 'start_review'], [tok.de, 'approve']] as const)
      await http.post(api(`/newsroom/articles/${sid}/transition`)).set(as(t)).send({ action }).expect(200);
    const p = await http.post(api(`/newsroom/articles/${sid}/transition`)).set(as(tok.de)).send({ action: 'publish' }).expect(200);
    expect(p.body.status).toBe('SCHEDULED');
    await pool.query("update articles set scheduled_at = now() - interval '1 minute' where id=$1", [sid]);
    expect(await app.get(ArticlesService).publishDue()).toBe(1);
    const pub = await http.get(api('/articles')).expect(200);
    expect(pub.body.items.map((a: any) => a.id)).toContain(sid);
  });

  it('feed pages with a cursor without repeating stories', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await http.post(api('/newsroom/articles')).set(as(tok.admin)).send(article(`Page ${i}`, [loc['dist-anantapur']])).expect(201);
      for (const action of ['submit', 'start_review', 'approve', 'publish'])
        await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(tok.admin)).send({ action }).expect(200);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: any = await http.get(api(`/articles?limit=2${cursor ? `&cursor=${cursor}` : ''}`)).expect(200);
      seen.push(...r.body.items.map((a: any) => a.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(seen.length).toBe(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('reporters only see their own stories in the newsroom list', async () => {
    const r = await http.get(api('/newsroom/articles')).set(as(tok.reporter)).expect(200);
    expect(r.body.items.every((a: any) => a.authorId === tok.reporterId)).toBe(true);
  });
});

describe('Access control & privacy', () => {
  it('suspending a reporter blocks them immediately', async () => {
    const id = tok.reporterId;
    await http.patch(api(`/admin/staff/${id}`)).set(as(tok.admin)).send({ action: 'suspend', reason: 'test' }).expect(200);
    await http.get(api('/newsroom/articles')).set(as(tok.reporter)).expect(403);
    await http.post(api('/auth/staff/login')).send({ email: 'reporter@test.mavy', password: 'StaffPass123' }).expect(401);
    await http.patch(api(`/admin/staff/${id}`)).set(as(tok.admin)).send({ action: 'reactivate' }).expect(200);
    await http.get(api('/newsroom/articles')).set(as(tok.reporter)).expect(200);
  });

  it('reader can delete their account; personal data is erased', async () => {
    const u = await otpLogin('9123456789');
    await http.delete(api('/me')).set(as(u.accessToken)).expect(200);
    await http.get(api('/me')).set(as(u.accessToken)).expect(401);
    const row = await pool.query('select phone, status from users where id=$1', [u.userId]);
    expect(row.rows[0]).toEqual({ phone: null, status: 'DELETED' });
    await http.post(api('/auth/refresh')).send({ refreshToken: u.refreshToken }).expect(401);
  });
});
