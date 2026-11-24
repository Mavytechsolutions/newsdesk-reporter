/**
 * Master admin: log in with username "admin"; change the password only with an OTP sent to the recovery mobile.
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
import { config } from '../src/config';
import { SMS_PROVIDER, ConsoleSmsProvider } from '../src/auth/sms/sms.provider';

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
const api = (p: string) => `/api/v1${p}`;
const PHONE = '+918886688864';
const sms = () => app.get<ConsoleSmsProvider>(SMS_PROVIDER);

beforeAll(async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL!.replace(/\/mavy_test.*/, '/postgres') });
  await root.query('DROP DATABASE IF EXISTS mavy_test WITH (FORCE)');
  await root.query('CREATE DATABASE mavy_test');
  await root.end();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  process.env.ADMIN_RECOVERY_PHONE = '8886688864';
  await seed(db, { samples: false });
  delete process.env.ADMIN_RECOVERY_PHONE;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer()) as any;
});
afterAll(async () => { config.otpFixedCode = ''; await app?.close(); await pool?.end(); });

describe('Master admin login and password change', () => {
  let oldRefresh: string;
  it('logs in with username "admin" (email still works)', async () => {
    const r = await http.post(api('/auth/staff/login')).send({ email: 'admin', password: 'AdminPass12345' }).expect(200);
    expect(r.body.role).toBe('SUPER_ADMIN');
    oldRefresh = r.body.refreshToken;
    await http.post(api('/auth/staff/login')).send({ email: 'ADMIN@test.mavy', password: 'AdminPass12345' }).expect(200);
    await http.post(api('/auth/staff/login')).send({ email: 'admin', password: 'wrong-password' }).expect(401);
  });
  it('the OTP goes to the recovery mobile, masked, and is a real code even while testing code 1234 is on', async () => {
    config.otpFixedCode = '1234';
    const r = await http.post(api('/auth/staff/password/otp')).send({ login: 'admin' }).expect(200);
    expect(r.body.to).toBe('******8864');
    const code = sms().sent.get(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe('1234');
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code: '123456', newPassword: 'Madhu@bm005' }).expect(code === '123456' ? 200 : 401);
  });
  it('weak new passwords are refused', async () => {
    const code = sms().sent.get(PHONE)!;
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code, newPassword: 'short1' }).expect(400);
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code, newPassword: 'onlyletterslong' }).expect(400);
  });
  it('the right OTP changes the password and logs out old sessions; the OTP works once', async () => {
    const code = sms().sent.get(PHONE)!;
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code, newPassword: 'Madhu@bm005' }).expect(200);
    await http.post(api('/auth/staff/login')).send({ email: 'admin', password: 'AdminPass12345' }).expect(401);
    await http.post(api('/auth/staff/login')).send({ email: 'admin', password: 'Madhu@bm005' }).expect(200);
    await http.post(api('/auth/refresh')).send({ refreshToken: oldRefresh }).expect(401);
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code, newPassword: 'Another12345' }).expect(401);
  });
  it('a phone-login OTP (1234) can never be used to change the password', async () => {
    await http.post(api('/auth/otp/request')).send({ phone: '8886688864' }).expect(200);
    await http.post(api('/auth/staff/password/otp')).send({ login: 'admin' }).expect(200);
    await http.post(api('/auth/staff/password/reset')).send({ login: 'admin', code: '001234', newPassword: 'Hacker123456' }).expect(401);
    // and the phone login still works with its own code
    await http.post(api('/auth/otp/verify')).send({ phone: '8886688864', code: '1234' }).expect(200);
  });
  it('accounts without a recovery mobile cannot use OTP reset', async () => {
    await http.post(api('/auth/staff/password/otp')).send({ login: 'nobody@test.mavy' }).expect(400);
  });
});
