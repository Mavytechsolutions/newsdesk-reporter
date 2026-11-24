import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { Db, InjectDb } from '../db/db.module';
import { otpRequests, refreshTokens, staffProfiles, users, Role } from '../db/schema';
import { normalizeIndianPhone } from '../common/text';
import { AuditService } from '../audit/audit.module';
import { SMS_PROVIDER, SmsProvider } from './sms/sms.provider';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hashOtp = (phone: string, code: string, purpose = 'login') =>
  createHmac('sha256', config.jwtRefreshSecret).update(purpose === 'login' ? `${phone}:${code}` : `${purpose}:${phone}:${code}`).digest('hex');
/** Staff passwords: at least 10 characters with letters and numbers. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,}$/;
const mask = (phone: string) => `******${phone.slice(-4)}`;

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  // ---------- Phone OTP ----------
  async requestOtp(rawPhone: string, ip: string) {
    const phone = normalizeIndianPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');

    const hourAgo = new Date(Date.now() - 3600_000);
    const [{ n }] = await this.db.select({ n: count() }).from(otpRequests).where(and(eq(otpRequests.phone, phone), eq(otpRequests.purpose, 'login'), gt(otpRequests.createdAt, hourAgo)));
    if (n >= config.otpMaxPerHour) throw new HttpException('Too many OTP requests. Please try again after an hour.', HttpStatus.TOO_MANY_REQUESTS);

    const code = config.otpFixedCode || String(randomInt(100000, 1000000));
    await this.db.insert(otpRequests).values({
      phone, ip, codeHash: hashOtp(phone, code), expiresAt: new Date(Date.now() + config.otpTtlSeconds * 1000),
    });
    if (!config.otpFixedCode) await this.sms.sendOtp(phone, code);
    return { sent: true, phone, expiresInSeconds: config.otpTtlSeconds, codeLength: code.length };
  }

  async verifyOtp(rawPhone: string, code: string, ip: string) {
    const phone = normalizeIndianPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
    const [otp] = await this.db.select().from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), eq(otpRequests.purpose, 'login'), eq(otpRequests.consumed, false), gt(otpRequests.expiresAt, new Date())))
      .orderBy(desc(otpRequests.createdAt)).limit(1);
    if (!otp) throw new UnauthorizedException('OTP expired. Please request a new one.');
    if (otp.attempts >= config.otpMaxAttempts) throw new UnauthorizedException('Too many wrong attempts. Please request a new OTP.');

    const ok = timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hashOtp(phone, code.trim())));
    if (!ok) {
      await this.db.update(otpRequests).set({ attempts: otp.attempts + 1 }).where(eq(otpRequests.id, otp.id));
      throw new UnauthorizedException('Wrong OTP.');
    }
    await this.db.update(otpRequests).set({ consumed: true }).where(eq(otpRequests.id, otp.id));

    let [user] = await this.db.select().from(users).where(eq(users.phone, phone));
    let isNew = false;
    if (!user) {
      [user] = await this.db.insert(users).values({ phone }).returning();
      isNew = true;
      await this.audit.log({ actorId: user.id, action: 'user.register', entity: 'user', entityId: user.id, ip });
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('This account is not active.');
    return { ...(await this.issueTokens(user.id, user.role, 'otp')), isNewUser: isNew };
  }

  // ---------- Guest ----------
  async guest() {
    const id = `guest:${randomUUID()}`;
    const accessToken = await this.jwt.signAsync({ sub: id, role: 'GUEST' }, { secret: config.jwtAccessSecret, expiresIn: '30d' });
    return { accessToken, guest: true };
  }

  // ---------- Staff (newsroom) ----------
  /** Staff log in with their email or their short username (e.g. "admin"). */
  private async findStaff(login: string) {
    const id = login.toLowerCase().trim();
    const [row] = await this.db.select({ u: users, s: staffProfiles }).from(users)
      .innerJoin(staffProfiles, eq(staffProfiles.userId, users.id))
      .where(or(eq(users.email, id), eq(users.username, id)));
    return row;
  }

  async staffLogin(email: string, password: string, ip: string) {
    const row = await this.findStaff(email);
    const valid = row?.u.passwordHash && (await bcrypt.compare(password, row.u.passwordHash));
    if (!row || !valid) {
      await this.audit.log({ action: 'staff.login_failed', entity: 'user', entityId: row?.u.id, metadata: { email }, ip });
      throw new UnauthorizedException('Wrong username or password.');
    }
    if (row.u.status !== 'ACTIVE' || row.s.suspendedAt || row.s.revokedAt) throw new UnauthorizedException('Your newsroom access is suspended.');
    await this.audit.log({ actorId: row.u.id, action: 'staff.login', entity: 'user', entityId: row.u.id, ip });
    return { ...(await this.issueTokens(row.u.id, row.u.role, 'pwd')), role: row.u.role, name: row.u.name };
  }

  // ---------- Staff password change / reset (OTP to the account's recovery mobile) ----------
  /** Always a real random code sent by SMS — never the testing code — because it can change an admin password. */
  async passwordOtp(login: string, ip: string) {
    const row = await this.findStaff(login);
    const phone = row?.u.recoveryPhone;
    if (!row || !phone) {
      await this.audit.log({ action: 'staff.password_otp_unavailable', entity: 'user', entityId: row?.u.id, metadata: { login }, ip });
      throw new BadRequestException('Password change by OTP is not set up for this account. Ask the master admin.');
    }
    const hourAgo = new Date(Date.now() - 3600_000);
    const [{ n }] = await this.db.select({ n: count() }).from(otpRequests).where(and(eq(otpRequests.phone, phone), eq(otpRequests.purpose, 'pwd_reset'), gt(otpRequests.createdAt, hourAgo)));
    if (n >= 5) throw new HttpException('Too many OTP requests. Please try again after an hour.', HttpStatus.TOO_MANY_REQUESTS);
    const code = String(randomInt(100000, 1000000));
    await this.db.insert(otpRequests).values({ phone, ip, purpose: 'pwd_reset', codeHash: hashOtp(phone, code, 'pwd_reset'), expiresAt: new Date(Date.now() + 600_000) });
    await this.sms.sendOtp(phone, code);
    await this.audit.log({ actorId: row.u.id, action: 'staff.password_otp', entity: 'user', entityId: row.u.id, ip });
    return { sent: true, to: mask(phone), expiresInSeconds: 600, codeLength: 6 };
  }

  async passwordReset(login: string, code: string, newPassword: string, ip: string) {
    const row = await this.findStaff(login);
    const phone = row?.u.recoveryPhone;
    if (!row || !phone) throw new BadRequestException('Password change by OTP is not set up for this account.');
    if (!PASSWORD_RULE.test(newPassword)) throw new BadRequestException('New password: at least 10 characters with letters and numbers.');
    const [otp] = await this.db.select().from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), eq(otpRequests.purpose, 'pwd_reset'), eq(otpRequests.consumed, false), gt(otpRequests.expiresAt, new Date())))
      .orderBy(desc(otpRequests.createdAt)).limit(1);
    if (!otp) throw new UnauthorizedException('OTP expired. Please request a new one.');
    if (otp.attempts >= config.otpMaxAttempts) throw new UnauthorizedException('Too many wrong attempts. Please request a new OTP.');
    if (!timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hashOtp(phone, code.trim(), 'pwd_reset')))) {
      await this.db.update(otpRequests).set({ attempts: otp.attempts + 1 }).where(eq(otpRequests.id, otp.id));
      await this.audit.log({ actorId: row.u.id, action: 'staff.password_reset_failed', entity: 'user', entityId: row.u.id, ip });
      throw new UnauthorizedException('Wrong OTP.');
    }
    const passwordHash = await AuthService.hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(otpRequests).set({ consumed: true }).where(eq(otpRequests.id, otp.id));
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.u.id));
      await this.revokeAll(row.u.id, tx as unknown as Db); // log out everywhere
      await this.audit.log({ actorId: row.u.id, action: 'staff.password_reset', entity: 'user', entityId: row.u.id, ip }, tx as unknown as Db);
    });
    return { ok: true };
  }

  // ---------- Tokens ----------
  async refresh(refreshToken: string) {
    const [row] = await this.db.select().from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, sha256(refreshToken)), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())));
    if (!row) throw new UnauthorizedException('Session expired. Please log in again.');
    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId));
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active.');
    // rotate: old token can no longer be used
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return this.issueTokens(user.id, user.role, row.method === 'otp' ? 'otp' : 'pwd');
  }

  async logout(refreshToken: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(refreshToken)));
    return { ok: true };
  }

  async revokeAll(userId: string, tx: Db = this.db) {
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  static hashPassword(pw: string) {
    return bcrypt.hash(pw, 12);
  }

  private async issueTokens(userId: string, role: Role, method: 'otp' | 'pwd') {
    // Phone (OTP) logins are always reader sessions, even for staff: newsroom powers need the password login.
    const effective: Role = method === 'otp' ? 'READER' : role;
    const accessToken = await this.jwt.signAsync({ sub: userId, role: effective, amr: method }, { secret: config.jwtAccessSecret, expiresIn: config.jwtAccessTtl });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.insert(refreshTokens).values({
      userId, tokenHash: sha256(refreshToken), method, expiresAt: new Date(Date.now() + config.refreshTtlDays * 86400_000),
    });
    return { accessToken, refreshToken, userId };
  }
}
