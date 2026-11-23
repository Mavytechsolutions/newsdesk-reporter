/**
 * Phase 2: reader-facing feed, search and engagement (bookmarks, likes, history, shares).
 */
import {
  BadRequestException, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Query, Body,
} from '@nestjs/common';
import { and, desc, eq, exists, gte, ilike, inArray, lte, or, sql, SQL } from 'drizzle-orm';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Db, InjectDb } from '../db/db.module';
import {
  articleLocations, articles, articleTags, articleTranslations, bookmarks, categories, likes, locations, readEvents,
  userCategories, userLocations, users,
} from '../db/schema';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ArticlesService } from './articles.service';
import { ArticlesModule } from './articles.module';

const csvUuids = () => Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value));

class FeedQuery {
  /** for-you | local | breaking | <category slug> */
  @IsOptional() @IsString() @MaxLength(40) tab?: string;
  /** Guests send their chosen places from the device. Logged-in readers use their saved places. */
  @IsOptional() @csvUuids() @IsUUID('all', { each: true }) locationIds?: string[];
  @IsOptional() @IsIn(['te', 'en']) lang?: 'te' | 'en';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class SearchQuery {
  @IsString() @MinLength(2) @MaxLength(100) q: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(['te', 'en']) lang?: 'te' | 'en';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class SuggestQuery { @IsString() @MinLength(1) @MaxLength(60) q: string; }
class LikeDto { @IsBoolean() liked: boolean; }
class PageQuery {
  @IsOptional() @IsIn(['te', 'en']) lang?: 'te' | 'en';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

@Injectable()
export class FeedService {
  constructor(@InjectDb() private readonly db: Db, private readonly articlesSvc: ArticlesService) {}

  private withinAny(locationIds: string[]): SQL {
    return exists(this.db.select({ x: sql`1` }).from(articleLocations)
      .innerJoin(locations, eq(locations.id, articleLocations.locationId))
      .where(and(eq(articleLocations.articleId, articles.id), or(...locationIds.map((id) => sql`${locations.path} like ${'%/' + id + '/%'}`)))));
  }

  /** Statewide or wider news (tagged at STATE level) is relevant to every reader. */
  private broadNews(): SQL {
    return exists(this.db.select({ x: sql`1` }).from(articleLocations)
      .innerJoin(locations, eq(locations.id, articleLocations.locationId))
      .where(and(eq(articleLocations.articleId, articles.id), eq(locations.type, 'STATE'))));
  }

  private async prefs(user?: AuthUser, guestLocations?: string[]) {
    if (!user || user.guest) return { locationIds: guestLocations ?? [], categoryIds: [] as string[] };
    const [locs, cats] = await Promise.all([
      this.db.select({ id: userLocations.locationId }).from(userLocations).where(eq(userLocations.userId, user.id)),
      this.db.select({ id: userCategories.categoryId }).from(userCategories).where(eq(userCategories.userId, user.id)),
    ]);
    return { locationIds: guestLocations?.length ? guestLocations : locs.map((l) => l.id), categoryIds: cats.map((c) => c.id) };
  }

  async feed(q: FeedQuery, user?: AuthUser) {
    const lang = q.lang ?? 'te';
    const tab = q.tab ?? 'for-you';
    const where: SQL[] = [];
    const p = await this.prefs(user, q.locationIds);

    if (tab === 'for-you') {
      // Your places + your categories + breaking + statewide news. With no preferences: everything.
      if (p.locationIds.length || p.categoryIds.length) {
        const any: SQL[] = [eq(articles.isBreaking, true), this.broadNews()];
        if (p.locationIds.length) any.push(this.withinAny(p.locationIds));
        if (p.categoryIds.length) any.push(inArray(articles.categoryId, p.categoryIds));
        where.push(or(...any)!);
      }
    } else if (tab === 'local') {
      if (!p.locationIds.length) return { items: [], nextCursor: null, needsLocation: true };
      where.push(this.withinAny(p.locationIds));
    } else if (tab === 'breaking') {
      where.push(eq(articles.isBreaking, true));
    } else {
      const [c] = await this.db.select().from(categories).where(eq(categories.slug, tab));
      if (!c || c.isVirtual) throw new NotFoundException('Unknown news tab');
      where.push(eq(articles.categoryId, c.id));
    }
    return this.articlesSvc.page(where, q, lang, user?.id);
  }

  async search(q: SearchQuery, user?: AuthUser) {
    const term = `%${q.q.trim().replace(/[%_\\]/g, '')}%`;
    const where: SQL[] = [
      or(
        exists(this.db.select({ x: sql`1` }).from(articleTranslations)
          .where(and(eq(articleTranslations.articleId, articles.id), or(ilike(articleTranslations.headline, term), ilike(articleTranslations.summary, term))))),
        exists(this.db.select({ x: sql`1` }).from(articleTags).where(and(eq(articleTags.articleId, articles.id), ilike(articleTags.tag, term)))),
        exists(this.db.select({ x: sql`1` }).from(users).where(and(eq(users.id, articles.authorId), ilike(users.name, term)))),
        exists(this.db.select({ x: sql`1` }).from(articleLocations).innerJoin(locations, eq(locations.id, articleLocations.locationId))
          .where(and(eq(articleLocations.articleId, articles.id), or(ilike(locations.nameEn, term), ilike(locations.nameTe, term))))),
      )!,
    ];
    if (q.category) {
      const [c] = await this.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, q.category));
      if (!c) throw new NotFoundException('Category not found');
      where.push(eq(articles.categoryId, c.id));
    }
    if (q.locationId) where.push(this.withinAny([q.locationId]));
    if (q.from) where.push(gte(articles.publishedAt, new Date(q.from)));
    if (q.to) where.push(lte(articles.publishedAt, new Date(q.to)));
    const res = await this.articlesSvc.page(where, q, q.lang ?? 'te', user?.id);
    const didYouMean = res.items.length || q.cursor ? null : await this.closestTerm(q.q);
    return { ...res, didYouMean };
  }

  /** Spelling help: nearest place name or tag by trigram similarity. */
  private async closestTerm(q: string): Promise<string | null> {
    const r = await this.db.execute(sql`
      select term from (
        select name_en as term, similarity(name_en, ${q}) as s from locations
        union all select name_te, similarity(name_te, ${q}) from locations
        union all select distinct tag, similarity(tag, ${q}) from article_tags
      ) t where s > 0.3 order by s desc limit 1`);
    return (r.rows[0] as any)?.term ?? null;
  }

  async suggest(q: string) {
    const term = `%${q.trim().replace(/[%_\\]/g, '')}%`;
    const [locs, tags] = await Promise.all([
      this.db.select({ id: locations.id, type: locations.type, nameEn: locations.nameEn, nameTe: locations.nameTe }).from(locations)
        .where(or(ilike(locations.nameEn, term), ilike(locations.nameTe, term))).limit(6),
      this.db.selectDistinct({ tag: articleTags.tag }).from(articleTags).where(ilike(articleTags.tag, term)).limit(6),
    ]);
    return { locations: locs, tags: tags.map((t) => t.tag) };
  }

  // ---------- engagement ----------
  private async requirePublished(id: string) {
    const [a] = await this.db.select({ id: articles.id }).from(articles).where(and(eq(articles.id, id), eq(articles.status, 'PUBLISHED')));
    if (!a) throw new NotFoundException('Story not found');
  }

  private reader(user: AuthUser) {
    if (user.guest) throw new ForbiddenException('Please log in with your phone number to use this feature.');
    return user.id;
  }

  async bookmark(user: AuthUser, articleId: string, on: boolean) {
    const userId = this.reader(user);
    if (on) {
      await this.requirePublished(articleId);
      await this.db.insert(bookmarks).values({ userId, articleId }).onConflictDoNothing();
    } else await this.db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.articleId, articleId)));
    return { bookmarked: on };
  }

  async listBookmarks(user: AuthUser, q: PageQuery) {
    const userId = this.reader(user);
    const rows = await this.db.select({ id: bookmarks.articleId }).from(bookmarks).innerJoin(articles, eq(articles.id, bookmarks.articleId))
      .where(and(eq(bookmarks.userId, userId), eq(articles.status, 'PUBLISHED'))).orderBy(desc(bookmarks.createdAt)).limit(q.limit ?? 100);
    const map = await this.articlesSvc.hydrate(rows.map((r) => r.id));
    return rows.map((r) => ({ ...this.articlesSvc.toCard(map.get(r.id)!, q.lang ?? 'te', true), bookmarked: true }));
  }

  async like(user: AuthUser, articleId: string, liked: boolean) {
    const userId = this.reader(user);
    await this.requirePublished(articleId);
    return this.db.transaction(async (tx) => {
      if (liked) {
        const ins = await tx.insert(likes).values({ userId, articleId }).onConflictDoNothing().returning();
        if (ins.length) await tx.update(articles).set({ likeCount: sql`${articles.likeCount} + 1` }).where(eq(articles.id, articleId));
      } else {
        const del = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.articleId, articleId))).returning();
        if (del.length) await tx.update(articles).set({ likeCount: sql`greatest(${articles.likeCount} - 1, 0)` }).where(eq(articles.id, articleId));
      }
      const [a] = await tx.select({ likeCount: articles.likeCount }).from(articles).where(eq(articles.id, articleId));
      return { liked, likeCount: a.likeCount };
    });
  }

  async share(articleId: string) {
    const r = await this.db.update(articles).set({ shareCount: sql`${articles.shareCount} + 1` })
      .where(and(eq(articles.id, articleId), eq(articles.status, 'PUBLISHED'))).returning({ shareCount: articles.shareCount });
    if (!r.length) throw new NotFoundException('Story not found');
    return r[0];
  }

  async markRead(user: AuthUser | undefined, articleId: string) {
    if (!user || user.guest) return { recorded: false };
    await this.requirePublished(articleId);
    await this.db.insert(readEvents).values({ userId: user.id, articleId })
      .onConflictDoUpdate({ target: [readEvents.userId, readEvents.articleId], set: { readAt: new Date() } });
    return { recorded: true };
  }

  async history(user: AuthUser, q: PageQuery) {
    const userId = this.reader(user);
    const rows = await this.db.select({ id: readEvents.articleId, readAt: readEvents.readAt }).from(readEvents)
      .innerJoin(articles, eq(articles.id, readEvents.articleId))
      .where(and(eq(readEvents.userId, userId), eq(articles.status, 'PUBLISHED'))).orderBy(desc(readEvents.readAt)).limit(q.limit ?? 50);
    const map = await this.articlesSvc.hydrate(rows.map((r) => r.id));
    return rows.map((r) => ({ ...this.articlesSvc.toCard(map.get(r.id)!, q.lang ?? 'te'), readAt: r.readAt }));
  }

  /** "Reset personalisation": clears reading history and followed categories. Places are kept. */
  async resetPersonalisation(user: AuthUser) {
    const userId = this.reader(user);
    await this.db.delete(readEvents).where(eq(readEvents.userId, userId));
    await this.db.delete(userCategories).where(eq(userCategories.userId, userId));
    return { reset: true };
  }
}

@Controller()
class FeedController {
  constructor(private readonly svc: FeedService) {}

  @Public() @Get('feed') feed(@Query() q: FeedQuery, @CurrentUser() u?: AuthUser) { return this.svc.feed(q, u); }
  @Public() @Get('search') search(@Query() q: SearchQuery, @CurrentUser() u?: AuthUser) { return this.svc.search(q, u); }
  @Public() @Get('search/suggest') suggest(@Query() q: SuggestQuery) { return this.svc.suggest(q.q); }
  @Public() @Post('articles/:id/share') @HttpCode(200) share(@Param('id', ParseUUIDPipe) id: string) { return this.svc.share(id); }
  @Public() @Post('articles/:id/read') @HttpCode(200) read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u?: AuthUser) { return this.svc.markRead(u, id); }

  @Post('articles/:id/like') @HttpCode(200)
  like(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LikeDto, @CurrentUser() u: AuthUser) { return this.svc.like(u, id, dto.liked); }

  @Get('me/bookmarks') bookmarks(@CurrentUser() u: AuthUser, @Query() q: PageQuery) { return this.svc.listBookmarks(u, q); }
  @Put('me/bookmarks/:id') @HttpCode(200) addBookmark(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.bookmark(u, id, true); }
  @Delete('me/bookmarks/:id') @HttpCode(200) removeBookmark(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.bookmark(u, id, false); }
  @Get('me/history') history(@CurrentUser() u: AuthUser, @Query() q: PageQuery) { return this.svc.history(u, q); }
  @Delete('me/personalization') @HttpCode(200) reset(@CurrentUser() u: AuthUser) { return this.svc.resetPersonalisation(u); }
}

@Module({ imports: [ArticlesModule], controllers: [FeedController], providers: [FeedService] })
export class FeedModule {}
