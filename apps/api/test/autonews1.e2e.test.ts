/**
 * Auto News Step 1: settings + sources (master admin only), with the safety rules enforced by the server.
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

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let admin = '';
let editor = '';
const api = (p: string) => `/api/v1${p}`;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  await seed(db, { samples: false });
  delete process.env.ANTHROPIC_API_KEY;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;
  admin = (await http.post(api('/auth/staff/login')).send({ email: 'admin', password: 'AdminPass12345' }).expect(200)).body.accessToken;
  await http.post(api('/admin/staff')).set(as(admin))
    .send({ email: 'me@test.mavy', password: 'EditorPass123', name: 'Managing Editor', role: 'MANAGING_EDITOR' }).expect(201);
  editor = (await http.post(api('/auth/staff/login')).send({ email: 'me@test.mavy', password: 'EditorPass123' }).expect(200)).body.accessToken;
});
afterAll(async () => { await app?.close(); await pool?.end(); });

describe('Auto News settings', () => {
  it('starts OFF, in test mode, every 30 minutes, $1.50 a day, with AP I&PR as the first source', async () => {
    const r = await http.get(api('/admin/auto-news')).set(as(admin)).expect(200);
    expect(r.body.settings).toMatchObject({ enabled: false, testMode: true, intervalMinutes: 30, dailyCostLimitUsd: 1.5 });
    expect(r.body.keyConfigured).toBe(false);
    expect(r.body.sources).toHaveLength(1);
    expect(r.body.sources[0]).toMatchObject({ kind: 'PRESS_RELEASE', enabled: true, autoPublish: false, isGovernment: true });
    expect(JSON.stringify(r.body)).not.toMatch(/sk-ant/);
  });
  it('only the master admin can see or change it', async () => {
    await http.get(api('/admin/auto-news')).set(as(editor)).expect(403);
    await http.patch(api('/admin/auto-news/settings')).set(as(editor)).send({ enabled: true }).expect(403);
    await http.get(api('/admin/auto-news')).expect(401);
  });
  it('saves ON/OFF, test mode, interval and daily cost limit; refuses odd values', async () => {
    const r = await http.patch(api('/admin/auto-news/settings')).set(as(admin))
      .send({ enabled: true, intervalMinutes: 60, dailyCostLimitUsd: 2.25 }).expect(200);
    expect(r.body).toMatchObject({ enabled: true, testMode: true, intervalMinutes: 60, dailyCostLimitUsd: 2.25 });
    await http.patch(api('/admin/auto-news/settings')).set(as(admin)).send({ intervalMinutes: 7 }).expect(400);
    await http.patch(api('/admin/auto-news/settings')).set(as(admin)).send({ dailyCostLimitUsd: -1 }).expect(400);
    await http.patch(api('/admin/auto-news/settings')).set(as(admin)).send({ dailyCostLimitUsd: 500 }).expect(400);
    const audit = await pool.query("select count(*)::int n from audit_logs where action = 'auto_news.settings'");
    expect(audit.rows[0].n).toBe(1);
  });
});

describe('Auto News sources', () => {
  let alertId = '';
  it('adds a government source', async () => {
    const r = await http.post(api('/admin/auto-news/sources')).set(as(admin))
      .send({ name: 'PIB press releases', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', kind: 'RSS', photosAllowed: true }).expect(201);
    expect(r.body.source).toMatchObject({ kind: 'RSS', photosAllowed: true, autoPublish: false, isGovernment: true });
  });
  it('refuses the same address twice and a non-web address', async () => {
    await http.post(api('/admin/auto-news/sources')).set(as(admin)).send({ name: 'PIB again', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', kind: 'RSS' }).expect(409);
    await http.post(api('/admin/auto-news/sources')).set(as(admin)).send({ name: 'Bad', url: 'pib.gov.in', kind: 'RSS' }).expect(400);
    await http.post(api('/admin/auto-news/sources')).set(as(admin)).send({ name: 'Bad', url: 'javascript:alert(1)', kind: 'RSS' }).expect(400);
  });
  it('other news channels are always "tip only", with no photos', async () => {
    const r = await http.post(api('/admin/auto-news/sources')).set(as(admin))
      .send({ name: 'Eenadu', url: 'https://www.eenadu.net/andhra-pradesh', kind: 'RSS' }).expect(201);
    expect(r.body.source).toMatchObject({ kind: 'TIP_ONLY', photosAllowed: false, autoPublish: false });
    expect(r.body.notes.join(' ')).toMatch(/tip only/);
    await http.patch(api(`/admin/auto-news/sources/${r.body.source.id}`)).set(as(admin)).send({ photosAllowed: true }).expect(400);
    await http.patch(api(`/admin/auto-news/sources/${r.body.source.id}`)).set(as(admin)).send({ autoPublish: true }).expect(400);
  });
  it('photos only from government websites', async () => {
    await http.post(api('/admin/auto-news/sources')).set(as(admin))
      .send({ name: 'Some blog', url: 'https://example.com/feed', kind: 'RSS', photosAllowed: true }).expect(400);
  });
  it('"publish without approval" is OFF by default and allowed only for official government alerts', async () => {
    const press = (await http.get(api('/admin/auto-news')).set(as(admin))).body.sources.find((s: any) => s.kind === 'PRESS_RELEASE');
    await http.patch(api(`/admin/auto-news/sources/${press.id}`)).set(as(admin)).send({ autoPublish: true }).expect(400);
    const r = await http.post(api('/admin/auto-news/sources')).set(as(admin))
      .send({ name: 'IMD Amaravati warnings', url: 'https://mausam.imd.gov.in/amaravati/', kind: 'OFFICIAL_ALERT' }).expect(201);
    alertId = r.body.source.id;
    expect(r.body.source.autoPublish).toBe(false);
    const on = await http.patch(api(`/admin/auto-news/sources/${alertId}`)).set(as(admin)).send({ autoPublish: true }).expect(200);
    expect(on.body.source.autoPublish).toBe(true);
  });
  it('turns a source off and on, and removes it; every change is in the log', async () => {
    const off = await http.patch(api(`/admin/auto-news/sources/${alertId}`)).set(as(admin)).send({ enabled: false }).expect(200);
    expect(off.body.source.enabled).toBe(false);
    await http.patch(api(`/admin/auto-news/sources/${alertId}`)).set(as(editor)).send({ enabled: true }).expect(403);
    await http.delete(api(`/admin/auto-news/sources/${alertId}`)).set(as(editor)).expect(403);
    await http.delete(api(`/admin/auto-news/sources/${alertId}`)).set(as(admin)).expect(204);
    await http.delete(api(`/admin/auto-news/sources/${alertId}`)).set(as(admin)).expect(404);
    const audit = await pool.query("select action from audit_logs where action like 'auto_news.source%'");
    expect(audit.rows.map((x) => x.action)).toEqual(expect.arrayContaining(['auto_news.source_add', 'auto_news.source_edit', 'auto_news.source_remove']));
  });
  it('says the Claude key is set, without ever showing it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-value';
    const r = await http.get(api('/admin/auto-news')).set(as(admin)).expect(200);
    expect(r.body.keyConfigured).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('sk-ant');
    delete process.env.ANTHROPIC_API_KEY;
  });
});
