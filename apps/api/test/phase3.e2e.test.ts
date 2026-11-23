/**
 * Reader community: like/dislike, comments + moderation, story reports, feed total ("2 of 165").
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
let admin: string, reader: string, reader2: string, guest: string, storyId: string;
const api = (p: string) => `/api/v1${p}`;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

async function otp(phone: string) {
  await http.post(api('/auth/otp/request')).send({ phone }).expect(200);
  const code = app.get<ConsoleSmsProvider>(SMS_PROVIDER).sent.get(`+91${phone}`);
  return (await http.post(api('/auth/otp/verify')).send({ phone, code }).expect(200)).body.accessToken as string;
}

beforeAll(async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  const { ids } = await seed(db, { samples: false });
  const cat = (await pool.query("select id from categories where slug='politics'")).rows[0].id;

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;
  admin = (await http.post(api('/auth/staff/login')).send({ email: 'admin@test.mavy', password: 'AdminPass12345' })).body.accessToken;
  reader = await otp('9876511111');
  reader2 = await otp('9876522222');
  guest = (await http.post(api('/auth/guest'))).body.accessToken;

  for (let i = 0; i < 3; i++) {
    const r = await http.post(api('/newsroom/articles')).set(as(admin)).send({
      categoryId: cat, locationIds: [ids['dist-anantapur']],
      translations: [{ language: 'te', headline: `వార్త సంఖ్య ${i}`, summary: 'పరీక్ష సారాంశం.', body: 'పూర్తి వార్త.' }],
    }).expect(201);
    for (const action of ['submit', 'start_review', 'approve', 'publish'])
      await http.post(api(`/newsroom/articles/${r.body.id}/transition`)).set(as(admin)).send({ action }).expect(200);
    storyId = r.body.id;
  }
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('Feed counter', () => {
  it('first page tells the app how many stories there are ("1 of 3")', async () => {
    const r = await http.get(api('/feed?limit=2')).expect(200);
    expect(r.body.total).toBe(3);
    expect(r.body.items[0].commentCount).toBe(0);
    expect(r.body.items[0].dislikeCount).toBe(0);
    const next = await http.get(api(`/feed?limit=2&cursor=${r.body.nextCursor}`)).expect(200);
    expect(next.body.items).toHaveLength(1);
  });
});

describe('Like / dislike', () => {
  it('a reader can like or dislike, never both, and counts stay exact', async () => {
    let r = await http.post(api(`/articles/${storyId}/reaction`)).set(as(reader)).send({ reaction: 'like' }).expect(200);
    expect([r.body.likeCount, r.body.dislikeCount]).toEqual([1, 0]);
    r = await http.post(api(`/articles/${storyId}/reaction`)).set(as(reader)).send({ reaction: 'dislike' }).expect(200);
    expect([r.body.likeCount, r.body.dislikeCount]).toEqual([0, 1]);
    r = await http.post(api(`/articles/${storyId}/reaction`)).set(as(reader2)).send({ reaction: 'dislike' }).expect(200);
    expect(r.body.dislikeCount).toBe(2);
    r = await http.post(api(`/articles/${storyId}/reaction`)).set(as(reader)).send({ reaction: 'none' }).expect(200);
    expect([r.body.likeCount, r.body.dislikeCount]).toEqual([0, 1]);
    const feed = await http.get(api('/feed')).set(as(reader2)).expect(200);
    const card = feed.body.items.find((a: any) => a.id === storyId);
    expect(card.disliked).toBe(true);
    expect(card.dislikeCount).toBe(1);
  });

  it('guests are asked to log in', async () => {
    await http.post(api(`/articles/${storyId}/reaction`)).set(as(guest)).send({ reaction: 'like' }).expect(403);
  });
});

describe('Comments', () => {
  let cid: string;
  it('reader comments; anyone can read; counts go up', async () => {
    const c = await http.post(api(`/articles/${storyId}/comments`)).set(as(reader)).send({ body: '  మంచి వార్త   ' }).expect(201);
    expect(c.body.body).toBe('మంచి వార్త');
    cid = c.body.id;
    await http.post(api(`/articles/${storyId}/comments`)).set(as(reader2)).send({ body: 'Good report' }).expect(201);
    const list = await http.get(api(`/articles/${storyId}/comments`)).set(as(reader)).expect(200);
    expect(list.body.items.map((x: any) => x.body)).toEqual(['Good report', 'మంచి వార్త']);
    expect(list.body.items.find((x: any) => x.id === cid).mine).toBe(true);
    const feed = await http.get(api('/feed')).expect(200);
    expect(feed.body.items.find((a: any) => a.id === storyId).commentCount).toBe(2);
  });

  it('blocks links, guests and empty comments', async () => {
    await http.post(api(`/articles/${storyId}/comments`)).set(as(reader)).send({ body: 'visit www.spam.com' }).expect(400);
    await http.post(api(`/articles/${storyId}/comments`)).set(as(guest)).send({ body: 'hi' }).expect(403);
    await http.post(api(`/articles/${storyId}/comments`)).set(as(reader)).send({ body: '' }).expect(400);
  });

  it('readers delete only their own; moderators can hide and restore any', async () => {
    await http.delete(api(`/comments/${cid}`)).set(as(reader2)).expect(403);
    await http.delete(api(`/comments/${cid}`)).set(as(reader)).expect(200);
    let list = await http.get(api(`/articles/${storyId}/comments`)).expect(200);
    expect(list.body.items).toHaveLength(1);
    const other = list.body.items[0].id;
    await http.patch(api(`/newsroom/comments/${other}`)).set(as(reader)).send({ hidden: true }).expect(403);
    await http.patch(api(`/newsroom/comments/${other}`)).set(as(admin)).send({ hidden: true }).expect(200);
    list = await http.get(api(`/articles/${storyId}/comments`)).expect(200);
    expect(list.body.items).toHaveLength(0);
    await http.patch(api(`/newsroom/comments/${other}`)).set(as(admin)).send({ hidden: false }).expect(200);
    const feed = await http.get(api('/feed')).expect(200);
    expect(feed.body.items.find((a: any) => a.id === storyId).commentCount).toBe(1);
    const mod = await http.get(api('/newsroom/comments')).set(as(admin)).expect(200);
    expect(mod.body.length).toBe(2);
  });
});

describe('Report a story (grievance)', () => {
  it('anyone can report; editors see and resolve it; it is audit-logged', async () => {
    await http.post(api(`/articles/${storyId}/report`)).send({ reason: 'NONSENSE' }).expect(400);
    const r = await http.post(api(`/articles/${storyId}/report`)).set(as(reader)).send({ reason: 'WRONG_INFO', note: 'Date is wrong' }).expect(200);
    const again = await http.post(api(`/articles/${storyId}/report`)).set(as(reader)).send({ reason: 'WRONG_INFO' }).expect(200);
    expect(again.body.id).toBe(r.body.id); // no duplicate open complaints from one reader
    await http.post(api(`/articles/${storyId}/report`)).send({ reason: 'FAKE' }).expect(200); // guest/anonymous
    const open = await http.get(api('/newsroom/reports')).set(as(admin)).expect(200);
    expect(open.body).toHaveLength(2);
    await http.get(api('/newsroom/reports')).set(as(reader)).expect(403);
    await http.patch(api(`/newsroom/reports/${r.body.id}`)).set(as(admin)).send({ status: 'RESOLVED', resolution: 'Date corrected' }).expect(200);
    await http.patch(api(`/newsroom/reports/${r.body.id}`)).set(as(admin)).send({ status: 'RESOLVED', resolution: 'again' }).expect(404);
    const logs = await http.get(api(`/admin/audit-logs?entity=report&entityId=${r.body.id}`)).set(as(admin)).expect(200);
    expect(logs.body.items[0].action).toBe('report.resolved');
  });
});

describe('Shared story web page', () => {
  it('shared link opens a readable page with WhatsApp preview tags, and escapes text', async () => {
    const feed = await http.get(api('/feed')).expect(200);
    const card = feed.body.items[0];
    expect(card.shareUrl).toMatch(/\/n\/[^/]+$/);
    const slug = card.shareUrl.split('/n/')[1];
    const r = await http.get(`/n/${slug}`).expect(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toContain('<meta property="og:title"');
    expect(r.text).toContain(card.headline);
    await http.get('/n/does-not-exist').expect(404);
    // stories that are not published are not shown
    await pool.query("update articles set status='ARCHIVED' where slug=$1", [slug]);
    await http.get(`/n/${slug}`).expect(404);
    await pool.query("update articles set status='PUBLISHED' where slug=$1", [slug]);
  });

  it('html in headlines cannot inject into the page', async () => {
    const slug = (await pool.query("select slug, id from articles where status='PUBLISHED' limit 1")).rows[0];
    await pool.query("update article_translations set headline='<script>alert(1)</script> test' where article_id=$1", [slug.id]);
    const r = await http.get(`/n/${slug.slug}`).expect(200);
    expect(r.text).not.toContain('<script>alert(1)</script>');
    expect(r.text).toContain('&lt;script&gt;');
  });
});

describe('Newsroom page and photo upload', () => {
  it('serves the newsroom page, its script and the Telugu font', async () => {
    const page = await http.get('/newsroom').expect(200);
    expect(page.text).toContain('/newsroom/app.js');
    await http.get('/newsroom/app.js').expect(200);
    await http.get('/fonts/NotoSansTelugu_400Regular.ttf').expect(200);
    await http.get('/fonts/secret.ttf').expect(404);
  });

  it('staff upload a photo: it is resized to JPEG, GPS removed, and can be used as the story photo', async () => {
    const sharp = (await import('sharp')).default;
    // a 3000px photo carrying GPS location data
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3a7' } })
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 41/1 0/1' } }).jpeg().toBuffer();
    const r = await http.post(api('/newsroom/media')).set(as(admin)).attach('file', big, 'photo.jpg').expect(201);
    expect(r.body.url).toMatch(/\/media\/[a-f0-9]{32}\.jpg$/);
    const file = await http.get(new URL(r.body.url).pathname).expect(200);
    const meta = await sharp(file.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1280);
    expect(meta.exif).toBeUndefined(); // no location / camera data left

    const story = await http.patch(api(`/newsroom/articles/${storyId}`)).set(as(admin))
      .send({ heroImageUrl: r.body.url, heroImageCredit: 'MAVY NEWS', correctionNote: 'Added photo' }).expect(200);
    expect(story.body.heroImageUrl).toBe(r.body.url);
  });

  it('rejects non-photos, readers and guessed file names', async () => {
    await http.post(api('/newsroom/media')).set(as(admin)).attach('file', Buffer.from('not an image'), 'x.jpg').expect(400);
    await http.post(api('/newsroom/media')).set(as(admin)).expect(400);
    await http.post(api('/newsroom/media')).set(as(reader)).attach('file', Buffer.from('x'), 'x.jpg').expect(403);
    await http.get('/media/../../etc/passwd').expect(404);
    await http.get('/media/0123456789abcdef0123456789abcdef.jpg').expect(404);
  });
});

describe('Testing OTP and phone-linked staff', () => {
  it('with a fixed test code, any number logs in with 1234 (no SMS); wrong code still fails', async () => {
    const { config } = await import('../src/config');
    config.otpFixedCode = '1234';
    try {
      const r = await http.post(api('/auth/otp/request')).send({ phone: '9000012345' }).expect(200);
      expect(r.body.codeLength).toBe(4);
      await http.post(api('/auth/otp/verify')).send({ phone: '9000012345', code: '4321' }).expect(401);
      const ok = await http.post(api('/auth/otp/verify')).send({ phone: '9000012345', code: '1234' }).expect(200);
      expect(ok.body.accessToken).toBeTruthy();
    } finally {
      config.otpFixedCode = '';
    }
  });

  it('admin can give a phone number a newsroom account; an existing reader with that number is upgraded, not duplicated', async () => {
    // 9876511111 is already a reader in this test
    const before = (await pool.query("select id from users where phone='+919876511111'")).rows[0].id;
    const s = await http.post(api('/admin/staff')).set(as(admin))
      .send({ email: 'phone.reporter@test.mavy', password: 'StaffPass123', name: 'Phone Reporter', role: 'REPORTER', phone: '9876511111' }).expect(201);
    expect(s.body.user.id).toBe(before);
    expect(s.body.user.role).toBe('REPORTER');
    await http.post(api('/auth/staff/login')).send({ email: 'phone.reporter@test.mavy', password: 'StaffPass123' }).expect(200);
    // same number again is refused
    await http.post(api('/admin/staff')).set(as(admin))
      .send({ email: 'other@test.mavy', password: 'StaffPass123', name: 'Someone Else', role: 'REPORTER', phone: '9876511111' }).expect(409);
    // a brand-new number creates a new account carrying the phone
    const n = await http.post(api('/admin/staff')).set(as(admin))
      .send({ email: 'new.phone@test.mavy', password: 'StaffPass123', name: 'New', role: 'REPORTER', phone: '9123400000' }).expect(201);
    expect(n.body.user.phone).toBe('+919123400000');
  });
});

describe('Phone login never gives newsroom powers', () => {
  it('a staff member logging in by OTP gets a reader session; the password login gets newsroom access', async () => {
    const { config } = await import('../src/config');
    config.otpFixedCode = '1234';
    try {
      await http.post(api('/admin/staff')).set(as(admin))
        .send({ email: 'editor.phone@test.mavy', password: 'StaffPass123', name: 'Editor Phone', role: 'MANAGING_EDITOR', phone: '9555512345' }).expect(201);
      await http.post(api('/auth/otp/request')).send({ phone: '9555512345' }).expect(200);
      const o = await http.post(api('/auth/otp/verify')).send({ phone: '9555512345', code: '1234' }).expect(200);
      await http.get(api('/newsroom/articles')).set(as(o.body.accessToken)).expect(403);
      await http.get(api('/admin/audit-logs')).set(as(o.body.accessToken)).expect(403);
      await http.get(api('/me')).set(as(o.body.accessToken)).expect(200); // still a normal reader
      const r = await http.post(api('/auth/refresh')).send({ refreshToken: o.body.refreshToken }).expect(200);
      await http.get(api('/newsroom/articles')).set(as(r.body.accessToken)).expect(403); // refresh keeps it a reader session
      const pw = await http.post(api('/auth/staff/login')).send({ email: 'editor.phone@test.mavy', password: 'StaffPass123' }).expect(200);
      await http.get(api('/newsroom/articles')).set(as(pw.body.accessToken)).expect(200);
    } finally {
      config.otpFixedCode = '';
    }
  });
});
