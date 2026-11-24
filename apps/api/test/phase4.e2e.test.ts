/**
 * Citizen journalists: apply with Aadhaar photo → area sub-admin approves → post from the app → review → points & levels.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import os from 'os';
import { existsSync, mkdtempSync, readdirSync } from 'fs';
import sharp from 'sharp';
import * as schema from '../src/db/schema';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { seed } from '../src/db/seed';
import { config } from '../src/config';
import { SMS_PROVIDER, ConsoleSmsProvider } from '../src/auth/sms/sms.provider';

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let ids: Record<string, string>;
let admin: string, reader: string, other: string, ananSub: string, mandalSub: string, sssSub: string;
let cat: string, appId: string, userId: string, jpeg: Buffer;
const api = (p: string) => `/api/v1${p}`;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const privDir = () => path.join(config.mediaDir, 'private');

async function otp(phone: string) {
  await http.post(api('/auth/otp/request')).send({ phone }).expect(200);
  const code = app.get<ConsoleSmsProvider>(SMS_PROVIDER).sent.get(`+91${phone}`);
  return (await http.post(api('/auth/otp/verify')).send({ phone, code }).expect(200)).body.accessToken as string;
}
async function subAdmin(email: string, loc: string) {
  await http.post(api('/admin/staff')).set(as(admin)).send({ email, password: 'SubAdmin12345', name: 'Sub ' + email, role: 'DISTRICT_EDITOR', locationIds: [ids[loc]] }).expect(201);
  return (await http.post(api('/auth/staff/login')).send({ email, password: 'SubAdmin12345' }).expect(200)).body.accessToken as string;
}
const post = (token: string, headline: string, loc = 'mandal-anantapur-rural--anantapur') =>
  http.post(api('/journalist/posts')).set(as(token)).send({
    language: 'te', headline, body: 'అనంతపురం రూరల్ మండలంలో ఈ రోజు జరిగిన సంఘటన గురించి పూర్తి వివరాలు ఇక్కడ ఉన్నాయి. ప్రజలు పెద్ద సంఖ్యలో హాజరయ్యారు.',
    categoryId: cat, locationId: ids[loc],
  });
async function publishAs(token: string, id: string) {
  for (const action of ['start_review', 'approve', 'publish'])
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(token)).send({ action }).expect(200);
}
const me = async () => (await http.get(api('/journalist/me')).set(as(reader)).expect(200)).body;

beforeAll(async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  ids = (await seed(db, { samples: false })).ids;
  cat = (await pool.query("select id from categories where slug='politics'")).rows[0].id;
  config.mediaDir = mkdtempSync(path.join(os.tmpdir(), 'mavy-media-'));
  config.publicWebUrl = 'http://test.local';
  jpeg = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;
  admin = (await http.post(api('/auth/staff/login')).send({ email: 'admin@test.mavy', password: 'AdminPass12345' })).body.accessToken;
  reader = await otp('9876533333');
  other = await otp('9876544444');
  ananSub = await subAdmin('anantapur.sub@test.mavy', 'dist-anantapur');
  mandalSub = await subAdmin('rural.sub@test.mavy', 'mandal-anantapur-rural--anantapur');
  sssSub = await subAdmin('sss.sub@test.mavy', 'dist-sri-sathya-sai');
});
afterAll(async () => { await app?.close(); await pool?.end(); });

describe('Becoming a journalist', () => {
  it('a reader starts with no request', async () => {
    expect((await me()).state).toBe('NONE');
  });
  it('the Aadhaar photo and the declaration are required', async () => {
    await http.post(api('/journalist/apply')).set(as(reader)).field('name', 'రమేష్ కుమార్').field('locationId', ids['mandal-anantapur-rural--anantapur']).field('consent', 'true').expect(400);
    await http.post(api('/journalist/apply')).set(as(reader)).field('name', 'రమేష్ కుమార్').field('locationId', ids['mandal-anantapur-rural--anantapur'])
      .attach('file', jpeg, 'aadhaar.jpg').expect(400);
  });
  it('a reader can apply once; the photo is stored privately', async () => {
    const r = await http.post(api('/journalist/apply')).set(as(reader)).field('name', 'రమేష్ కుమార్').field('locationId', ids['mandal-anantapur-rural--anantapur'])
      .field('consent', 'true').attach('file', jpeg, 'aadhaar.jpg').expect(201);
    expect(r.body.state).toBe('PENDING');
    expect(readdirSync(privDir())).toHaveLength(1);
    await http.post(api('/journalist/apply')).set(as(reader)).field('name', 'X Y Z').field('locationId', ids['dist-anantapur'])
      .field('consent', 'true').attach('file', jpeg, 'a.jpg').expect(409);
  });
  it('cannot post stories before approval', async () => {
    await post(reader, 'ఆమోదం లేకుండా వార్త పంపడం').expect(403);
  });
  it('readers and other districts cannot see the request or the Aadhaar photo', async () => {
    await http.get(api('/admin/journalist-applications')).set(as(other)).expect(403);
    expect((await http.get(api('/admin/journalist-applications')).set(as(sssSub)).expect(200)).body).toHaveLength(0);
    const list = (await http.get(api('/admin/journalist-applications')).set(as(ananSub)).expect(200)).body;
    expect(list).toHaveLength(1);
    appId = list[0].id;
    expect(list[0].phone).toBe('+919876533333');
    await http.get(api(`/admin/journalist-applications/${appId}/aadhaar`)).set(as(sssSub)).expect(403);
    await http.post(api(`/admin/journalist-applications/${appId}/decision`)).set(as(sssSub)).send({ decision: 'approve' }).expect(403);
  });
  it('the area sub-admin sees the Aadhaar photo (logged); rejecting needs a reason', async () => {
    const img = await http.get(api(`/admin/journalist-applications/${appId}/aadhaar`)).set(as(mandalSub)).expect(200);
    expect(img.headers['content-type']).toMatch(/jpeg/);
    expect(img.headers['cache-control']).toBe('no-store');
    const logs = await pool.query("select count(*)::int n from audit_logs where action='journalist.aadhaar_view'");
    expect(logs.rows[0].n).toBe(1);
    await http.post(api(`/admin/journalist-applications/${appId}/decision`)).set(as(mandalSub)).send({ decision: 'reject' }).expect(400);
  });
  it('approval makes a Junior Journalist and deletes the Aadhaar photo', async () => {
    await http.post(api(`/admin/journalist-applications/${appId}/decision`)).set(as(mandalSub)).send({ decision: 'approve' }).expect(201);
    const m = await me();
    expect(m.state).toBe('APPROVED');
    expect(m.level).toBe('JUNIOR');
    expect(m.name).toBe('రమేష్ కుమార్');
    expect(m.pointsPerPost).toBe(5);
    expect(m.next).toEqual({ level: 'JOURNALIST', at: 100, remaining: 100 });
    expect(readdirSync(privDir())).toHaveLength(0);
    await http.get(api(`/admin/journalist-applications/${appId}/aadhaar`)).set(as(admin)).expect(404);
    userId = (await pool.query("select id from users where phone='+919876533333'")).rows[0].id;
  });
  it('a journalist cannot change their verified name (it is their byline)', async () => {
    await http.patch(api('/me')).set(as(reader)).send({ name: 'వేరే పేరు' }).expect(400);
    await http.patch(api('/me')).set(as(reader)).send({ language: 'en' }).expect(200);
  });
});

describe('Admin login inside the app', () => {
  it('/me tells the app what this session may do', async () => {
    expect((await http.get(api('/me')).set(as(ananSub)).expect(200)).body.sessionRole).toBe('DISTRICT_EDITOR');
    expect((await http.get(api('/me')).set(as(reader)).expect(200)).body.sessionRole).toBe('READER');
  });
});

describe('Posting from the app and review', () => {
  let storyId: string;
  it('a journalist uploads a photo and sends a story; it waits for review', async () => {
    const ph = await http.post(api('/journalist/media')).set(as(reader)).attach('file', jpeg, 'p.jpg').expect(201);
    expect(ph.body.url).toMatch(/^http:\/\/test\.local\/media\/[a-f0-9]{32}\.jpg$/);
    const r = await http.post(api('/journalist/posts')).set(as(reader)).send({
      language: 'te', headline: 'అనంతపురం రూరల్‌లో రైతుల సమావేశం', categoryId: cat, locationId: ids['mandal-anantapur-rural--anantapur'],
      body: 'అనంతపురం రూరల్ మండలంలో రైతులు సమావేశమై నీటి సమస్యపై చర్చించారు. అధికారులు త్వరలో పరిష్కారం చూపుతామని హామీ ఇచ్చారు.', heroImageUrl: ph.body.url,
    }).expect(201);
    expect(r.body.status).toBe('SUBMITTED');
    storyId = r.body.id;
    expect((await http.get(api('/feed')).expect(200)).body.total).toBe(0);
  });
  it('photos from other websites are refused', async () => {
    await http.post(api('/journalist/posts')).set(as(reader)).send({
      language: 'te', headline: 'బయటి ఫోటోతో వార్త పంపడం', categoryId: cat, locationId: ids['dist-anantapur'],
      body: 'ఈ వార్తలో బయటి వెబ్‌సైట్ ఫోటో ఉంది కాబట్టి తిరస్కరించాలి. పరీక్ష కోసం మాత్రమే.', heroImageUrl: 'https://example.com/x.jpg',
    }).expect(400);
  });
  it('the admin review queue shows journalist stories waiting', async () => {
    const q = await http.get(api('/newsroom/articles?source=journalist&statuses=SUBMITTED,IN_REVIEW')).set(as(mandalSub)).expect(200);
    expect(q.body.items.map((a: any) => a.id)).toEqual([storyId]);
    expect((await http.get(api('/newsroom/articles?source=journalist')).set(as(sssSub)).expect(200)).body.total).toBe(0);
  });
  it('editor sends it back with a note; the journalist fixes and resends', async () => {
    await http.post(api(`/newsroom/articles/${storyId}/transition`)).set(as(mandalSub)).send({ action: 'request_changes', note: 'ఎవరు హామీ ఇచ్చారో పేరు రాయండి' }).expect(200);
    const mine = (await http.get(api('/journalist/posts')).set(as(reader)).expect(200)).body;
    expect(mine[0].status).toBe('CHANGES_REQUESTED');
    expect(mine[0].editorNote).toBe('ఎవరు హామీ ఇచ్చారో పేరు రాయండి');
    const r = await http.patch(api(`/journalist/posts/${storyId}`)).set(as(reader)).send({
      language: 'te', headline: 'అనంతపురం రూరల్‌లో రైతుల సమావేశం', categoryId: cat, locationId: ids['mandal-anantapur-rural--anantapur'],
      body: 'అనంతపురం రూరల్ మండలంలో రైతులు సమావేశమై నీటి సమస్యపై చర్చించారు. ఎంపీడీవో త్వరలో పరిష్కారం చూపుతామని హామీ ఇచ్చారు.',
    }).expect(200);
    expect(r.body.status).toBe('SUBMITTED');
    await http.patch(api(`/journalist/posts/${storyId}`)).set(as(reader)).send({
      language: 'te', headline: 'మళ్లీ మార్పు చేయడానికి ప్రయత్నం', categoryId: cat, locationId: ids['dist-anantapur'],
      body: 'సమీక్షలో ఉన్న వార్తను జర్నలిస్ట్ మార్చలేరు. ఇది పరీక్ష కోసం మాత్రమే రాసిన వాక్యం.',
    }).expect(400);
  });
  it('publishing gives a Junior 5 points; the feed shows the journalist level', async () => {
    await publishAs(mandalSub, storyId);
    const m = await me();
    expect(m.points).toBe(5);
    expect(m.approvedPosts).toBe(1);
    const feed = (await http.get(api('/feed')).expect(200)).body.items[0];
    expect(feed.reporter).toBe('రమేష్ కుమార్');
    expect(feed.reporterLevel).toBe('JUNIOR');
    expect(feed.sourceType).toBe('CITIZEN');
    expect((await http.get(api('/journalist/posts')).set(as(reader))).body[0].points).toBe(5);
  });
  it('100 approved posts → Journalist (10 points); 500 → Senior (20 points)', async () => {
    await pool.query('update users set approved_posts=99 where id=$1', [userId]);
    const a = (await post(reader, 'నూరవ వార్త: మండల పరిషత్ సమావేశం').expect(201)).body.id;
    await publishAs(admin, a);
    let m = await me();
    expect(m.level).toBe('JOURNALIST');
    expect(m.points).toBe(10); // 5 + 5 (the 100th post is still paid at Junior rate)
    const b = (await post(reader, 'నూట ఒకటో వార్త: గ్రామ సభ').expect(201)).body.id;
    await publishAs(admin, b);
    m = await me();
    expect(m.points).toBe(20);
    expect(m.pointsPerPost).toBe(10);
    await pool.query('update users set approved_posts=499 where id=$1', [userId]);
    const c = (await post(reader, 'ఐదు వందలవ వార్త: జిల్లా సమీక్ష').expect(201)).body.id;
    await publishAs(admin, c);
    const d = (await post(reader, 'సీనియర్ జర్నలిస్ట్ మొదటి వార్త').expect(201)).body.id;
    await publishAs(admin, d);
    m = await me();
    expect(m.level).toBe('SENIOR');
    expect(m.points).toBe(50); // 20 + 10 + 20
    expect(m.next).toBeNull();
  });
  it('a story taken down loses its points', async () => {
    const [{ id }] = (await pool.query("select article_id id from point_events where points=20 order by created_at desc limit 1")).rows;
    await http.post(api(`/newsroom/articles/${id}/transition`)).set(as(admin)).send({ action: 'archive', note: 'తప్పుడు సమాచారం' }).expect(200);
    const m = await me();
    expect(m.points).toBe(30);
    expect(m.approvedPosts).toBe(500);
  });
  it('deleting a story: sub-admins only non-live ones in their area; admin any; points come back off', async () => {
    const draft = (await post(reader, 'తొలగించాల్సిన పరీక్ష వార్త ఒకటి').expect(201)).body.id;
    await http.delete(api(`/newsroom/articles/${draft}`)).set(as(sssSub)).expect(403); // other district
    await http.delete(api(`/newsroom/articles/${draft}`)).set(as(reader)).expect(403); // the app user cannot
    await http.delete(api(`/newsroom/articles/${draft}`)).set(as(mandalSub)).expect(200);
    await http.get(api(`/newsroom/articles/${draft}`)).set(as(admin)).expect(404);
    const live = (await post(reader, 'తొలగించాల్సిన ప్రచురిత వార్త రెండు').expect(201)).body.id;
    await publishAs(admin, live);
    const before = (await me()).points;
    await http.delete(api(`/newsroom/articles/${live}`)).set(as(mandalSub)).expect(403); // live: admin only
    await http.delete(api(`/newsroom/articles/${live}?reason=duplicate`)).set(as(admin)).expect(200);
    expect((await me()).points).toBe(before - 20);
    const log = await pool.query("select metadata from audit_logs where action='article.delete' order by created_at desc limit 1");
    expect(log.rows[0].metadata.reason).toBe('duplicate');
  });
  it('leaderboard is public', async () => {
    const r = await http.get(api('/journalist/leaderboard')).expect(200);
    expect(r.body[0]).toMatchObject({ name: 'రమేష్ కుమార్', level: 'SENIOR' });
    expect(r.body[0].phone).toBeUndefined();
  });
  it('a suspended journalist cannot post; reactivation restores it', async () => {
    await http.patch(api(`/admin/journalists/${userId}`)).set(as(sssSub)).send({ action: 'suspend', reason: 'x' }).expect(403);
    await http.patch(api(`/admin/journalists/${userId}`)).set(as(ananSub)).send({ action: 'suspend' }).expect(400);
    await http.patch(api(`/admin/journalists/${userId}`)).set(as(ananSub)).send({ action: 'suspend', reason: 'తప్పుడు వార్తలు' }).expect(200);
    expect((await me()).state).toBe('SUSPENDED');
    await post(reader, 'నిలిపివేసిన తర్వాత వార్త పంపడం').expect(403);
    const list = (await http.get(api('/admin/journalists')).set(as(ananSub)).expect(200)).body;
    expect(list[0]).toMatchObject({ name: 'రమేష్ కుమార్' });
    await http.patch(api(`/admin/journalists/${userId}`)).set(as(admin)).send({ action: 'reactivate' }).expect(200);
    await post(reader, 'మళ్లీ అనుమతి వచ్చిన తర్వాత వార్త').expect(201);
  });
});
