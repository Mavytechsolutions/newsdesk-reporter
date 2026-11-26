/**
 * Claude for MAVY NEWS: the API key (kept only on the server) and the "write a MAVY post" call.
 *
 * Where the key lives:
 *  - If the server environment has ANTHROPIC_API_KEY, that is used.
 *  - Otherwise the master admin can save it from the admin page. It is stored encrypted (AES-256-GCM) with a key made
 *    from the server's own secret, is never sent back to any page or the app (only its last 4 characters are shown),
 *    and every save / removal is audit-logged.
 *
 * Cost: every call is recorded in rupees. Before each call we check today's total against the daily limit.
 */
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { autoNewsPosts, autoNewsSecrets, autoNewsSettings } from '../db/schema';
import { config } from '../config';
import { AuditService } from '../audit/audit.module';

const API = () => process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
export const MODEL = process.env.AUTO_NEWS_MODEL || 'claude-sonnet-5-5';
/** US$ per million tokens for MODEL (Claude Sonnet 5.5: $2 input, $10 output). */
const PRICE_IN = Number(process.env.AUTO_NEWS_PRICE_IN || 2);
const PRICE_OUT = Number(process.env.AUTO_NEWS_PRICE_OUT || 10);
/** Rupees per US$. Set a little high on purpose so the daily limit is never crossed. */
export const USD_INR = Number(process.env.AUTO_NEWS_USD_INR || 90);
const KEY_NAME = 'anthropic_api_key';

export const CATEGORY_SLUGS = ['politics', 'crime', 'health', 'agriculture', 'education', 'weather', 'jobs', 'sports', 'general'] as const;

export function costPaise(inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;
  return Math.ceil(usd * USD_INR * 100);
}
export function startOfTodayIST(): Date {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000);
}

export interface WriteInput {
  text: string;
  photos: Buffer[]; // JPEG, already resized
  sourceKind: 'OFFICIAL' | 'REPORTER' | 'UNVERIFIED' | 'ALERT';
  sourceName: string;
  districts: string[]; // "Anantapur (అనంతపురం) — Andhra Pradesh"
}
export interface WrittenPost {
  te_headline: string; te_story: string; en_headline: string; en_story: string;
  category: (typeof CATEGORY_SLUGS)[number];
  state: 'Andhra Pradesh' | 'Telangana' | 'Other' | 'Unknown';
  district: string | null; mandal: string | null;
  needs_verification: boolean; verification_reason: string; missing_info: string;
  not_news: boolean;
}
export interface ClaudeResult { post: WrittenPost; inputTokens: number; outputTokens: number }

const SYSTEM = `You are the desk editor of MAVY NEWS, a hyperlocal Telugu/English news service for Andhra Pradesh and Telangana (focus: Anantapur and Sri Sathya Sai districts).
You turn the material you are given (a press note, a reporter's message, an official alert, or photos of them) into one short news post, by calling the write_post tool.

STRICT RULES
1. Use ONLY facts stated in the material. Never add facts, numbers, names, dates, places, quotes, background, opinions, praise, criticism or guesses. If something is unclear, leave it out and mention it in missing_info.
2. Neutral, factual tone. No adjectives of praise or blame, no political slant, no sensational words. Report claims as claims ("…said", "…అని తెలిపారు").
3. Telugu story about 60 words, English story about 60 words (50–75). Headlines: Telugu up to 12 words, English up to 12 words. Simple, clear language people in Anantapur speak; standard Telugu script, no English words in Telugu unless they are names or common terms (e.g. "కలెక్టర్").
4. Both versions must say the same facts. Lead with what happened, where and when.
5. Never name or identify a victim of rape or sexual assault, or a child (under 18) who is a victim, witness or accused — not even by village, school or relatives. Do not include private phone numbers, Aadhaar or bank details. Official helpline numbers in an official note are fine.
6. Do not repeat caste or religion of people in crime stories unless an official note states it as essential.
7. needs_verification = true if the material is an unverified forward, a rumour, a claim about a crime or a person without an official source, a copy of another outlet's story, or if the photos may not match the text. Say why in verification_reason (short English).
8. not_news = true if it is not news (greetings, ads, personal chat, spam). Then write very short placeholders.
9. category: one of ${CATEGORY_SLUGS.join(', ')}. Weather = weather/disaster alerts. Jobs = recruitment/exams/results. General = anything else.
10. Place: choose the district ONLY from the list given, exactly as written before the brackets, and only if the material names it or a mandal/town inside it. mandal = the mandal or town name as written in English, or null. state = "Andhra Pradesh", "Telangana", "Other" or "Unknown".
Do not write the source line; the system adds it.`;

const TOOL = {
  name: 'write_post',
  description: 'Save the MAVY NEWS post written from the material.',
  input_schema: {
    type: 'object',
    properties: {
      te_headline: { type: 'string', description: 'Telugu headline, up to 12 words' },
      te_story: { type: 'string', description: 'Telugu story, about 60 words' },
      en_headline: { type: 'string', description: 'English headline, up to 12 words' },
      en_story: { type: 'string', description: 'English story, about 60 words' },
      category: { type: 'string', enum: [...CATEGORY_SLUGS] },
      state: { type: 'string', enum: ['Andhra Pradesh', 'Telangana', 'Other', 'Unknown'] },
      district: { type: ['string', 'null'], description: 'Exactly one district name from the list, or null' },
      mandal: { type: ['string', 'null'], description: 'Mandal or town name in English as in the material, or null' },
      needs_verification: { type: 'boolean' },
      verification_reason: { type: 'string', description: 'Why it needs checking; empty if not' },
      missing_info: { type: 'string', description: 'Important facts that are unclear or missing; empty if none' },
      not_news: { type: 'boolean' },
    },
    required: ['te_headline', 'te_story', 'en_headline', 'en_story', 'category', 'state', 'district', 'mandal', 'needs_verification', 'verification_reason', 'missing_info', 'not_news'],
  },
};

@Injectable()
export class ClaudeService {
  private log = new Logger('Claude');
  constructor(@InjectDb() private db: Db, private audit: AuditService) {}

  // ---------- the key ----------
  private cryptoKey() { return createHash('sha256').update(`mavy-auto-news|${config.jwtAccessSecret}`).digest(); }

  async keyInfo(): Promise<{ configured: boolean; where: 'server' | 'saved' | null; last4: string | null; updatedAt: Date | null }> {
    const env = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (env) return { configured: true, where: 'server', last4: env.slice(-4), updatedAt: null };
    const [row] = await this.db.select().from(autoNewsSecrets).where(eq(autoNewsSecrets.name, KEY_NAME));
    return row ? { configured: true, where: 'saved', last4: row.last4, updatedAt: row.updatedAt } : { configured: false, where: null, last4: null, updatedAt: null };
  }

  private async apiKey(): Promise<string | null> {
    const env = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (env) return env;
    const [row] = await this.db.select().from(autoNewsSecrets).where(eq(autoNewsSecrets.name, KEY_NAME));
    if (!row) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', this.cryptoKey(), Buffer.from(row.iv, 'base64'));
      d.setAuthTag(Buffer.from(row.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(row.ciphertext, 'base64')), d.final()]).toString('utf8');
    } catch {
      this.log.error('Saved Claude key could not be read (server secret changed?). Please save it again.');
      return null;
    }
  }

  /** Check a key with Anthropic (listing models is free), then save it encrypted. */
  async saveKey(key: string, actorId: string, ip?: string) {
    key = key.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new BadRequestException('This does not look like a Claude API key. It starts with "sk-ant-". Copy it again from platform.claude.com → API Keys.');
    const ok = await this.testKey(key);
    if (ok === 'invalid') throw new BadRequestException('Claude says this key is not valid. Create a new key at platform.claude.com → API Keys and paste it again.');
    if (ok === 'unreachable') throw new HttpException('Could not reach Claude to check the key. Please try again in a minute.', HttpStatus.SERVICE_UNAVAILABLE);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cryptoKey(), iv);
    const ct = Buffer.concat([c.update(key, 'utf8'), c.final()]);
    const row = { name: KEY_NAME, ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), last4: key.slice(-4), updatedBy: actorId, updatedAt: new Date() };
    await this.db.insert(autoNewsSecrets).values(row).onConflictDoUpdate({ target: autoNewsSecrets.name, set: row });
    await this.audit.log({ actorId, action: 'auto_news.api_key_saved', entity: 'auto_news_secret', entityId: KEY_NAME, ip, metadata: { last4: row.last4 } });
    return this.keyInfo();
  }
  async removeKey(actorId: string, ip?: string) {
    await this.db.delete(autoNewsSecrets).where(eq(autoNewsSecrets.name, KEY_NAME));
    await this.audit.log({ actorId, action: 'auto_news.api_key_removed', entity: 'auto_news_secret', entityId: KEY_NAME, ip });
    return this.keyInfo();
  }

  /** 'ok' | 'invalid' | 'unreachable' */
  async testKey(key: string): Promise<'ok' | 'invalid' | 'unreachable'> {
    try {
      const r = await fetch(`${API()}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return 'ok';
      if (r.status === 401 || r.status === 403) return 'invalid';
      return 'unreachable';
    } catch { return 'unreachable'; }
  }

  // ---------- money ----------
  async spentTodayPaise(): Promise<number> {
    const [r] = await this.db.select({ p: sql<number>`coalesce(sum(${autoNewsPosts.costPaise}), 0)::int` }).from(autoNewsPosts)
      .where(gte(autoNewsPosts.createdAt, startOfTodayIST()));
    return r?.p ?? 0;
  }
  async limitPaise(): Promise<number> {
    const [s] = await this.db.select({ inr: autoNewsSettings.dailyCostLimitInr }).from(autoNewsSettings).where(eq(autoNewsSettings.id, 1));
    return (s?.inr ?? 100) * 100;
  }
  /** Throws if today's limit is used up. */
  async assertBudget() {
    const [spent, limit] = await Promise.all([this.spentTodayPaise(), this.limitPaise()]);
    if (spent >= limit) {
      throw new HttpException(`Today's Claude limit (₹${limit / 100}) is used up (spent about ₹${(spent / 100).toFixed(2)}). It starts again after midnight, or raise the limit in Auto News settings.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // ---------- writing ----------
  async write(input: WriteInput): Promise<ClaudeResult> {
    const key = await this.apiKey();
    if (!key) throw new HttpException('The Claude API key is not set yet. The master admin can add it in Auto News settings.', HttpStatus.SERVICE_UNAVAILABLE);
    const kind = {
      OFFICIAL: 'an OFFICIAL press note / statement from a government office, police or other authority',
      REPORTER: 'a message from our own MAVY NEWS reporter',
      UNVERIFIED: 'an UNVERIFIED forward from a WhatsApp group — treat every claim with care and set needs_verification = true',
      ALERT: 'an OFFICIAL disaster / weather alert (APSDMA / IMD)',
    }[input.sourceKind];
    const content: any[] = input.photos.map((p) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.toString('base64') } }));
    content.push({
      type: 'text',
      text: `Material type: ${kind}.\nSource name: ${input.sourceName}\n${input.photos.length ? `${input.photos.length} photo(s) attached above — read any printed text in them (press notes are often photos), but describe only what the text states.\n` : ''}`
        + `\nDistricts you may choose from:\n${input.districts.join('\n')}\n\n<material>\n${input.text || '(no text — see the photos)'}\n</material>`,
    });
    let res: Response;
    try {
      res = await fetch(`${API()}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1500, system: SYSTEM,
          tools: [TOOL], tool_choice: { type: 'tool', name: 'write_post' },
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new HttpException('Could not reach Claude. Please try again in a minute.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
      const m = data?.error?.message || `error ${res.status}`;
      this.log.warn(`Claude ${res.status}: ${m}`);
      if (res.status === 401) throw new HttpException('Claude says the API key is not valid any more. Save a new key in Auto News settings.', HttpStatus.SERVICE_UNAVAILABLE);
      if (res.status === 429 || res.status === 529) throw new HttpException('Claude is busy right now. Please try again in a minute.', HttpStatus.SERVICE_UNAVAILABLE);
      if (/credit|balance|billing/i.test(m)) throw new HttpException('The Claude account has no credit left. Add credit at platform.claude.com → Billing.', HttpStatus.SERVICE_UNAVAILABLE);
      throw new HttpException(`Claude could not write this post (${m}).`, HttpStatus.BAD_GATEWAY);
    }
    const tool = (data?.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'write_post');
    const inputTokens = Number(data?.usage?.input_tokens ?? 0) + Number(data?.usage?.cache_creation_input_tokens ?? 0) + Number(data?.usage?.cache_read_input_tokens ?? 0);
    const outputTokens = Number(data?.usage?.output_tokens ?? 0);
    if (!tool?.input) throw Object.assign(new HttpException('Claude did not return a post. Please try again.', HttpStatus.BAD_GATEWAY), { usage: { inputTokens, outputTokens } });
    return { post: tool.input as WrittenPost, inputTokens, outputTokens };
  }
}
