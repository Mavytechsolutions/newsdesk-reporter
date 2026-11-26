/**
 * Auto News — Step 2 runner: checks the enabled sources on a timer (only while Auto News is ON),
 * or straight away when the admin presses "Check now". Writes one log row per source per check.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { autoNewsItems, autoNewsRuns, autoNewsSettings, autoNewsSources } from '../db/schema';
import {
  AlertInfo, MAX_AGE_MS, SourceError, checkRobots, fingerprint, isOurRegion, parseCap, parseFeed, safeFetch,
} from './collector';

type Source = typeof autoNewsSources.$inferSelect;
const MAX_NEW_PER_SOURCE = 60;
const MAX_ALERT_DETAILS_PER_RUN = 150;
const LOCK_KEY = 74_610_001;

export interface RunSummary { sourceId: string; sourceName: string; found: number; added: number; duplicates: number; skipped: number; error: string | null }

@Injectable()
export class AutoNewsRunner implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('AutoNews');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@InjectDb() private db: Db) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.AUTO_NEWS_SCHEDULER === 'off') return;
    this.timer = setInterval(() => { this.tick().catch((e) => this.log.error(`tick failed: ${e?.message}`)); }, 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Every minute: if Auto News is ON and the chosen interval has passed since the last scheduled check, check all sources. */
  async tick() {
    const [s] = await this.db.select().from(autoNewsSettings).where(eq(autoNewsSettings.id, 1));
    if (!s?.enabled) return;
    const [last] = await this.db.select({ at: autoNewsRuns.startedAt }).from(autoNewsRuns)
      .where(eq(autoNewsRuns.trigger, 'schedule')).orderBy(desc(autoNewsRuns.startedAt)).limit(1);
    if (last && Date.now() - last.at.getTime() < s.intervalMinutes * 60_000 - 30_000) return;
    await this.runAll('schedule');
  }

  isRunning() { return this.running; }

  /** Check every enabled source (or one source). Only one check runs at a time. */
  async runAll(trigger: 'schedule' | 'manual', onlySourceId?: string): Promise<RunSummary[] | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const lock = await this.db.execute(sql`select pg_try_advisory_lock(${LOCK_KEY}) as ok`);
      if (!(lock as any).rows?.[0]?.ok) return null;
      try {
        const where = onlySourceId ? eq(autoNewsSources.id, onlySourceId) : eq(autoNewsSources.enabled, true);
        const sources = await this.db.select().from(autoNewsSources).where(where);
        const out: RunSummary[] = [];
        for (const src of sources) out.push(await this.runSource(src, trigger));
        return out;
      } finally {
        await this.db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`);
      }
    } finally { this.running = false; }
  }

  private async runSource(src: Source, trigger: string): Promise<RunSummary> {
    const [run] = await this.db.insert(autoNewsRuns).values({ sourceId: src.id, sourceName: src.name, trigger }).returning();
    const sum: RunSummary = { sourceId: src.id, sourceName: src.name, found: 0, added: 0, duplicates: 0, skipped: 0, error: null };
    try {
      await checkRobots(src.url);
      const res = await safeFetch(src.url);
      if (res.status === 403 || res.status === 401) throw new SourceError(`The website refused to let us read it (error ${res.status}).`);
      if (res.status >= 400) throw new SourceError(`The website answered with an error (${res.status}).`);
      const items = parseFeed(res.text);
      sum.found = items.length;
      let alertFetches = 0;
      const since = Date.now() - MAX_AGE_MS;
      for (const it of items) {
        if (sum.added + sum.duplicates >= MAX_NEW_PER_SOURCE) break;
        if (!it.title || !it.link) { sum.skipped++; continue; }
        if (it.published && it.published.getTime() < since) { sum.skipped++; continue; }
        let link: string;
        try { link = new URL(it.link, res.url).toString(); } catch { sum.skipped++; continue; }
        if (!/^https?:/.test(link)) { sum.skipped++; continue; }
        const externalId = (it.id || link).slice(0, 500);

        const [seen] = await this.db.select({ id: autoNewsItems.id }).from(autoNewsItems)
          .where(and(eq(autoNewsItems.sourceId, src.id), eq(autoNewsItems.externalId, externalId))).limit(1);
        if (seen) continue; // already collected earlier: not new

        let details: AlertInfo | null = null;
        let title = it.title;
        let area = '';
        let language: string | null = /[ఀ-౿]/.test(it.title) ? 'te' : 'en';
        if (src.kind === 'OFFICIAL_ALERT') {
          if (!isOurRegion(it.author, it.title, it.summary)) { sum.skipped++; continue; }
          if (it.published && it.published.getTime() < Date.now() - 24 * 3600_000) { sum.skipped++; continue; } // alerts older than a day have expired
          if (alertFetches < MAX_ALERT_DETAILS_PER_RUN) {
            alertFetches++;
            try {
              await checkRobots(link);
              const capRes = await safeFetch(link, 'application/xml, text/xml, */*;q=0.5');
              if (capRes.status < 400) details = parseCap(capRes.text);
            } catch { /* details are optional */ }
          }
          // Without the alert's details we don't know the place or the expiry time: don't save it now, try again next check.
          if (!details) { sum.skipped++; continue; }
          if (!details.expires || new Date(details.expires).getTime() < Date.now()) { sum.skipped++; continue; }
          title = details.headlineEn || title;
          area = details.area;
          language = 'en';
        }

        const tip = src.kind === 'TIP_ONLY';
        const fp = fingerprint(details ? `${details.event} ${details.headlineEn}` : title, area);
        const [dup] = await this.db.select({ id: autoNewsItems.id }).from(autoNewsItems)
          .where(and(eq(autoNewsItems.fingerprint, fp), gte(autoNewsItems.createdAt, new Date(since)),
            inArray(autoNewsItems.status, ['NEW', 'TIP'])))
          .orderBy(autoNewsItems.createdAt).limit(1);
        const [row] = await this.db.insert(autoNewsItems).values({
          sourceId: src.id, sourceName: src.name, externalId, url: link.slice(0, 1000), title: title.slice(0, 500),
          summary: tip ? null : (it.summary || null),
          details: tip ? null : (details as any),
          area: area || null, language, publishedAt: it.published ?? (details?.sent ? new Date(details.sent) : null),
          fingerprint: fp,
          status: dup ? 'DUPLICATE' : tip ? 'TIP' : 'NEW',
          duplicateOf: dup?.id ?? null,
        }).onConflictDoNothing().returning({ id: autoNewsItems.id });
        if (!row) continue;
        if (dup) sum.duplicates++; else sum.added++;
      }
    } catch (e: any) {
      sum.error = e instanceof SourceError ? e.message : `Unexpected problem: ${e?.message ?? e}`;
      if (!(e instanceof SourceError)) this.log.error(`source ${src.name}: ${e?.stack ?? e}`);
    }
    await this.db.update(autoNewsRuns).set({
      found: sum.found, added: sum.added, duplicates: sum.duplicates, skipped: sum.skipped, error: sum.error, finishedAt: new Date(),
    }).where(eq(autoNewsRuns.id, run.id));
    await this.db.update(autoNewsSources).set({ lastCheckedAt: new Date(), lastError: sum.error }).where(eq(autoNewsSources.id, src.id));
    return sum;
  }
}
