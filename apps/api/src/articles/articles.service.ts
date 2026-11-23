import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, inArray, lte, ne, or, lt, sql, SQL } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import {
  articleLocations, articles, articleStatusHistory, articleTags, articleTranslations, categories, locations,
  staffAssignments, bookmarks, likes, dislikes, ArticleStatus, Language, Role,
} from '../db/schema';
import { AuthUser } from '../common/auth.decorators';
import { slugify, wordCount } from '../common/text';
import { AuditService } from '../audit/audit.module';
import { isWithinAny, LocationsService } from '../locations/locations.module';
import { config } from '../config';
import { canEdit, UNSCOPED_ROLES, WORKFLOW } from './workflow';
import { CreateArticleDto, NewsroomListQuery, PublicListQuery, TransitionDto, UpdateArticleDto, TranslationDto } from './articles.dto';

const SOURCE_LABELS: Record<string, string> = {
  STAFF: 'MAVY NEWS',
  AGENCY: 'Agency',
  CITIZEN: 'Citizen report — submitted by a reader',
  AI_ASSISTED: 'Prepared with AI assistance and reviewed by MAVY NEWS editors',
};

type FullArticle = NonNullable<Awaited<ReturnType<ArticlesService['loadFull']>>>;

@Injectable()
export class ArticlesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Articles');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly locationsSvc: LocationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Scheduler: publish SCHEDULED stories when their time arrives ----------
  onModuleInit() {
    if (config.enableScheduler) this.timer = setInterval(() => this.publishDue().catch((e) => this.log.error(e)), 30_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async publishDue() {
    const due = await this.db.update(articles).set({ status: 'PUBLISHED', publishedAt: sql`scheduled_at`, updatedAt: new Date() })
      .where(and(eq(articles.status, 'SCHEDULED'), lte(articles.scheduledAt, new Date()))).returning({ id: articles.id });
    for (const a of due) await this.audit.log({ action: 'article.auto_publish', entity: 'article', entityId: a.id });
    return due.length;
  }

  // ---------- Helpers ----------
  private async scopeIds(userId: string) {
    const rows = await this.db.select({ id: staffAssignments.locationId }).from(staffAssignments).where(eq(staffAssignments.staffId, userId));
    return rows.map((r) => r.id);
  }

  private async assertInScope(actor: AuthUser, locationPaths: string[]) {
    if (UNSCOPED_ROLES.includes(actor.role as Role)) return;
    const scope = await this.scopeIds(actor.id);
    if (!scope.length) throw new ForbiddenException('You have no assigned district yet. Ask the Super Admin to assign one.');
    if (!locationPaths.every((p) => isWithinAny(p, scope))) throw new ForbiddenException('This story includes a location outside your assigned area.');
  }

  private validateContent(translations?: TranslationDto[], heroImageUrl?: string | null, heroImageCredit?: string | null) {
    if (translations) {
      const langs = translations.map((t) => t.language);
      if (new Set(langs).size !== langs.length) throw new BadRequestException('Each language can appear only once');
      for (const t of translations)
        if (wordCount(t.summary) > 100) throw new BadRequestException(`The ${t.language === 'te' ? 'Telugu' : 'English'} summary must be 100 words or fewer`);
    }
    if (heroImageUrl && !heroImageCredit) throw new BadRequestException('Add a photo credit for the featured image (copyright requirement)');
  }

  private async assertCategory(id: string) {
    const [c] = await this.db.select().from(categories).where(eq(categories.id, id));
    if (!c || !c.active || c.isVirtual) throw new BadRequestException('Choose a valid news category');
  }

  async loadFull(id: string) {
    return this.db.query.articles.findFirst({
      where: eq(articles.id, id),
      with: {
        translations: true, tags: true,
        locations: { with: { location: true } },
        category: true,
        author: { columns: { id: true, name: true } },
      },
    });
  }

  private async require(id: string) {
    const a = await this.loadFull(id);
    if (!a) throw new NotFoundException('Story not found');
    return a;
  }

  // ---------- Newsroom ----------
  async create(dto: CreateArticleDto, actor: AuthUser, ip: string) {
    this.validateContent(dto.translations, dto.heroImageUrl, dto.heroImageCredit);
    await this.assertCategory(dto.categoryId);
    const locs = await this.locationsSvc.requireAll(dto.locationIds);
    await this.assertInScope(actor, locs.map((l) => l.path));

    const headline = dto.translations.find((t) => t.language === 'en')?.headline ?? dto.translations[0].headline;
    const id = await this.db.transaction(async (tx) => {
      const [a] = await tx.insert(articles).values({
        slug: slugify(headline),
        authorId: actor.id,
        categoryId: dto.categoryId,
        isBreaking: dto.isBreaking ?? false,
        isFeatured: dto.isFeatured ?? false,
        sourceType: dto.sourceType ?? 'STAFF',
        sourceName: dto.sourceName,
        heroImageUrl: dto.heroImageUrl,
        heroImageCredit: dto.heroImageCredit,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      }).returning({ id: articles.id });
      await tx.insert(articleTranslations).values(dto.translations.map((t) => ({ ...t, articleId: a.id })));
      await tx.insert(articleLocations).values([...new Set(dto.locationIds)].map((locationId) => ({ articleId: a.id, locationId })));
      if (dto.tags?.length) await tx.insert(articleTags).values([...new Set(dto.tags.map((t) => t.trim().toLowerCase()))].map((tag) => ({ articleId: a.id, tag })));
      await this.audit.log({ actorId: actor.id, action: 'article.create', entity: 'article', entityId: a.id, ip }, tx as unknown as Db);
      return a.id;
    });
    return this.require(id);
  }

  async update(id: string, dto: UpdateArticleDto, actor: AuthUser, ip: string) {
    const a = await this.require(id);
    if (!canEdit(a.status, actor.role as Role, a.authorId === actor.id)) throw new ForbiddenException(`This story cannot be edited by you while it is ${a.status}`);
    await this.assertInScope(actor, a.locations.map((l) => l.location.path));
    if (a.status === 'PUBLISHED' && !dto.correctionNote) throw new BadRequestException('Editing a published story needs a correctionNote');
    this.validateContent(dto.translations, dto.heroImageUrl ?? a.heroImageUrl, dto.heroImageCredit ?? a.heroImageCredit);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    if (dto.locationIds) {
      const locs = await this.locationsSvc.requireAll(dto.locationIds);
      await this.assertInScope(actor, locs.map((l) => l.path));
    }

    await this.db.transaction(async (tx) => {
      const { translations, locationIds, tags, correctionNote, scheduledAt, ...fields } = dto;
      await tx.update(articles).set({
        ...fields,
        ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}),
        updatedAt: new Date(),
      }).where(eq(articles.id, id));
      if (translations) {
        await tx.delete(articleTranslations).where(eq(articleTranslations.articleId, id));
        await tx.insert(articleTranslations).values(translations.map((t) => ({ ...t, articleId: id })));
      }
      if (locationIds) {
        await tx.delete(articleLocations).where(eq(articleLocations.articleId, id));
        await tx.insert(articleLocations).values([...new Set(locationIds)].map((locationId) => ({ articleId: id, locationId })));
      }
      if (tags) {
        await tx.delete(articleTags).where(eq(articleTags.articleId, id));
        const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
        if (clean.length) await tx.insert(articleTags).values(clean.map((tag) => ({ articleId: id, tag })));
      }
      await this.audit.log({
        actorId: actor.id, action: a.status === 'PUBLISHED' ? 'article.correction' : 'article.update', entity: 'article', entityId: id, ip,
        metadata: { status: a.status, fields: Object.keys(dto), correctionNote, previousTranslations: translations && a.status === 'PUBLISHED' ? a.translations : undefined },
      }, tx as unknown as Db);
    });
    return this.require(id);
  }

  async transition(id: string, dto: TransitionDto, actor: AuthUser, ip: string) {
    const a = await this.require(id);
    const rule = WORKFLOW[dto.action];
    if (!rule.roles.includes(actor.role as Role)) throw new ForbiddenException(`Your role cannot "${dto.action}" stories`);
    if (!rule.from.includes(a.status)) throw new BadRequestException(`Cannot "${dto.action}" a story that is ${a.status}`);
    if (rule.authorOnly && a.authorId !== actor.id) throw new ForbiddenException('Only the reporter who wrote this story can submit it');
    if (rule.noteRequired && !dto.note?.trim()) throw new BadRequestException('Please add a note explaining this decision');
    if (rule.scoped) await this.assertInScope(actor, a.locations.map((l) => l.location.path));

    let to: ArticleStatus = rule.to;
    const patch: Partial<typeof articles.$inferInsert> = { updatedAt: new Date() };
    if (dto.action === 'publish') {
      if (!a.translations.length) throw new BadRequestException('Story has no text');
      if (a.scheduledAt && a.scheduledAt > new Date()) to = 'SCHEDULED';
      else patch.publishedAt = new Date();
    }
    patch.status = to;

    // Optimistic lock: status must still be what we read, so two editors can't double-act.
    await this.db.transaction(async (tx) => {
      const res = await tx.update(articles).set(patch).where(and(eq(articles.id, id), eq(articles.status, a.status))).returning({ id: articles.id });
      if (!res.length) throw new BadRequestException('This story was just changed by someone else. Please refresh.');
      await tx.insert(articleStatusHistory).values({ articleId: id, fromStatus: a.status, toStatus: to, actorId: actor.id, note: dto.note });
      await this.audit.log({ actorId: actor.id, action: `article.${dto.action}`, entity: 'article', entityId: id, ip, metadata: { from: a.status, to, note: dto.note } }, tx as unknown as Db);
    });
    return this.require(id);
  }

  async newsroomList(q: NewsroomListQuery, actor: AuthUser) {
    const where: SQL[] = [];
    if (q.status) where.push(eq(articles.status, q.status as ArticleStatus));
    const reportersOnlySeeOwn = actor.role === 'REPORTER' || actor.role === 'VIDEO_JOURNALIST';
    if (q.mine || reportersOnlySeeOwn) where.push(eq(articles.authorId, actor.id));
    else if (!UNSCOPED_ROLES.includes(actor.role as Role)) {
      const scope = await this.scopeIds(actor.id);
      if (!scope.length) return { items: [], total: 0 };
      const likeAny = or(...scope.map((s) => sql`${locations.path} like ${'%/' + s + '/%'}`));
      where.push(inArray(articles.id, this.db.select({ id: articleLocations.articleId }).from(articleLocations)
        .innerJoin(locations, eq(locations.id, articleLocations.locationId)).where(likeAny)));
    }
    const limit = q.limit ?? 30;
    const idRows = await this.db.select({ id: articles.id }).from(articles).where(and(...where))
      .orderBy(desc(articles.updatedAt)).limit(limit).offset(q.offset ?? 0);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(articles).where(and(...where));
    const items = await this.hydrate(idRows.map((r) => r.id));
    return { items: idRows.map((r) => items.get(r.id)!), total };
  }

  async newsroomGet(id: string) {
    const a = await this.require(id);
    const history = await this.db.select().from(articleStatusHistory).where(eq(articleStatusHistory.articleId, id)).orderBy(desc(articleStatusHistory.createdAt));
    return { ...a, history };
  }

  // ---------- Public reading ----------
  async hydrate(ids: string[]) {
    const map = new Map<string, FullArticle>();
    if (!ids.length) return map;
    const rows = await this.db.query.articles.findMany({
      where: inArray(articles.id, ids),
      with: { translations: true, tags: true, locations: { with: { location: true } }, category: true, author: { columns: { id: true, name: true } } },
    });
    rows.forEach((r) => map.set(r.id, r as FullArticle));
    return map;
  }

  toCard(a: FullArticle, lang: Language, withBody = false) {
    const t = a.translations.find((x) => x.language === lang) ?? a.translations[0];
    return {
      id: a.id,
      slug: a.slug,
      language: t?.language,
      availableLanguages: a.translations.map((x) => x.language),
      headline: t?.headline,
      summary: t?.summary,
      ...(withBody ? { body: t?.body, tags: a.tags.map((x) => x.tag) } : {}),
      category: { slug: a.category.slug, nameEn: a.category.nameEn, nameTe: a.category.nameTe },
      locations: a.locations.map((l) => ({ id: l.location.id, type: l.location.type, nameEn: l.location.nameEn, nameTe: l.location.nameTe })),
      reporter: a.author?.name ?? null,
      sourceType: a.sourceType,
      sourceLabel: a.sourceName ?? SOURCE_LABELS[a.sourceType],
      isBreaking: a.isBreaking,
      isFeatured: a.isFeatured,
      likeCount: a.likeCount,
      dislikeCount: a.dislikeCount,
      commentCount: a.commentCount,
      shareCount: a.shareCount,
      heroImageUrl: a.heroImageUrl,
      heroImageCredit: a.heroImageCredit,
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
      shareUrl: `${config.publicWebUrl}/n/${a.slug}`,
    };
  }

  async publicList(q: PublicListQuery) {
    const lang = q.lang ?? 'te';
    const where: SQL[] = [];
    if (q.breaking) where.push(eq(articles.isBreaking, true));
    if (q.category) {
      const [c] = await this.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, q.category));
      if (!c) throw new NotFoundException('Category not found');
      where.push(eq(articles.categoryId, c.id));
    }
    if (q.locationId) {
      where.push(inArray(articles.id, this.db.select({ id: articleLocations.articleId }).from(articleLocations)
        .innerJoin(locations, eq(locations.id, articleLocations.locationId))
        .where(sql`${locations.path} like ${'%/' + q.locationId + '/%'}`)));
    }
    return this.page(where, q, lang);
  }

  /** Time-ordered, cursor-paginated list of published stories matching `where`. Adds liked/bookmarked flags for a logged-in reader. */
  async page(where: SQL[], q: { cursor?: string; limit?: number }, lang: Language, userId?: string) {
    const limit = q.limit ?? 20;
    where = [eq(articles.status, 'PUBLISHED'), ...where];
    const total = q.cursor ? undefined : (await this.db.select({ n: sql<number>`count(*)::int` }).from(articles).where(and(...where)))[0].n;
    if (q.cursor) {
      const [ts, cid] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      const d = new Date(ts);
      if (!cid || isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(cid)) throw new BadRequestException('Invalid cursor');
      where.push(or(lt(articles.publishedAt, d), and(eq(articles.publishedAt, d), lt(articles.id, cid)))!);
    }
    const idRows = await this.db.select({ id: articles.id, publishedAt: articles.publishedAt }).from(articles)
      .where(and(...where)).orderBy(desc(articles.publishedAt), desc(articles.id)).limit(limit);
    const map = await this.hydrate(idRows.map((r) => r.id));
    const flags = await this.flags(idRows.map((r) => r.id), userId);
    const last = idRows[idRows.length - 1];
    return {
      total,
      items: idRows.map((r) => ({ ...this.toCard(map.get(r.id)!, lang), ...flags(r.id) })),
      nextCursor: idRows.length === limit && last ? Buffer.from(`${last.publishedAt!.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  /** Returns a lookup of { liked, bookmarked } for the reader. */
  async flags(ids: string[], userId?: string) {
    if (!userId || !ids.length || userId.startsWith('guest:')) return (_: string) => ({});
    const [b, l, d] = await Promise.all([
      this.db.select({ id: bookmarks.articleId }).from(bookmarks).where(and(eq(bookmarks.userId, userId), inArray(bookmarks.articleId, ids))),
      this.db.select({ id: likes.articleId }).from(likes).where(and(eq(likes.userId, userId), inArray(likes.articleId, ids))),
      this.db.select({ id: dislikes.articleId }).from(dislikes).where(and(eq(dislikes.userId, userId), inArray(dislikes.articleId, ids))),
    ]);
    const bs = new Set(b.map((x) => x.id)), ls = new Set(l.map((x) => x.id)), ds = new Set(d.map((x) => x.id));
    return (id: string) => ({ bookmarked: bs.has(id), liked: ls.has(id), disliked: ds.has(id) });
  }

  async publicGet(slug: string, lang: Language = 'te', userId?: string) {
    const [row] = await this.db.update(articles).set({ viewCount: sql`${articles.viewCount} + 1` })
      .where(and(eq(articles.slug, slug), eq(articles.status, 'PUBLISHED'))).returning({ id: articles.id, categoryId: articles.categoryId });
    if (!row) throw new NotFoundException('Story not found');
    const a = (await this.loadFull(row.id)) as FullArticle;
    const relatedIds = await this.db.select({ id: articles.id }).from(articles)
      .where(and(eq(articles.status, 'PUBLISHED'), eq(articles.categoryId, row.categoryId), ne(articles.id, row.id)))
      .orderBy(desc(articles.publishedAt)).limit(5);
    const rel = await this.hydrate(relatedIds.map((r) => r.id));
    const f = await this.flags([a.id], userId);
    return { ...this.toCard(a, lang, true), ...f(a.id), related: relatedIds.map((r) => this.toCard(rel.get(r.id)!, lang)) };
  }
}
