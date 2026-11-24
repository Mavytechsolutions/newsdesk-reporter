/**
 * Citizen journalists ("Become a journalist today").
 *
 * App (any logged-in reader, phone OTP is fine):
 *   GET   /journalist/me                 my application / level / points / progress
 *   POST  /journalist/apply              multipart: name, locationId, consent=true, file=<Aadhaar photo>
 *   POST  /journalist/media              multipart file → story photo URL (approved journalists)
 *   POST  /journalist/posts              send a story for review
 *   GET   /journalist/posts              my stories with status and editor notes
 *   PATCH /journalist/posts/:id          fix a story the editor sent back, and resend it
 *   GET   /journalist/leaderboard        top journalists by points (public)
 *
 * Admin page (Super Admin, Managing Editor, and sub-admins for their own district / mandal):
 *   GET   /admin/journalist-applications?status=PENDING
 *   GET   /admin/journalist-applications/:id/aadhaar     the private photo (every view is audit-logged)
 *   POST  /admin/journalist-applications/:id/decision    { decision: approve|reject, note }
 *   GET   /admin/journalists                             approved journalists with points
 *   PATCH /admin/journalists/:id                         { action: suspend|reactivate, reason }
 *
 * Privacy: the Aadhaar photo is stored outside the public photo folder, never sent to the app,
 * and deleted as soon as an admin approves or rejects the request. We never ask for the Aadhaar number.
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { and, desc, eq, gte, inArray, isNotNull, or, sql, SQL } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import path from 'path';
import { Db, InjectDb } from '../db/db.module';
import {
  articleLocations, articles, articleStatusHistory, articleTranslations, categories, journalistApplications, locations,
  pointEvents, staffAssignments, users, Role,
} from '../db/schema';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import { LocationsModule, LocationsService, isWithinAny } from '../locations/locations.module';
import { slugify } from '../common/text';
import { config } from '../config';
import { MAX_BYTES, processPhoto, savePublicPhoto } from '../media/media.module';
import { UNSCOPED_ROLES } from '../articles/workflow';
import { LEVELS, nextLevel } from './points';

const PRIVATE_DIR = () => path.join(config.mediaDir, 'private');
const PRIVATE_RE = /^[a-f0-9]{32}\.jpg$/;
const DAILY_POST_LIMIT = 20;
const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR'];

class ApplyDto {
  @IsString() @MinLength(3) @MaxLength(80) name: string;
  @IsUUID() locationId: string;
  /** "I am 18+, the Aadhaar is mine, I will send only true news" */
  @Transform(({ value }) => value === true || value === 'true') @IsIn([true], { message: 'Please accept the declaration' }) consent: boolean;
}
class PostDto {
  @IsIn(['te', 'en']) language: 'te' | 'en';
  @IsString() @MinLength(10) @MaxLength(160) headline: string;
  @IsString() @MinLength(30) @MaxLength(5000) body: string;
  @IsUUID() categoryId: string;
  @IsUUID() locationId: string;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true }) heroImageUrl?: string | null;
}
class ListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class AppListDto {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}
class DecisionDto {
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class JournalistActionDto {
  @IsIn(['suspend', 'reactivate']) action: 'suspend' | 'reactivate';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** First ~60 words of the story, used as the short news shown on the card. */
function summaryOf(body: string) {
  const w = body.trim().split(/\s+/);
  return w.length <= 60 ? body.trim() : `${w.slice(0, 60).join(' ')}…`;
}

@Injectable()
export class JournalistsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly locs: LocationsService,
    private readonly audit: AuditService,
  ) {
    if (!existsSync(PRIVATE_DIR())) mkdirSync(PRIVATE_DIR(), { recursive: true });
  }

  // ---------- app ----------
  async me(userId: string) {
    const [u] = await this.db.select({
      name: users.name, level: users.contributorLevel, since: users.contributorSince, suspendedAt: users.contributorSuspendedAt,
      points: users.points, approvedPosts: users.approvedPosts,
    }).from(users).where(eq(users.id, userId));
    const [app] = await this.db.select({
      id: journalistApplications.id, status: journalistApplications.status, note: journalistApplications.note,
      name: journalistApplications.name, createdAt: journalistApplications.createdAt, reviewedAt: journalistApplications.reviewedAt,
    }).from(journalistApplications).where(eq(journalistApplications.userId, userId)).orderBy(desc(journalistApplications.createdAt)).limit(1);
    const recent = await this.db.select({ points: pointEvents.points, createdAt: pointEvents.createdAt, articleId: pointEvents.articleId })
      .from(pointEvents).where(eq(pointEvents.userId, userId)).orderBy(desc(pointEvents.createdAt)).limit(10);
    const state = u.level ? (u.suspendedAt ? 'SUSPENDED' : 'APPROVED') : app?.status ?? 'NONE';
    return {
      state, // NONE | PENDING | REJECTED | APPROVED | SUSPENDED
      application: app ?? null,
      name: u.name,
      level: u.level,
      points: u.points,
      approvedPosts: u.approvedPosts,
      since: u.since,
      next: u.level ? nextLevel(u.approvedPosts) : null,
      pointsPerPost: u.level ? LEVELS.find((l) => l.level === u.level)!.points : null,
      levels: LEVELS,
      recentPoints: recent,
    };
  }

  async apply(user: AuthUser, dto: ApplyDto, file: Express.Multer.File | undefined, ip: string) {
    if (!file) throw new BadRequestException('Please add a photo of your Aadhaar card');
    const [u] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (u.contributorLevel) throw new ConflictException('You are already a MAVY NEWS journalist');
    const [pending] = await this.db.select({ id: journalistApplications.id }).from(journalistApplications)
      .where(and(eq(journalistApplications.userId, user.id), eq(journalistApplications.status, 'PENDING')));
    if (pending) throw new ConflictException('Your request is already waiting for approval');
    const [loc] = await this.locs.requireAll([dto.locationId]);
    if (!['DISTRICT', 'MANDAL', 'MUNICIPALITY'].includes(loc.type)) throw new BadRequestException('Choose your district or mandal');
    const img = await processPhoto(file.buffer, 1600, 85);
    const fileName = `${randomBytes(16).toString('hex')}.jpg`;
    await fs.writeFile(path.join(PRIVATE_DIR(), fileName), img, { mode: 0o600 });
    const [row] = await this.db.insert(journalistApplications).values({
      userId: user.id, name: dto.name.trim(), phone: u.phone, locationId: loc.id, aadhaarFile: fileName,
    }).returning({ id: journalistApplications.id });
    await this.audit.log({ actorId: user.id, action: 'journalist.apply', entity: 'journalist_application', entityId: row.id, ip });
    return this.me(user.id);
  }

  private async requireActiveJournalist(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u?.contributorLevel) throw new ForbiddenException('Only approved MAVY NEWS journalists can send stories. Apply from Profile → Become a journalist.');
    if (u.contributorSuspendedAt) throw new ForbiddenException('Your journalist access is paused. Please contact MAVY NEWS.');
    return u;
  }

  async uploadPhoto(user: AuthUser, file: Express.Multer.File | undefined, ip: string) {
    await this.requireActiveJournalist(user.id);
    if (!file) throw new BadRequestException('Choose a photo to upload');
    const out = await processPhoto(file.buffer);
    const { name, url } = await savePublicPhoto(out);
    await this.audit.log({ actorId: user.id, action: 'media.upload', entity: 'media', entityId: name, metadata: { bytes: out.length, journalist: true }, ip });
    return { url, bytes: out.length };
  }

  private async checkPost(dto: PostDto) {
    const [c] = await this.db.select().from(categories).where(eq(categories.id, dto.categoryId));
    if (!c || !c.active || c.isVirtual) throw new BadRequestException('Choose a valid news category');
    await this.locs.requireAll([dto.locationId]);
    if (dto.heroImageUrl && !dto.heroImageUrl.startsWith(`${config.publicWebUrl}/media/`)) throw new BadRequestException('Upload the photo from the app');
  }

  async createPost(user: AuthUser, dto: PostDto, ip: string) {
    const u = await this.requireActiveJournalist(user.id);
    await this.checkPost(dto);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(articles)
      .where(and(eq(articles.authorId, user.id), gte(articles.createdAt, new Date(Date.now() - 24 * 3600_000))));
    if (n >= DAILY_POST_LIMIT) throw new BadRequestException(`You can send up to ${DAILY_POST_LIMIT} stories a day. Please try tomorrow.`);
    const id = await this.db.transaction(async (tx) => {
      const [a] = await tx.insert(articles).values({
        slug: slugify(dto.headline), status: 'SUBMITTED', sourceType: 'CITIZEN', authorId: user.id, categoryId: dto.categoryId,
        heroImageUrl: dto.heroImageUrl ?? null, heroImageCredit: dto.heroImageUrl ? (u.name ?? 'MAVY NEWS') : null,
      }).returning({ id: articles.id });
      await tx.insert(articleTranslations).values({ articleId: a.id, language: dto.language, headline: dto.headline.trim(), summary: summaryOf(dto.body), body: dto.body.trim() });
      await tx.insert(articleLocations).values({ articleId: a.id, locationId: dto.locationId });
      await tx.insert(articleStatusHistory).values({ articleId: a.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: user.id, note: 'Sent from the app' });
      await this.audit.log({ actorId: user.id, action: 'journalist.post', entity: 'article', entityId: a.id, ip }, tx as unknown as Db);
      return a.id;
    });
    return (await this.myPosts(user.id, 1, id))[0];
  }

  async updatePost(user: AuthUser, id: string, dto: PostDto, ip: string) {
    await this.requireActiveJournalist(user.id);
    const [a] = await this.db.select().from(articles).where(eq(articles.id, id));
    if (!a || a.authorId !== user.id) throw new NotFoundException('Story not found');
    if (a.status !== 'CHANGES_REQUESTED') throw new BadRequestException('You can change a story only when the editor sends it back to you');
    await this.checkPost(dto);
    await this.db.transaction(async (tx) => {
      const res = await tx.update(articles).set({
        status: 'SUBMITTED', categoryId: dto.categoryId, updatedAt: new Date(),
        heroImageUrl: dto.heroImageUrl ?? null, heroImageCredit: dto.heroImageUrl ? a.heroImageCredit ?? 'MAVY NEWS' : null,
      }).where(and(eq(articles.id, id), eq(articles.status, 'CHANGES_REQUESTED'))).returning({ id: articles.id });
      if (!res.length) throw new BadRequestException('This story was just changed. Please refresh.');
      await tx.delete(articleTranslations).where(eq(articleTranslations.articleId, id));
      await tx.insert(articleTranslations).values({ articleId: id, language: dto.language, headline: dto.headline.trim(), summary: summaryOf(dto.body), body: dto.body.trim() });
      await tx.delete(articleLocations).where(eq(articleLocations.articleId, id));
      await tx.insert(articleLocations).values({ articleId: id, locationId: dto.locationId });
      await tx.insert(articleStatusHistory).values({ articleId: id, fromStatus: 'CHANGES_REQUESTED', toStatus: 'SUBMITTED', actorId: user.id, note: 'Corrected and resent from the app' });
      await this.audit.log({ actorId: user.id, action: 'journalist.resubmit', entity: 'article', entityId: id, ip }, tx as unknown as Db);
    });
    return (await this.myPosts(user.id, 1, id))[0];
  }

  async myPosts(userId: string, limit = 30, onlyId?: string) {
    const where: SQL[] = [eq(articles.authorId, userId), eq(articles.sourceType, 'CITIZEN')];
    if (onlyId) where.push(eq(articles.id, onlyId));
    const rows = await this.db.query.articles.findMany({
      where: and(...where), orderBy: desc(articles.createdAt), limit,
      with: { translations: true, category: true, locations: { with: { location: true } } },
    });
    const ids = rows.map((r) => r.id);
    const notes = ids.length ? await this.db.select().from(articleStatusHistory).where(inArray(articleStatusHistory.articleId, ids)).orderBy(desc(articleStatusHistory.createdAt)) : [];
    const pts = ids.length ? await this.db.select().from(pointEvents).where(inArray(pointEvents.articleId, ids)) : [];
    return rows.map((a) => {
      const t = a.translations[0];
      const lastNote = notes.find((n) => n.articleId === a.id && n.actorId !== userId && n.note);
      return {
        id: a.id, slug: a.slug, status: a.status, language: t?.language, headline: t?.headline, body: t?.body,
        category: { id: a.category.id, slug: a.category.slug, nameEn: a.category.nameEn, nameTe: a.category.nameTe },
        location: a.locations[0] ? { id: a.locations[0].location.id, nameEn: a.locations[0].location.nameEn, nameTe: a.locations[0].location.nameTe } : null,
        heroImageUrl: a.heroImageUrl,
        editorNote: lastNote?.note ?? null,
        points: pts.find((p) => p.articleId === a.id)?.points ?? 0,
        createdAt: a.createdAt, publishedAt: a.publishedAt,
        shareUrl: a.status === 'PUBLISHED' ? `${config.publicWebUrl}/n/${a.slug}` : null,
      };
    });
  }

  leaderboard() {
    return this.db.select({ name: users.name, level: users.contributorLevel, points: users.points, approvedPosts: users.approvedPosts })
      .from(users).where(and(isNotNull(users.contributorLevel), sql`${users.contributorSuspendedAt} is null`, eq(users.status, 'ACTIVE')))
      .orderBy(desc(users.points)).limit(20);
  }

  // ---------- admin ----------
  /** Location ids this admin may manage; null = everything. */
  private async scope(actor: AuthUser): Promise<string[] | null> {
    if (UNSCOPED_ROLES.includes(actor.role as Role)) return null;
    const rows = await this.db.select({ id: staffAssignments.locationId }).from(staffAssignments).where(eq(staffAssignments.staffId, actor.id));
    if (!rows.length) throw new ForbiddenException('You have no assigned district or mandal yet. Ask the Super Admin.');
    return rows.map((r) => r.id);
  }
  private scopeSql(scope: string[]) {
    return or(...scope.map((s) => sql`${locations.path} like ${'%/' + s + '/%'}`))!;
  }

  async listApplications(actor: AuthUser, status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') {
    const scope = await this.scope(actor);
    const where: SQL[] = [eq(journalistApplications.status, status)];
    if (scope) where.push(this.scopeSql(scope));
    const rows = await this.db.select({
      id: journalistApplications.id, name: journalistApplications.name, phone: journalistApplications.phone,
      status: journalistApplications.status, note: journalistApplications.note, createdAt: journalistApplications.createdAt,
      reviewedAt: journalistApplications.reviewedAt, hasAadhaar: sql<boolean>`${journalistApplications.aadhaarFile} is not null`,
      place: { id: locations.id, nameEn: locations.nameEn, nameTe: locations.nameTe, type: locations.type },
    }).from(journalistApplications).innerJoin(locations, eq(locations.id, journalistApplications.locationId))
      .where(and(...where)).orderBy(status === 'PENDING' ? journalistApplications.createdAt : desc(journalistApplications.reviewedAt)).limit(200);
    return rows;
  }

  private async loadApplication(actor: AuthUser, id: string) {
    const [row] = await this.db.select({ app: journalistApplications, path: locations.path }).from(journalistApplications)
      .innerJoin(locations, eq(locations.id, journalistApplications.locationId)).where(eq(journalistApplications.id, id));
    if (!row) throw new NotFoundException('Request not found');
    const scope = await this.scope(actor);
    if (scope && !isWithinAny(row.path, scope)) throw new ForbiddenException('This request is from outside your area');
    return row.app;
  }

  async aadhaar(actor: AuthUser, id: string, ip: string, res: Response) {
    const app = await this.loadApplication(actor, id);
    if (!app.aadhaarFile || !PRIVATE_RE.test(app.aadhaarFile)) throw new NotFoundException('The Aadhaar photo was deleted after the decision');
    const p = path.join(PRIVATE_DIR(), app.aadhaarFile);
    if (!existsSync(p)) throw new NotFoundException('Photo missing');
    await this.audit.log({ actorId: actor.id, action: 'journalist.aadhaar_view', entity: 'journalist_application', entityId: id, ip });
    res.setHeader('Cache-Control', 'no-store');
    res.type('jpg').sendFile(p);
  }

  async decide(actor: AuthUser, id: string, dto: DecisionDto, ip: string) {
    const app = await this.loadApplication(actor, id);
    if (app.status !== 'PENDING') throw new BadRequestException('This request was already decided');
    if (dto.decision === 'reject' && !dto.note?.trim()) throw new BadRequestException('Please write the reason, so the person knows what to fix');
    await this.db.transaction(async (tx) => {
      const ok = await tx.update(journalistApplications).set({
        status: dto.decision === 'approve' ? 'APPROVED' : 'REJECTED', note: dto.note?.trim() || null,
        reviewedBy: actor.id, reviewedAt: new Date(), aadhaarFile: null,
      }).where(and(eq(journalistApplications.id, id), eq(journalistApplications.status, 'PENDING'))).returning({ id: journalistApplications.id });
      if (!ok.length) throw new BadRequestException('This request was just decided by someone else');
      if (dto.decision === 'approve')
        await tx.update(users).set({ name: app.name, contributorLevel: 'JUNIOR', contributorSince: new Date(), contributorSuspendedAt: null, updatedAt: new Date() })
          .where(eq(users.id, app.userId));
      await this.audit.log({ actorId: actor.id, action: `journalist.${dto.decision}`, entity: 'journalist_application', entityId: id, ip, metadata: { note: dto.note } }, tx as unknown as Db);
    });
    // the Aadhaar photo is not needed any more
    if (app.aadhaarFile && PRIVATE_RE.test(app.aadhaarFile)) await fs.rm(path.join(PRIVATE_DIR(), app.aadhaarFile), { force: true });
    return { ok: true };
  }

  async listJournalists(actor: AuthUser) {
    const scope = await this.scope(actor);
    // a journalist's area = the place on their approved request
    const where: SQL[] = [isNotNull(users.contributorLevel), eq(journalistApplications.status, 'APPROVED')];
    if (scope) where.push(this.scopeSql(scope));
    return this.db.select({
      id: users.id, name: users.name, phone: users.phone, level: users.contributorLevel, points: users.points,
      approvedPosts: users.approvedPosts, since: users.contributorSince, suspendedAt: users.contributorSuspendedAt,
      place: { nameEn: locations.nameEn, nameTe: locations.nameTe },
    }).from(users)
      .innerJoin(journalistApplications, eq(journalistApplications.userId, users.id))
      .innerJoin(locations, eq(locations.id, journalistApplications.locationId))
      .where(and(...where)).orderBy(desc(users.points), users.id).limit(500);
  }

  async journalistAction(actor: AuthUser, id: string, dto: JournalistActionDto, ip: string) {
    const scope = await this.scope(actor);
    if (scope) {
      const [row] = await this.db.select({ path: locations.path }).from(journalistApplications)
        .innerJoin(locations, eq(locations.id, journalistApplications.locationId))
        .where(and(eq(journalistApplications.userId, id), eq(journalistApplications.status, 'APPROVED')));
      if (!row || !isWithinAny(row.path, scope)) throw new ForbiddenException('This journalist is from outside your area');
    }
    if (dto.action === 'suspend' && !dto.reason?.trim()) throw new BadRequestException('Please write the reason');
    const res = await this.db.update(users).set({ contributorSuspendedAt: dto.action === 'suspend' ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNotNull(users.contributorLevel))).returning({ id: users.id });
    if (!res.length) throw new NotFoundException('Journalist not found');
    await this.audit.log({ actorId: actor.id, action: `journalist.${dto.action}`, entity: 'user', entityId: id, ip, metadata: { reason: dto.reason } });
    return { ok: true };
  }
}

@Controller('journalist')
class JournalistAppController {
  constructor(private readonly svc: JournalistsService) {}
  @Get('me') me(@CurrentUser() u: AuthUser) { return this.svc.me(u.id); }

  @Post('apply')
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  apply(@Body() dto: ApplyDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.apply(u, dto, file, ip);
  }

  @Post('media')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  media(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.uploadPhoto(u, file, ip);
  }

  @Post('posts') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@Body() dto: PostDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.createPost(u, dto, ip); }
  @Get('posts') list(@Query() q: ListDto, @CurrentUser() u: AuthUser) { return this.svc.myPosts(u.id, q.limit ?? 30); }
  @Patch('posts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PostDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.updatePost(u, id, dto, ip);
  }
  @Public() @Get('leaderboard') leaderboard() { return this.svc.leaderboard(); }
}

@Controller('admin')
@Roles(...ADMIN_ROLES)
class JournalistAdminController {
  constructor(private readonly svc: JournalistsService) {}
  @Get('journalist-applications') list(@Query() q: AppListDto, @CurrentUser() u: AuthUser) { return this.svc.listApplications(u, q.status); }
  @Get('journalist-applications/:id/aadhaar')
  aadhaar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string, @Res() res: Response) {
    return this.svc.aadhaar(u, id, ip, res);
  }
  @Post('journalist-applications/:id/decision')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.decide(u, id, dto, ip);
  }
  @Get('journalists') journalists(@CurrentUser() u: AuthUser) { return this.svc.listJournalists(u); }
  @Patch('journalists/:id')
  act(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JournalistActionDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.journalistAction(u, id, dto, ip);
  }
}

@Module({ imports: [LocationsModule], controllers: [JournalistAppController, JournalistAdminController], providers: [JournalistsService] })
export class JournalistsModule {}
