/**
 * Quick convert: an editor pastes a WhatsApp press note / reporter message (and up to 4 photos), Claude writes the
 * Telugu + English post, and it is saved as "Waiting for approval" under the byline "MAVY Desk".
 *
 *   POST /admin/quick-news        multipart: text, sourceKind, sourceName, sourceUrl?, usePhoto?, photos[] (≤4)
 *   GET  /admin/quick-news/usage  today's Claude spending vs the daily limit
 *
 * Who: Super Admin, Managing Editor, and sub-admins (district editors) — for their own district / mandal only.
 * Edit / Approve / Reject use the normal newsroom endpoints, so every rule and the audit log stay the same.
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Injectable, Post, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { aliasedTable, and, eq, ilike, inArray, like, or, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import {
  articleLocations, articles, articleStatusHistory, articleTags, articleTranslations, autoNewsPosts, categories, locations,
  staffAssignments, users, Role,
} from '../db/schema';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import { slugify, wordCount } from '../common/text';
import { MAX_BYTES, processPhoto, savePublicPhoto } from '../media/media.module';
import { UNSCOPED_ROLES } from '../articles/workflow';
import { DESK_EMAIL } from '../db/seed';
import { ClaudeService, MODEL, WrittenPost, costPaise } from './claude.service';
import { isWithinAny } from '../locations/locations.module';

const SOURCE_KINDS = ['OFFICIAL', 'REPORTER', 'UNVERIFIED'] as const;

class QuickDto {
  @IsOptional() @IsString() @MaxLength(6000) text?: string;
  @IsIn(SOURCE_KINDS) sourceKind: (typeof SOURCE_KINDS)[number];
  @IsString() @MinLength(2) @MaxLength(120) sourceName: string;
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'The source link must start with https://' }) @MaxLength(500) sourceUrl?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() usePhoto?: boolean;
}

/** Keep the first `max` words (Telugu and English are both space-separated). */
function clipWords(s: string, max: number) {
  const w = s.trim().split(/\s+/);
  return w.length <= max ? s.trim() : w.slice(0, max).join(' ') + '…';
}
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);

@Injectable()
export class QuickNewsService {
  constructor(@InjectDb() private db: Db, private claude: ClaudeService, private audit: AuditService) {}

  private async scope(actor: AuthUser): Promise<string[] | null> {
    if (UNSCOPED_ROLES.includes(actor.role as Role)) return null;
    const rows = await this.db.select({ id: staffAssignments.locationId }).from(staffAssignments).where(eq(staffAssignments.staffId, actor.id));
    if (!rows.length) throw new ForbiddenException('You have no assigned district or mandal yet. Ask the Super Admin.');
    return rows.map((r) => r.id);
  }

  private async districtList() {
    const parent = aliasedTable(locations, 'parent');
    return this.db.select({ id: locations.id, nameEn: locations.nameEn, nameTe: locations.nameTe, path: locations.path, state: parent.nameEn })
      .from(locations).innerJoin(parent, eq(locations.parentId, parent.id))
      .where(eq(locations.type, 'DISTRICT')).orderBy(parent.nameEn, locations.nameEn);
  }

  /** Turn Claude's district / mandal names into our location rows. Never guesses: unknown names are reported back. */
  private async resolvePlace(p: WrittenPost, districts: Awaited<ReturnType<QuickNewsService['districtList']>>) {
    const norm = (s: string) => s.toLowerCase().replace(/\b(district|dist\.?|mandal|town|municipality|rural|urban)\b/g, '').replace(/[^a-z]/g, '');
    const notes: string[] = [];
    const d = p.district ? districts.find((x) => norm(x.nameEn) === norm(p.district!)) : undefined;
    if (p.district && !d) notes.push(`District "${p.district}" was not found in our list.`);
    if (d && p.mandal) {
      const want = norm(p.mandal);
      const rows = await this.db.select({ id: locations.id, nameEn: locations.nameEn, nameTe: locations.nameTe, path: locations.path, type: locations.type })
        .from(locations).where(and(like(locations.path, `%/${d.id}/%`), inArray(locations.type, ['MANDAL', 'MUNICIPALITY'])));
      rows.sort((x, y) => (x.type === 'MANDAL' ? 0 : 1) - (y.type === 'MANDAL' ? 0 : 1)); // a mandal also covers its town
      const m = rows.find((r) => norm(r.nameEn) === want) ?? rows.find((r) => r.nameTe === p.mandal);
      if (m) return { loc: m, label: `${m.nameEn}, ${d.nameEn} district`, notes };
      notes.push(`Mandal / town "${p.mandal}" is not in our list for ${d.nameEn}; the post is placed at district level.`);
    }
    if (d) return { loc: d, label: `${d.nameEn} district`, notes };
    const stateName = p.state === 'Telangana' ? 'Telangana' : p.state === 'Andhra Pradesh' ? 'Andhra Pradesh' : null;
    if (stateName) {
      const [st] = await this.db.select().from(locations).where(and(eq(locations.type, 'STATE'), ilike(locations.nameEn, stateName)));
      if (st) { notes.push('No district was named; the post is placed at state level.'); return { loc: st, label: st.nameEn, notes }; }
    }
    notes.push('No place was found in the material. Please set the place before approving.');
    return { loc: null, label: '', notes };
  }

  async usage() {
    const [spent, limit] = await Promise.all([this.claude.spentTodayPaise(), this.claude.limitPaise()]);
    const key = await this.claude.keyInfo();
    return { spentTodayInr: Math.round(spent) / 100, limitInr: limit / 100, keyConfigured: key.configured, model: MODEL };
  }

  async create(dto: QuickDto, files: Express.Multer.File[], actor: AuthUser, ip: string) {
    const text = clean(dto.text, 6000);
    files = files ?? [];
    if (!text && !files.length) throw new BadRequestException('Paste the message text, or add a photo of the press note.');
    if (files.length > 4) throw new BadRequestException('Up to 4 photos.');
    if (dto.usePhoto && !files.length) throw new BadRequestException('Add a photo first, or untick "use the first photo in the story".');
    if (dto.usePhoto && dto.sourceKind === 'UNVERIFIED') {
      throw new BadRequestException('Photos from unverified forwards cannot be used in the story (they may belong to someone else). Untick "use the photo".');
    }
    const scope = await this.scope(actor);
    await this.claude.assertBudget();

    const photos: Buffer[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) throw new BadRequestException('Each photo must be smaller than 10 MB.');
      photos.push(await processPhoto(f.buffer, 1280, 80));
    }
    const districts = await this.districtList();
    const base = {
      origin: 'quick', sourceKind: dto.sourceKind, sourceName: dto.sourceName.trim(), sourceUrl: dto.sourceUrl ?? null,
      inputText: text || null, photoCount: photos.length, model: MODEL, actorId: actor.id,
    };

    let result;
    try {
      result = await this.claude.write({
        text, photos, sourceKind: dto.sourceKind, sourceName: dto.sourceName.trim(),
        districts: districts.map((d) => `${d.nameEn} (${d.nameTe}) — ${d.state}`),
      });
    } catch (e: any) {
      const u = e?.usage;
      await this.db.insert(autoNewsPosts).values({ ...base, error: e?.message?.slice(0, 500) ?? 'error',
        inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0, costPaise: u ? costPaise(u.inputTokens, u.outputTokens) : 0 });
      throw e;
    }
    const p = result.post;
    const cost = costPaise(result.inputTokens, result.outputTokens);
    const money = { costInr: cost / 100, spentTodayInr: (await this.claude.spentTodayPaise() + cost) / 100 };

    if (p.not_news) {
      await this.db.insert(autoNewsPosts).values({ ...base, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costPaise: cost, notes: 'Not news — no post made' });
      return { notNews: true, ...money };
    }

    const place = await this.resolvePlace(p, districts);
    let loc = place.loc;
    if (scope) {
      if (!loc) throw new BadRequestException(`${place.notes.join(' ')} Mention the mandal or district in the text and try again.`);
      if (!isWithinAny(loc.path, scope)) throw new ForbiddenException(`This news is about ${place.label || 'another place'}, which is outside your area.`);
    }
    if (!loc) {
      // Master admin / managing editor: keep the draft at state level so nothing is lost; the page asks them to set the place.
      [loc] = await this.db.select().from(locations).where(and(eq(locations.type, 'STATE'), ilike(locations.nameEn, 'Andhra Pradesh')));
    }
    const [cat] = await this.db.select().from(categories).where(eq(categories.slug, p.category));
    const [fallback] = cat ? [cat] : await this.db.select().from(categories).where(eq(categories.slug, 'general'));
    const [desk] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, DESK_EMAIL));
    if (!desk || !fallback || !loc) throw new HttpException('MAVY Desk setup is incomplete on the server. Please restart the server.', 500);

    const te = { headline: clean(p.te_headline, 160), story: clean(p.te_story, 2000) };
    const en = { headline: clean(p.en_headline, 160), story: clean(p.en_story, 2000) };
    if (te.headline.length < 5 || en.headline.length < 5 || te.story.length < 10 || en.story.length < 10) {
      throw new HttpException('Claude returned an incomplete post. Please try again.', 502);
    }
    const sourceLine = (lang: 'te' | 'en') => (dto.sourceUrl ? `\n\n${lang === 'te' ? 'మూలం' : 'Source'}: ${dto.sourceName.trim()} — ${dto.sourceUrl}` : '');
    const notes = [p.needs_verification ? `NEEDS VERIFICATION: ${p.verification_reason || 'unverified source'}` : '',
      p.missing_info ? `Missing / unclear: ${p.missing_info}` : '', ...place.notes].filter(Boolean);

    let hero: string | null = null;
    if (dto.usePhoto && photos[0]) hero = (await savePublicPhoto(photos[0])).url;

    const articleId = await this.db.transaction(async (tx) => {
      const [a] = await tx.insert(articles).values({
        slug: slugify(en.headline), status: 'SUBMITTED', sourceType: 'AI_ASSISTED', authorId: desk.id, categoryId: fallback.id,
        sourceName: dto.sourceName.trim().slice(0, 120), heroImageUrl: hero, heroImageCredit: hero ? dto.sourceName.trim().slice(0, 120) : null,
      }).returning({ id: articles.id });
      await tx.insert(articleTranslations).values([
        { articleId: a.id, language: 'te', headline: te.headline, summary: clipWords(te.story, 100), body: te.story + sourceLine('te') },
        { articleId: a.id, language: 'en', headline: en.headline, summary: clipWords(en.story, 100), body: en.story + sourceLine('en') },
      ]);
      await tx.insert(articleLocations).values({ articleId: a.id, locationId: loc!.id });
      await tx.insert(articleTags).values([{ articleId: a.id, tag: 'mavy-desk' }, ...(p.needs_verification ? [{ articleId: a.id, tag: 'needs-verification' }] : [])]);
      await tx.insert(articleStatusHistory).values({ articleId: a.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: actor.id,
        note: [`MAVY Desk (Quick convert, Claude) — source: ${dto.sourceName.trim()}`, ...notes].join(' · ').slice(0, 1000) });
      await tx.insert(autoNewsPosts).values({ ...base, articleId: a.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        costPaise: cost, needsVerification: !!p.needs_verification, notes: notes.join(' · ').slice(0, 1000) || null });
      await this.audit.log({ actorId: actor.id, action: 'auto_news.quick_post', entity: 'article', entityId: a.id, ip, metadata: { source: dto.sourceName, kind: dto.sourceKind, costPaise: cost } }, tx as unknown as Db);
      return a.id;
    });

    return {
      notNews: false, articleId, status: 'SUBMITTED',
      te, en, category: { slug: fallback.slug, nameTe: fallback.nameTe, nameEn: fallback.nameEn },
      place: place.label || 'Andhra Pradesh — please check the place', placeFound: !!place.loc,
      needsVerification: !!p.needs_verification, verificationReason: p.verification_reason || '', missingInfo: p.missing_info || '',
      notes, heroImageUrl: hero, sourceName: dto.sourceName.trim(), ...money,
    };
  }
}

@Controller('admin/quick-news')
@Roles('SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR')
export class QuickNewsController {
  constructor(private svc: QuickNewsService) {}

  @Get('usage') usage() { return this.svc.usage(); }

  @Post() @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('photos', 4, { limits: { fileSize: 12 * 1024 * 1024, files: 4 } }))
  create(@Body() dto: QuickDto, @UploadedFiles() files: Express.Multer.File[], @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.create(dto, files, u, ip);
  }
}
