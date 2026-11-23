/**
 * Reader community features: like/dislike, comments (with moderation) and story reports (grievance channel).
 */
import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, desc, eq, lt, or, sql, SQL } from 'drizzle-orm';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Db, InjectDb } from '../db/db.module';
import { articles, articleTranslations, comments, dislikes, likes, reports, users, Role } from '../db/schema';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';

const MODERATORS: Role[] = ['SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR', 'SUB_EDITOR'];

class ReactionDto { @IsIn(['like', 'dislike', 'none']) reaction: 'like' | 'dislike' | 'none'; }
class CommentDto { @IsString() @MinLength(1) @MaxLength(500) body: string; }
class PageQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
class ReportDto {
  @IsIn(['FAKE', 'WRONG_INFO', 'OFFENSIVE', 'COPYRIGHT', 'PRIVACY', 'OTHER']) reason: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class ModerateCommentDto { @IsBoolean() hidden: boolean; }
class ModerationListQuery {
  @IsOptional() @IsIn(['VISIBLE', 'HIDDEN']) status?: 'VISIBLE' | 'HIDDEN';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class ReportListQuery {
  @IsOptional() @IsIn(['OPEN', 'RESOLVED', 'REJECTED']) status?: 'OPEN' | 'RESOLVED' | 'REJECTED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class ResolveReportDto {
  @IsIn(['RESOLVED', 'REJECTED']) status: 'RESOLVED' | 'REJECTED';
  @IsString() @MinLength(3) @MaxLength(1000) resolution: string;
}

@Injectable()
export class CommunityService {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService) {}

  private reader(user: AuthUser) {
    if (user.guest) throw new ForbiddenException('Please log in with your phone number to use this feature.');
    return user.id;
  }

  private async requirePublished(id: string) {
    const [a] = await this.db.select({ id: articles.id }).from(articles).where(and(eq(articles.id, id), eq(articles.status, 'PUBLISHED')));
    if (!a) throw new NotFoundException('Story not found');
  }

  /** One reaction per reader per story: like, dislike or none. Counts are kept exact. */
  async react(user: AuthUser, articleId: string, reaction: 'like' | 'dislike' | 'none') {
    const userId = this.reader(user);
    await this.requirePublished(articleId);
    return this.db.transaction(async (tx) => {
      const delLike = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.articleId, articleId))).returning();
      const delDis = await tx.delete(dislikes).where(and(eq(dislikes.userId, userId), eq(dislikes.articleId, articleId))).returning();
      let likeDelta = -delLike.length, dislikeDelta = -delDis.length;
      if (reaction === 'like') { await tx.insert(likes).values({ userId, articleId }); likeDelta += 1; }
      if (reaction === 'dislike') { await tx.insert(dislikes).values({ userId, articleId }); dislikeDelta += 1; }
      const [a] = await tx.update(articles).set({
        likeCount: sql`greatest(${articles.likeCount} + ${likeDelta}, 0)`,
        dislikeCount: sql`greatest(${articles.dislikeCount} + ${dislikeDelta}, 0)`,
      }).where(eq(articles.id, articleId)).returning({ likeCount: articles.likeCount, dislikeCount: articles.dislikeCount });
      return { reaction, liked: reaction === 'like', disliked: reaction === 'dislike', ...a };
    });
  }

  // ---------- comments ----------
  async listComments(articleId: string, q: PageQuery, user?: AuthUser) {
    await this.requirePublished(articleId);
    const limit = q.limit ?? 20;
    const where: SQL[] = [eq(comments.articleId, articleId), eq(comments.status, 'VISIBLE')];
    if (q.cursor) {
      const [ts, cid] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      const d = new Date(ts);
      if (!cid || isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(cid)) throw new BadRequestException('Invalid cursor');
      where.push(or(lt(comments.createdAt, d), and(eq(comments.createdAt, d), lt(comments.id, cid)))!);
    }
    const rows = await this.db.select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, userId: comments.userId, name: users.name })
      .from(comments).innerJoin(users, eq(users.id, comments.userId))
      .where(and(...where)).orderBy(desc(comments.createdAt), desc(comments.id)).limit(limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, author: r.name || 'MAVY reader', mine: !!user && r.userId === user.id })),
      nextCursor: rows.length === limit && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  async addComment(user: AuthUser, articleId: string, body: string, ip: string) {
    const userId = this.reader(user);
    await this.requirePublished(articleId);
    const text = body.replace(/\s+/g, ' ').trim();
    if (!text) throw new BadRequestException('Comment is empty');
    if (/(https?:\/\/|www\.)/i.test(text)) throw new BadRequestException('Links are not allowed in comments');
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(comments)
      .where(and(eq(comments.userId, userId), sql`${comments.createdAt} > now() - interval '1 hour'`));
    if (n >= 20) throw new BadRequestException('Too many comments. Please try again later.');
    const c = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(comments).values({ articleId, userId, body: text }).returning();
      await tx.update(articles).set({ commentCount: sql`${articles.commentCount} + 1` }).where(eq(articles.id, articleId));
      return row;
    });
    await this.audit.log({ actorId: userId, action: 'comment.create', entity: 'comment', entityId: c.id, metadata: { articleId }, ip });
    const [u] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return { id: c.id, body: c.body, createdAt: c.createdAt, author: u?.name || 'MAVY reader', mine: true };
  }

  private async setHidden(id: string, hidden: boolean, actorId: string) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(comments).where(eq(comments.id, id));
      if (!c) throw new NotFoundException('Comment not found');
      const want = hidden ? 'HIDDEN' : 'VISIBLE';
      if (c.status === want) return c;
      const [row] = await tx.update(comments).set({ status: want, hiddenBy: hidden ? actorId : null }).where(eq(comments.id, id)).returning();
      await tx.update(articles).set({ commentCount: sql`greatest(${articles.commentCount} + ${hidden ? -1 : 1}, 0)` }).where(eq(articles.id, c.articleId));
      return row;
    });
  }

  /** Readers can remove their own comment; moderators can remove any. */
  async deleteComment(user: AuthUser, id: string, ip: string) {
    const [c] = await this.db.select().from(comments).where(eq(comments.id, id));
    if (!c) throw new NotFoundException('Comment not found');
    if (c.userId !== user.id && !MODERATORS.includes(user.role as Role)) throw new ForbiddenException('You can only delete your own comment');
    await this.setHidden(id, true, user.id);
    await this.audit.log({ actorId: user.id, action: 'comment.delete', entity: 'comment', entityId: id, ip });
    return { deleted: true };
  }

  async moderationList(q: ModerationListQuery) {
    return this.db.select({
      id: comments.id, body: comments.body, status: comments.status, createdAt: comments.createdAt,
      articleId: comments.articleId, author: users.name, phone: users.phone, headline: articleTranslations.headline,
    }).from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(articleTranslations, and(eq(articleTranslations.articleId, comments.articleId), eq(articleTranslations.language, 'te')))
      .where(q.status ? eq(comments.status, q.status) : undefined)
      .orderBy(desc(comments.createdAt)).limit(q.limit ?? 50);
  }

  async moderate(id: string, hidden: boolean, actor: AuthUser, ip: string) {
    const c = await this.setHidden(id, hidden, actor.id);
    await this.audit.log({ actorId: actor.id, action: hidden ? 'comment.hide' : 'comment.restore', entity: 'comment', entityId: id, ip });
    return c;
  }

  // ---------- reports (grievances) ----------
  async report(articleId: string, dto: ReportDto, user: AuthUser | undefined, ip: string) {
    const [a] = await this.db.select({ id: articles.id }).from(articles).where(eq(articles.id, articleId));
    if (!a) throw new NotFoundException('Story not found');
    const userId = user && !user.guest ? user.id : null;
    if (userId) {
      const [dup] = await this.db.select({ id: reports.id }).from(reports)
        .where(and(eq(reports.articleId, articleId), eq(reports.userId, userId), eq(reports.status, 'OPEN')));
      if (dup) return { id: dup.id, received: true };
    }
    const [r] = await this.db.insert(reports).values({ articleId, userId, reason: dto.reason as any, note: dto.note, ip }).returning({ id: reports.id });
    await this.audit.log({ actorId: userId, action: 'report.create', entity: 'article', entityId: articleId, metadata: { reportId: r.id, reason: dto.reason }, ip });
    return { id: r.id, received: true };
  }

  async listReports(q: ReportListQuery) {
    return this.db.select({
      id: reports.id, reason: reports.reason, note: reports.note, status: reports.status, resolution: reports.resolution,
      createdAt: reports.createdAt, resolvedAt: reports.resolvedAt, articleId: reports.articleId, headline: articleTranslations.headline,
    }).from(reports)
      .leftJoin(articleTranslations, and(eq(articleTranslations.articleId, reports.articleId), eq(articleTranslations.language, 'te')))
      .where(eq(reports.status, q.status ?? 'OPEN'))
      .orderBy(desc(reports.createdAt)).limit(q.limit ?? 50);
  }

  async resolveReport(id: string, dto: ResolveReportDto, actor: AuthUser, ip: string) {
    const [r] = await this.db.update(reports).set({ status: dto.status, resolution: dto.resolution, handledBy: actor.id, resolvedAt: new Date() })
      .where(and(eq(reports.id, id), eq(reports.status, 'OPEN'))).returning();
    if (!r) throw new NotFoundException('Open report not found');
    await this.audit.log({ actorId: actor.id, action: `report.${dto.status.toLowerCase()}`, entity: 'report', entityId: id, metadata: { resolution: dto.resolution }, ip });
    return r;
  }
}

@Controller()
class CommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Post('articles/:id/reaction') @HttpCode(200)
  react(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReactionDto, @CurrentUser() u: AuthUser) { return this.svc.react(u, id, dto.reaction); }

  @Public() @Get('articles/:id/comments')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery, @CurrentUser() u?: AuthUser) { return this.svc.listComments(id, q, u); }

  @Post('articles/:id/comments') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  add(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.addComment(u, id, dto.body, ip); }

  @Delete('comments/:id') @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.deleteComment(u, id, ip); }

  @Public() @Post('articles/:id/report') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  report(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto, @CurrentUser() u: AuthUser | undefined, @ClientIp() ip: string) {
    return this.svc.report(id, dto, u, ip);
  }

  @Get('newsroom/comments') @Roles(...MODERATORS)
  modList(@Query() q: ModerationListQuery) { return this.svc.moderationList(q); }

  @Patch('newsroom/comments/:id') @Roles(...MODERATORS)
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateCommentDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.moderate(id, dto.hidden, u, ip);
  }

  @Get('newsroom/reports') @Roles('SUPER_ADMIN', 'MANAGING_EDITOR')
  reports(@Query() q: ReportListQuery) { return this.svc.listReports(q); }

  @Patch('newsroom/reports/:id') @Roles('SUPER_ADMIN', 'MANAGING_EDITOR')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.resolveReport(id, dto, u, ip);
  }
}

@Module({ controllers: [CommunityController], providers: [CommunityService], exports: [CommunityService] })
export class CommunityModule {}
