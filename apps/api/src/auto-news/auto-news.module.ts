/**
 * Auto News — Step 1: settings and the list of sources (master admin only).
 *
 *   GET    /admin/auto-news                    settings + sources + whether the Claude key is set on the server
 *   PATCH  /admin/auto-news/settings           { enabled?, testMode?, intervalMinutes?, dailyCostLimitUsd? }
 *   POST   /admin/auto-news/sources            { name, url, kind, note?, photosAllowed? }
 *   PATCH  /admin/auto-news/sources/:id        { name?, enabled?, autoPublish?, photosAllowed?, note? }
 *   DELETE /admin/auto-news/sources/:id
 *
 * Safety rules enforced here (not only in the page):
 *  - Other news channels / apps (Eenadu, Sakshi, TV9, Way2News …) can only be "tip only" sources:
 *    headline + link for the admin, never rewritten automatically, never their photos.
 *  - "Publish without approval" is allowed only for official alerts (IMD, APSDMA …) and is OFF by default.
 *  - Photos may be used only from government sources.
 *  - The Claude API key lives only in the server's environment (ANTHROPIC_API_KEY). It is never sent to any page or app;
 *    this API only says whether it is set.
 * Every change is written to the audit log.
 */
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';
import { asc, eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { autoNewsSettings, autoNewsSources } from '../db/schema';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';

export const SOURCE_KINDS = ['PRESS_RELEASE', 'OFFICIAL_ALERT', 'RSS', 'TIP_ONLY'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Other news outlets: tip only. Their stories and photos are never copied. */
const NEWS_OUTLETS = [
  'eenadu.net', 'sakshi.com', 'sakshieducation.com', 'tv9telugu.com', 'tv9.com', 'way2news.com', 'andhrajyothy.com',
  'abnandhrajyothy.com', 'ntnews.com', 'ntvtelugu.com', '10tv.in', 'v6velugu.com', 'tv5news.in', 'manalokam.com',
  'telugu.oneindia.com', 'telugu.samayam.com', 'telugu.news18.com', 'telugu.hindustantimes.com', 'bbc.com',
  'thehindu.com', 'deccanchronicle.com', 'newindianexpress.com', 'timesofindia.indiatimes.com', 'telanganatoday.com',
  'hansindia.com', 'greatandhra.com', 'mahaanews.com', 'disha.news', 'prajasakti.com', 'andhraprabha.com',
  'publicvibe.com', 'lokal.app', 'dailyhunt.in', 'news.google.com',
];
export function isNewsOutlet(url: string): boolean {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
  return NEWS_OUTLETS.some((d) => host === d || host.endsWith('.' + d));
}
/** Government website (Indian state / central government domains). */
export function isGovernmentSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.gov.in') || host.endsWith('.nic.in') || host === 'gov.in' || host === 'nic.in';
  } catch { return false; }
}

class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() testMode?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([15, 30, 60, 120, 180, 360], { message: 'Choose 15, 30, 60, 120, 180 or 360 minutes' }) intervalMinutes?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) dailyCostLimitUsd?: number;
}
class NewSourceDto {
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'Paste the full address, starting with https://' }) @MaxLength(500) url: string;
  @IsIn(SOURCE_KINDS) kind: SourceKind;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsBoolean() photosAllowed?: boolean;
}
class EditSourceDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() autoPublish?: boolean;
  @IsOptional() @IsBoolean() photosAllowed?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

type SourceRow = typeof autoNewsSources.$inferSelect;

@Injectable()
export class AutoNewsService {
  constructor(@InjectDb() private db: Db, private audit: AuditService) {}

  async settings() {
    const [row] = await this.db.select().from(autoNewsSettings).where(eq(autoNewsSettings.id, 1));
    if (row) return row;
    const [created] = await this.db.insert(autoNewsSettings).values({ id: 1 }).onConflictDoNothing().returning();
    return created ?? (await this.db.select().from(autoNewsSettings).where(eq(autoNewsSettings.id, 1)))[0];
  }
  sources() { return this.db.select().from(autoNewsSources).orderBy(asc(autoNewsSources.createdAt)); }
  keyConfigured() { return !!(process.env.ANTHROPIC_API_KEY || '').trim(); }

  view(s: Awaited<ReturnType<AutoNewsService['settings']>>) {
    return {
      enabled: s.enabled, testMode: s.testMode, intervalMinutes: s.intervalMinutes,
      dailyCostLimitUsd: s.dailyCostLimitCents / 100, updatedAt: s.updatedAt,
    };
  }
  sourceView(r: SourceRow) {
    return {
      id: r.id, name: r.name, url: r.url, kind: r.kind, enabled: r.enabled, autoPublish: r.autoPublish,
      photosAllowed: r.photosAllowed, note: r.note, lastCheckedAt: r.lastCheckedAt, lastError: r.lastError,
      isGovernment: isGovernmentSite(r.url), createdAt: r.createdAt,
    };
  }

  async overview() {
    const [s, src] = await Promise.all([this.settings(), this.sources()]);
    return { settings: this.view(s), sources: src.map((r) => this.sourceView(r)), keyConfigured: this.keyConfigured() };
  }

  async updateSettings(dto: SettingsDto, user: AuthUser, ip?: string) {
    const before = await this.settings();
    const patch: Partial<typeof autoNewsSettings.$inferInsert> = { updatedBy: user.id, updatedAt: new Date() };
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.testMode !== undefined) patch.testMode = dto.testMode;
    if (dto.intervalMinutes !== undefined) patch.intervalMinutes = dto.intervalMinutes;
    if (dto.dailyCostLimitUsd !== undefined) patch.dailyCostLimitCents = Math.round(dto.dailyCostLimitUsd * 100);
    const [row] = await this.db.update(autoNewsSettings).set(patch).where(eq(autoNewsSettings.id, 1)).returning();
    await this.audit.log({
      actorId: user.id, action: 'auto_news.settings', entity: 'auto_news_settings', entityId: '1', ip,
      metadata: { before: this.view(before), after: this.view(row) },
    });
    return this.view(row);
  }

  /** Apply the safety rules to a source; returns the corrected values and a list of what was changed, in plain words. */
  private rules(url: string, kind: SourceKind, autoPublish: boolean, photosAllowed: boolean) {
    const notes: string[] = [];
    if (isNewsOutlet(url) && kind !== 'TIP_ONLY') {
      kind = 'TIP_ONLY';
      notes.push('This is another news outlet, so it is saved as "tip only" (headline + link for the admin; never copied).');
    }
    if (autoPublish && kind !== 'OFFICIAL_ALERT') {
      throw new BadRequestException('"Publish without approval" is allowed only for official alerts such as IMD weather warnings or APSDMA.');
    }
    if (autoPublish && !isGovernmentSite(url)) {
      throw new BadRequestException('"Publish without approval" is allowed only for government websites (.gov.in or .nic.in).');
    }
    if (photosAllowed && !isGovernmentSite(url)) {
      throw new BadRequestException('Photos can be used only from government websites (.gov.in or .nic.in).');
    }
    if (kind === 'TIP_ONLY') { autoPublish = false; photosAllowed = false; }
    return { kind, autoPublish, photosAllowed, notes };
  }

  async addSource(dto: NewSourceDto, user: AuthUser, ip?: string) {
    const url = dto.url.trim();
    const r = this.rules(url, dto.kind, false, dto.photosAllowed ?? false);
    const [row] = await this.db.insert(autoNewsSources).values({
      name: dto.name.trim(), url, kind: r.kind, photosAllowed: r.photosAllowed, note: dto.note?.trim() || null, createdBy: user.id,
    }).onConflictDoNothing().returning();
    if (!row) throw new ConflictException('This address is already in the list.');
    await this.audit.log({ actorId: user.id, action: 'auto_news.source_add', entity: 'auto_news_source', entityId: row.id, ip, metadata: { name: row.name, url: row.url, kind: row.kind } });
    return { source: this.sourceView(row), notes: r.notes };
  }

  async editSource(id: string, dto: EditSourceDto, user: AuthUser, ip?: string) {
    const [cur] = await this.db.select().from(autoNewsSources).where(eq(autoNewsSources.id, id));
    if (!cur) throw new NotFoundException('Source not found');
    const r = this.rules(cur.url, cur.kind, dto.autoPublish ?? cur.autoPublish, dto.photosAllowed ?? cur.photosAllowed);
    const [row] = await this.db.update(autoNewsSources).set({
      name: dto.name?.trim() ?? cur.name,
      enabled: dto.enabled ?? cur.enabled,
      autoPublish: r.autoPublish,
      photosAllowed: r.photosAllowed,
      note: dto.note !== undefined ? (dto.note.trim() || null) : cur.note,
    }).where(eq(autoNewsSources.id, id)).returning();
    await this.audit.log({
      actorId: user.id, action: 'auto_news.source_edit', entity: 'auto_news_source', entityId: id, ip,
      metadata: { before: this.sourceView(cur), after: this.sourceView(row) },
    });
    return { source: this.sourceView(row), notes: r.notes };
  }

  async removeSource(id: string, user: AuthUser, ip?: string) {
    const [row] = await this.db.delete(autoNewsSources).where(eq(autoNewsSources.id, id)).returning();
    if (!row) throw new NotFoundException('Source not found');
    await this.audit.log({ actorId: user.id, action: 'auto_news.source_remove', entity: 'auto_news_source', entityId: id, ip, metadata: { name: row.name, url: row.url } });
  }
}

@Controller('admin/auto-news')
@Roles('SUPER_ADMIN')
export class AutoNewsController {
  constructor(private svc: AutoNewsService) {}

  @Get() overview() { return this.svc.overview(); }

  @Patch('settings')
  settings(@Body() dto: SettingsDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string) { return this.svc.updateSettings(dto, user, ip); }

  @Post('sources')
  add(@Body() dto: NewSourceDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string) { return this.svc.addSource(dto, user, ip); }

  @Patch('sources/:id')
  edit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EditSourceDto, @CurrentUser() user: AuthUser, @ClientIp() ip: string) {
    return this.svc.editSource(id, dto, user, ip);
  }

  @Delete('sources/:id') @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string) { return this.svc.removeSource(id, user, ip); }
}

@Module({ controllers: [AutoNewsController], providers: [AutoNewsService], exports: [AutoNewsService] })
export class AutoNewsModule {}
