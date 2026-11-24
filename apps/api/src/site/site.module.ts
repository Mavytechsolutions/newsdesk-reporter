/**
 * The public MAVY NEWS website (www.mavynews.com). Server-rendered HTML: fast on slow phones, readable by Google,
 * and always showing the same published news as the app.
 *
 *   /                 today's news (+ earlier news, with "older" paging)
 *   /c/<category>     a section, e.g. /c/politics, /c/breaking
 *   /d/<place slug>   a district / mandal / town, e.g. /d/dist-anantapur
 *   /find?q=          search
 *   /n/<story slug>   one story (WhatsApp / Facebook previews, Google NewsArticle data)
 *   /about /privacy /grievance
 *   /robots.txt /sitemap.xml /news-sitemap.xml
 * Language: ?lang=te|en (remembered in a cookie). Telugu by default.
 */
import { Controller, Get, Injectable, Module, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { and, desc, eq, gte, isNotNull, lt, sql, SQL } from 'drizzle-orm';
import path from 'path';
import { existsSync } from 'fs';
import { Db, InjectDb } from '../db/db.module';
import { articles, articleLocations, categories, locations, users } from '../db/schema';
import { Public } from '../common/auth.decorators';
import { config } from '../config';
import { ArticlesModule } from '../articles/articles.module';
import { ArticlesService } from '../articles/articles.service';
import { FeedModule, FeedService } from '../articles/feed.module';

type Lang = 'te' | 'en';
type Card = ReturnType<ArticlesService['toCard']> & { body?: string };

const SITE_DIR = path.join(process.cwd(), 'public', 'site');
const SITE_FILES: Record<string, string> = {
  'site.css': 'text/css', 'site.js': 'text/javascript', 'anek-telugu.woff2': 'font/woff2', 'anek-latin.woff2': 'font/woff2',
  'icon-192.png': 'image/png', 'icon-512.png': 'image/png', 'apple-touch-icon.png': 'image/png', 'favicon.png': 'image/png',
  'OFL-anek-telugu.txt': 'text/plain',
};
const CAT_COLORS: Record<string, string> = {
  'andhra-pradesh': '#0E7490', telangana: '#BE185D', national: '#EA580C', international: '#4338CA', politics: '#B45309',
  crime: '#DC2626', business: '#0F766E', technology: '#7C3AED', sports: '#2563EB', entertainment: '#DB2777',
  health: '#059669', education: '#9333EA', agriculture: '#4D7C0F', local: '#16A34A',
};
/** CSS class carrying the section colour (colours live in site.css: no inline styles, strict CSP). */
const catCls = (slug?: string) => (slug && CAT_COLORS[slug] ? `c-${slug}` : 'c-default');
const HOME_DISTRICTS = ['dist-anantapur', 'dist-sri-sathya-sai'];
const LEVEL: Record<string, [string, string]> = { JUNIOR: ['జూనియర్ జర్నలిస్ట్', 'Junior Journalist'], JOURNALIST: ['జర్నలిస్ట్', 'Journalist'], SENIOR: ['సీనియర్ జర్నలిస్ట్', 'Senior Journalist'] };

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Our own photos are linked by path, so they work on any address (http IP today, https domain tomorrow). */
const media = (url?: string | null) => {
  if (!url) return null;
  const m = /\/media\/([a-f0-9]{32}\.jpg)$/.exec(url);
  return m ? `/media/${m[1]}` : url;
};
const absolute = (p: string) => `${config.publicWebUrl}${p}`;

/** Midnight today in India, as a Date. */
function startOfTodayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
}
const fmtDate = (d: Date, lang: Lang) =>
  d.toLocaleDateString(lang === 'te' ? 'te-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
function ago(iso: Date | string | null, lang: Lang) {
  if (!iso) return '';
  const d = new Date(iso);
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 1) return lang === 'te' ? 'ఇప్పుడే' : 'just now';
  if (m < 60) return lang === 'te' ? `${m} నిమిషాల క్రితం` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return lang === 'te' ? `${h} గంటల క్రితం` : `${h} hr ago`;
  return d.toLocaleString(lang === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

@Injectable()
export class SiteService {
  constructor(@InjectDb() private readonly db: Db, private readonly arts: ArticlesService, private readonly feed: FeedService) {}

  categories() {
    return this.db.select().from(categories).where(eq(categories.active, true)).orderBy(categories.sortOrder);
  }

  async districts() {
    const states = await this.db.select().from(locations).where(eq(locations.type, 'STATE')).orderBy(locations.nameEn);
    const ds = await this.db.select().from(locations).where(eq(locations.type, 'DISTRICT')).orderBy(locations.nameEn);
    return states.map((s) => ({ state: s, districts: ds.filter((d) => d.parentId === s.id) }));
  }

  leaderboard() {
    return this.db.select({ name: users.name, level: users.contributorLevel, points: users.points }).from(users)
      .where(and(isNotNull(users.contributorLevel), sql`${users.contributorSuspendedAt} is null`, eq(users.status, 'ACTIVE'), sql`${users.points} > 0`))
      .orderBy(desc(users.points)).limit(5);
  }

  breaking(lang: Lang) {
    return this.arts.page([eq(articles.isBreaking, true), gte(articles.publishedAt, new Date(Date.now() - 24 * 3600_000))], { limit: 8 }, lang);
  }
  latest(lang: Lang) { return this.arts.page([], { limit: 8 }, lang); }
  today(lang: Lang) { return this.arts.page([gte(articles.publishedAt, startOfTodayIST())], { limit: 50 }, lang); }
  before(lang: Lang, cursor?: string) {
    return this.arts.page(cursor ? [] : [lt(articles.publishedAt, startOfTodayIST())], { limit: 20, cursor }, lang);
  }
  async category(slug: string, lang: Lang, cursor?: string) {
    const [c] = await this.db.select().from(categories).where(eq(categories.slug, slug));
    if (!c || !c.active) throw new NotFoundException();
    if (slug === 'breaking') return { c, page: await this.arts.page([eq(articles.isBreaking, true)], { limit: 20, cursor }, lang) };
    if (c.isVirtual) throw new NotFoundException();
    return { c, page: await this.arts.page([eq(articles.categoryId, c.id)], { limit: 20, cursor }, lang) };
  }
  async place(slug: string, lang: Lang, cursor?: string) {
    const [l] = await this.db.select().from(locations).where(eq(locations.slug, slug));
    if (!l) throw new NotFoundException();
    const inPlace = sql`${articles.id} in (select ${articleLocations.articleId} from ${articleLocations} join ${locations} on ${locations.id} = ${articleLocations.locationId} where ${locations.path} like ${'%/' + l.id + '/%'})`;
    const children = await this.db.select().from(locations).where(eq(locations.parentId, l.id)).orderBy(locations.nameEn);
    return { l, children, page: await this.arts.page([inPlace], { limit: 20, cursor }, lang) };
  }
  search(q: string, lang: Lang, cursor?: string) { return this.feed.search({ q, lang, cursor, limit: 20 } as any); }

  async story(slug: string, lang: Lang) {
    try { return await this.arts.publicGet(slug, lang); } catch { throw new NotFoundException(); }
  }

  async sitemapRows() {
    return this.db.select({ slug: articles.slug, publishedAt: articles.publishedAt, updatedAt: articles.updatedAt }).from(articles)
      .where(eq(articles.status, 'PUBLISHED')).orderBy(desc(articles.publishedAt)).limit(5000);
  }
  async newsSitemapRows() {
    return this.db.query.articles.findMany({
      where: and(eq(articles.status, 'PUBLISHED'), gte(articles.publishedAt, new Date(Date.now() - 48 * 3600_000))),
      with: { translations: true }, orderBy: desc(articles.publishedAt), limit: 1000,
    });
  }
}

// ---------------------------------------------------------------- rendering
interface Ctx { lang: Lang; path: string; cats: Awaited<ReturnType<SiteService['categories']>>; current?: string }
const T = (ctx: Ctx, te: string, en: string) => (ctx.lang === 'te' ? te : en);
const langLink = (ctx: Ctx, l: Lang) => {
  const u = new URL(ctx.path, 'http://x');
  u.searchParams.set('lang', l);
  u.searchParams.delete('cursor');
  return `${u.pathname}${u.search}`;
};

function layout(ctx: Ctx, o: { title: string; description: string; body: string; canonical: string; og?: string; image?: string | null; jsonld?: unknown; band?: string; side?: string }) {
  const cats = ctx.cats.filter((c) => !['for-you', 'local'].includes(c.slug));
  const today = fmtDate(new Date(), ctx.lang);
  const ld = o.jsonld ? `<script type="application/ld+json">${JSON.stringify(o.jsonld).replace(/</g, '\\u003c')}</script>` : '';
  return `<!doctype html>
<html lang="${ctx.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<link rel="alternate" hreflang="te" href="${esc(absolute(langLink(ctx, 'te')))}"><link rel="alternate" hreflang="en" href="${esc(absolute(langLink(ctx, 'en')))}">
<meta name="theme-color" content="#0B1F3A">
<link rel="icon" href="/site/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/site/apple-touch-icon.png">
<link rel="preload" href="/site/anek-telugu.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site/site.css?v=3">
<meta property="og:site_name" content="MAVY NEWS"><meta property="og:type" content="${o.og ?? 'website'}">
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}"><meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:locale" content="${ctx.lang === 'te' ? 'te_IN' : 'en_IN'}">
${o.image ? `<meta property="og:image" content="${esc(o.image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta property="og:image" content="${esc(absolute('/site/icon-512.png'))}">`}
${ld}
</head>
<body>
<a class="skip" href="#main">${T(ctx, 'వార్తలకు వెళ్లండి', 'Skip to news')}</a>
<header class="mast"><div class="wrap">
  <a class="brand" href="/" aria-label="MAVY NEWS"><b>MAVY <span>NEWS</span></b><small>${esc(today)}</small></a>
  <nav class="lang" aria-label="${T(ctx, 'భాష', 'Language')}"><a href="${esc(langLink(ctx, 'te'))}" ${ctx.lang === 'te' ? 'aria-current="true"' : ''} lang="te">తెలుగు</a><a href="${esc(langLink(ctx, 'en'))}" ${ctx.lang === 'en' ? 'aria-current="true"' : ''} lang="en">English</a></nav>
  ${config.appDownloadUrl ? `<a class="get-app" href="${esc(config.appDownloadUrl)}">${T(ctx, 'యాప్ డౌన్‌లోడ్', 'Get the app')}</a>` : ''}
</div></header>
<nav class="sections" aria-label="${T(ctx, 'విభాగాలు', 'Sections')}"><ul>
  <li><a href="/" ${!ctx.current ? 'aria-current="page"' : ''}>${T(ctx, 'ఈ రోజు', 'Today')}</a></li>
  ${cats.map((c) => `<li><a href="/c/${esc(c.slug)}" ${ctx.current === c.slug ? 'aria-current="page"' : ''} ${c.slug === 'breaking' ? 'class="live"' : ''}>${esc(ctx.lang === 'te' ? c.nameTe : c.nameEn)}</a></li>`).join('')}
  <li class="find"><form action="/find" role="search"><input name="q" type="search" placeholder="${T(ctx, 'వెతకండి', 'Search')}" aria-label="${T(ctx, 'వార్తలు వెతకండి', 'Search news')}" minlength="2" required><button type="submit">${T(ctx, 'వెతుకు', 'Go')}</button></form></li>
</ul></nav>
${o.band ?? ''}
<div class="wrap page">
<main id="main">${o.body}</main>
<aside class="side">${o.side ?? ''}</aside>
</div>
<footer class="foot"><div class="wrap">
  <div><b>MAVY <span>NEWS</span></b><p>${T(ctx, 'అనంతపురం, శ్రీ సత్యసాయి జిల్లాల స్థానిక వార్తలు — తెలుగులో, ఇంగ్లీష్‌లో.', 'Local news from Anantapur and Sri Sathya Sai districts, in Telugu and English.')}</p><small>© ${new Date().getFullYear()} MAVY TECH SOLUTIONS PVT LTD</small></div>
  <ul><li><a href="/about">${T(ctx, 'మా గురించి', 'About us')}</a></li><li><a href="/grievance">${T(ctx, 'ఫిర్యాదులు (గ్రీవెన్స్)', 'Grievances')}</a></li><li><a href="/privacy">${T(ctx, 'గోప్యతా విధానం', 'Privacy policy')}</a></li></ul>
  <ul>${config.appDownloadUrl ? `<li><a href="${esc(config.appDownloadUrl)}">${T(ctx, 'యాప్ డౌన్‌లోడ్ (Android)', 'Download the Android app')}</a></li>` : ''}<li><a href="/c/breaking">${T(ctx, 'బ్రేకింగ్ న్యూస్', 'Breaking news')}</a></li><li><a href="/d/dist-anantapur">${T(ctx, 'అనంతపురం వార్తలు', 'Anantapur news')}</a></li><li><a href="/d/dist-sri-sathya-sai">${T(ctx, 'శ్రీ సత్యసాయి వార్తలు', 'Sri Sathya Sai news')}</a></li></ul>
</div></footer>
<script src="/site/site.js" defer></script>
</body></html>`;
}

/** TV-style lower third. Red for breaking; navy "latest" when nothing is breaking. */
function band(ctx: Ctx, items: Card[], breaking: boolean) {
  if (!items.length) return '';
  const li = items.map((a) => `<li><a href="/n/${esc(a.slug)}">${esc(a.headline)}</a></li>`).join('');
  const dup = items.map((a) => `<li class="dup" aria-hidden="true"><a href="/n/${esc(a.slug)}" tabindex="-1">${esc(a.headline)}</a></li>`).join('');
  const speed = items.length <= 3 ? 'len-s' : items.length <= 6 ? 'len-m' : 'len-l';
  return `<section class="band${breaking ? '' : ' latest'}" aria-label="${breaking ? T(ctx, 'బ్రేకింగ్ న్యూస్', 'Breaking news') : T(ctx, 'తాజా వార్తలు', 'Latest news')}">
<div class="label"><i aria-hidden="true"></i>${breaking ? T(ctx, 'బ్రేకింగ్', 'Breaking') : T(ctx, 'తాజా', 'Latest')}</div>
<div class="track"><ul class="${speed}">${li}${dup}</ul></div></section>`;
}

function places(ctx: Ctx, a: Card) {
  return a.locations.filter((l) => l.type !== 'STATE').map((l) => (ctx.lang === 'te' ? l.nameTe : l.nameEn)).join(', ');
}
function byline(ctx: Ctx, a: Card) {
  if (!a.reporter) return '';
  const lvl = a.reporterLevel ? ` <span class="lvl ${a.reporterLevel}">${esc(LEVEL[a.reporterLevel][ctx.lang === 'te' ? 0 : 1])}</span>` : '';
  return `<span class="by">✍ ${esc(a.reporter)}${lvl}</span>`;
}
function meta(ctx: Ctx, a: Card) {
  const p = places(ctx, a);
  return `<div class="meta">${a.isBreaking ? `<span class="breaking">${T(ctx, 'బ్రేకింగ్', 'Breaking')}</span>` : ''}${p ? `<span>📍 ${esc(p)}</span>` : ''}<time datetime="${esc(a.publishedAt instanceof Date ? a.publishedAt.toISOString() : a.publishedAt)}">${esc(ago(a.publishedAt, ctx.lang))}</time>${byline(ctx, a)}</div>`;
}
const catName = (ctx: Ctx, a: Card) => (ctx.lang === 'te' ? a.category.nameTe : a.category.nameEn);

function lead(ctx: Ctx, a: Card) {
  const img = media(a.heroImageUrl);
  const top = img
    ? `<img class="photo" src="${esc(img)}" alt="" width="1280" height="720" fetchpriority="high">`
    : `<div class="slate"><span class="cat">${esc(catName(ctx, a))}</span><h2>${esc(a.headline)}</h2></div>`;
  return `<article class="lead ${catCls(a.category.slug)}"><a href="/n/${esc(a.slug)}">${top}<div class="body">
${img ? `<span class="cat">${esc(catName(ctx, a))}</span><h2>${esc(a.headline)}</h2>` : ''}<p>${esc(a.summary)}</p>${meta(ctx, a)}</div></a></article>`;
}
function list(ctx: Ctx, items: Card[]) {
  return `<ul class="list">${items.map((a) => {
    const img = media(a.heroImageUrl);
    return `<li class="item ${catCls(a.category.slug)}"><a href="/n/${esc(a.slug)}"><div><span class="cat">${esc(catName(ctx, a))}</span><h3>${esc(a.headline)}</h3><p>${esc(a.summary)}</p>${meta(ctx, a)}</div>${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" width="108" height="80">` : '<span></span>'}</a></li>`;
  }).join('')}</ul>`;
}
const moreLink = (ctx: Ctx, base: string, cursor: string | null) =>
  cursor ? `<a class="more" href="${esc(base)}${base.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}">${T(ctx, 'మరిన్ని పాత వార్తలు', 'Older news')}</a>` : '';

function side(ctx: Ctx, d: Awaited<ReturnType<SiteService['districts']>>, board: Awaited<ReturnType<SiteService['leaderboard']>>) {
  const name = (l: { nameTe: string; nameEn: string }) => esc(ctx.lang === 'te' ? l.nameTe : l.nameEn);
  const home = d.flatMap((s) => s.districts).filter((x) => HOME_DISTRICTS.includes(x.slug));
  const app = config.appDownloadUrl ? `<section class="box app-box"><h2>${T(ctx, 'MAVY NEWS యాప్', 'The MAVY NEWS app')}</h2>
<ul><li>${T(ctx, 'మీ మండలం వార్తలు ముందుగా', 'News from your mandal first')}</li><li>${T(ctx, 'బ్రేకింగ్ న్యూస్ వెంటనే', 'Breaking news as it happens')}</li><li>${T(ctx, 'మీరే జర్నలిస్ట్ అవ్వండి, పాయింట్లు గెలవండి', 'Report from your area and earn points')}</li></ul>
<a class="get-app" href="${esc(config.appDownloadUrl)}">${T(ctx, 'Android యాప్ డౌన్‌లోడ్', 'Download for Android')}</a></section>` : '';
  const placesBox = `<section class="box"><h2>${T(ctx, 'జిల్లాల వారీగా', 'News by district')}</h2>
<ul class="places">${home.map((x) => `<li class="home"><a href="/d/${esc(x.slug)}">${name(x)}</a></li>`).join('')}</ul>
${d.map((s) => `<details class="all"><summary>${name(s.state)} — ${T(ctx, 'అన్ని జిల్లాలు', 'all districts')}</summary><ul class="places in-details">${s.districts.filter((x) => !HOME_DISTRICTS.includes(x.slug)).map((x) => `<li><a href="/d/${esc(x.slug)}">${name(x)}</a></li>`).join('')}</ul></details>`).join('')}</section>`;
  const top = board.length ? `<section class="box"><h2>${T(ctx, 'మా సిటిజన్ జర్నలిస్టులు', 'Our citizen journalists')}</h2><ol class="board">${board.map((b) => `<li><span>${esc(b.name)}</span>${b.level ? `<span class="lvl ${b.level}">${esc(LEVEL[b.level][ctx.lang === 'te' ? 0 : 1])}</span>` : ''}<span class="pts">${b.points}</span></li>`).join('')}</ol><p class="note">${T(ctx, 'పాయింట్లు = ఆమోదించిన వార్తలు. యాప్‌లో "జర్నలిస్ట్ అవ్వండి" నొక్కండి.', 'Points come from approved stories. Tap "Become a journalist" in the app.')}</p></section>` : '';
  return app + placesBox + top;
}

// ---------------------------------------------------------------- controller
@Controller()
@Public()
class SiteController {
  constructor(private readonly svc: SiteService) {}

  private async ctx(req: Request, res: Response, current?: string): Promise<Ctx> {
    const q = (req.query.lang as string) || '';
    const cookie = /(?:^|;\s*)lang=(te|en)/.exec(req.headers.cookie ?? '')?.[1];
    const lang: Lang = q === 'en' || q === 'te' ? q : cookie === 'en' ? 'en' : 'te';
    if (q === 'en' || q === 'te') res.cookie('lang', lang, { maxAge: 365 * 86400_000, sameSite: 'lax', httpOnly: true });
    const u = new URL(req.originalUrl, 'http://x');
    u.searchParams.delete('lang');
    return { lang, path: `${u.pathname}${u.search}`, cats: await this.svc.categories(), current };
  }

  private send(res: Response, html: string, status = 200, maxAge = 120) {
    res.status(status).type('html')
      .setHeader('Cache-Control', `public, max-age=${maxAge}`)
      .setHeader('Vary', 'Cookie')
      .setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https: http:; font-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
      .send(html);
  }

  private async sideHtml(ctx: Ctx) {
    const [d, board] = await Promise.all([this.svc.districts(), this.svc.leaderboard()]);
    return side(ctx, d, board);
  }

  private async bandHtml(ctx: Ctx) {
    const br = await this.svc.breaking(ctx.lang);
    if (br.items.length) return band(ctx, br.items as Card[], true);
    return band(ctx, (await this.svc.latest(ctx.lang)).items as Card[], false);
  }

  private notFound(ctx: Ctx, res: Response, sideHtml: string) {
    const body = `<div class="empty"><strong>${T(ctx, 'ఈ పేజీ దొరకలేదు', 'Page not found')}</strong>${T(ctx, 'వార్త తీసివేయబడి ఉండవచ్చు లేదా లింక్ తప్పు కావచ్చు.', 'The story may have been removed, or the link is wrong.')}<br><br><a class="more" href="/">${T(ctx, 'ఈ రోజు వార్తలు చూడండి', 'See today\'s news')}</a></div>`;
    this.send(res, layout(ctx, { title: 'MAVY NEWS', description: '', canonical: absolute('/'), body, side: sideHtml }), 404, 60);
  }

  @Get()
  async home(@Req() req: Request, @Res() res: Response, @Query('cursor') cursor?: string) {
    const ctx = await this.ctx(req, res);
    const [bandHtml, sideHtml] = await Promise.all([this.bandHtml(ctx), this.sideHtml(ctx)]);
    let body: string;
    if (cursor) {
      const older = await this.svc.before(ctx.lang, cursor);
      body = `<div class="sec-head"><h2>${T(ctx, 'పాత వార్తలు', 'Older news')}</h2></div>${list(ctx, older.items as Card[])}${moreLink(ctx, '/', older.nextCursor)}`;
    } else {
      const [today, before] = await Promise.all([this.svc.today(ctx.lang), this.svc.before(ctx.lang)]);
      const items = today.items as Card[];
      const head = (items.find((a) => a.isBreaking && a.heroImageUrl) ?? items.find((a) => a.heroImageUrl) ?? items[0]);
      const rest = items.filter((a) => a !== head);
      body = items.length
        ? `<div class="sec-head first"><h1>${T(ctx, 'ఈ రోజు వార్తలు', 'Today\'s news')}</h1><span>${items.length} ${T(ctx, 'వార్తలు', items.length === 1 ? 'story' : 'stories')}</span></div>`
          + lead(ctx, head) + (rest.length ? list(ctx, rest) : '')
        : `<div class="empty"><strong>${T(ctx, 'ఈ రోజు ఇంకా వార్తలు రాలేదు', 'No news yet today')}</strong>${T(ctx, 'కింద నిన్నటి వార్తలు చూడండి.', 'Here is the most recent news.')}</div>`;
      if (before.items.length)
        body += `<div class="sec-head"><h2>${T(ctx, 'ఇంతకు ముందు', 'Earlier')}</h2></div>${list(ctx, before.items as Card[])}${moreLink(ctx, '/', before.nextCursor)}`;
    }
    const title = T(ctx, 'MAVY NEWS — అనంతపురం, శ్రీ సత్యసాయి తాజా వార్తలు', 'MAVY NEWS — Anantapur & Sri Sathya Sai latest news');
    this.send(res, layout(ctx, {
      title, description: T(ctx, 'అనంతపురం, శ్రీ సత్యసాయి జిల్లాల తాజా వార్తలు, బ్రేకింగ్ న్యూస్ — MAVY NEWS', 'Latest local and breaking news from Anantapur and Sri Sathya Sai districts — MAVY NEWS'),
      canonical: absolute('/'), body, band: bandHtml, side: sideHtml,
      jsonld: { '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', name: 'MAVY NEWS', url: absolute('/'), logo: absolute('/site/icon-512.png'), parentOrganization: { '@type': 'Organization', name: 'MAVY TECH SOLUTIONS PVT LTD' } },
    }));
  }

  @Get('c/:slug')
  async category(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response, @Query('cursor') cursor?: string) {
    const ctx = await this.ctx(req, res, slug);
    const sideHtml = await this.sideHtml(ctx);
    let r;
    try { r = await this.svc.category(slug, ctx.lang, cursor); } catch { return this.notFound(ctx, res, sideHtml); }
    const name = ctx.lang === 'te' ? r.c.nameTe : r.c.nameEn;
    const items = r.page.items as Card[];
    const body = `<div class="sec-head first cat-head ${catCls(slug)}"><h2>${esc(name)}</h2>${r.page.total != null ? `<span>${r.page.total} ${T(ctx, 'వార్తలు', 'stories')}</span>` : ''}</div>`
      + (items.length ? (!cursor ? lead(ctx, items[0]) + list(ctx, items.slice(1)) : list(ctx, items)) : `<div class="empty"><strong>${T(ctx, 'ఇంకా వార్తలు లేవు', 'No stories yet')}</strong></div>`)
      + moreLink(ctx, `/c/${slug}`, r.page.nextCursor);
    this.send(res, layout(ctx, { title: `${name} — MAVY NEWS`, description: T(ctx, `${name} తాజా వార్తలు — MAVY NEWS`, `${name} latest news — MAVY NEWS`), canonical: absolute(`/c/${slug}`), body, side: sideHtml }));
  }

  @Get('d/:slug')
  async place(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response, @Query('cursor') cursor?: string) {
    const ctx = await this.ctx(req, res);
    const sideHtml = await this.sideHtml(ctx);
    let r;
    try { r = await this.svc.place(slug, ctx.lang, cursor); } catch { return this.notFound(ctx, res, sideHtml); }
    const name = ctx.lang === 'te' ? r.l.nameTe : r.l.nameEn;
    const items = r.page.items as Card[];
    const kids = r.children.filter((c) => c.type === 'MANDAL' || c.type === 'MUNICIPALITY');
    const body = `<div class="sec-head first"><h2>📍 ${esc(name)}</h2>${r.page.total != null ? `<span>${r.page.total} ${T(ctx, 'వార్తలు', 'stories')}</span>` : ''}</div>`
      + (kids.length && !cursor ? `<div class="box sub-places"><ul class="places">${kids.map((k) => `<li><a href="/d/${esc(k.slug)}">${esc(ctx.lang === 'te' ? k.nameTe : k.nameEn)}</a></li>`).join('')}</ul></div>` : '')
      + (items.length ? list(ctx, items) : `<div class="empty"><strong>${T(ctx, 'ఈ ప్రాంతం నుంచి ఇంకా వార్తలు లేవు', 'No stories from this place yet')}</strong>${T(ctx, 'మీరు ఇక్కడి నుంచి వార్తలు పంపాలనుకుంటే, యాప్‌లో జర్నలిస్ట్‌గా చేరండి.', 'Want to report from here? Join as a journalist in the app.')}</div>`)
      + moreLink(ctx, `/d/${slug}`, r.page.nextCursor);
    this.send(res, layout(ctx, { title: T(ctx, `${name} వార్తలు — MAVY NEWS`, `${name} news — MAVY NEWS`), description: T(ctx, `${name} తాజా స్థానిక వార్తలు`, `Latest local news from ${name}`), canonical: absolute(`/d/${slug}`), body, side: sideHtml }));
  }

  @Get('find')
  async find(@Req() req: Request, @Res() res: Response, @Query('q') q = '', @Query('cursor') cursor?: string) {
    const ctx = await this.ctx(req, res);
    const sideHtml = await this.sideHtml(ctx);
    const term = String(q).trim().slice(0, 100);
    let body = `<div class="sec-head first"><h2>${T(ctx, 'వెతుకులాట', 'Search')}: “${esc(term)}”</h2></div>`;
    if (term.length < 2) body += `<div class="empty"><strong>${T(ctx, 'కనీసం 2 అక్షరాలు టైప్ చేయండి', 'Type at least 2 letters')}</strong></div>`;
    else {
      const r = await this.svc.search(term, ctx.lang, cursor);
      body += r.items.length ? list(ctx, r.items as Card[]) + moreLink(ctx, `/find?q=${encodeURIComponent(term)}`, r.nextCursor)
        : `<div class="empty"><strong>${T(ctx, 'ఏమీ దొరకలేదు', 'Nothing found')}</strong>${r.didYouMean ? `${T(ctx, 'బహుశా ఇది వెతుకుతున్నారా:', 'Did you mean:')} <a href="/find?q=${encodeURIComponent(r.didYouMean)}">${esc(r.didYouMean)}</a>` : T(ctx, 'వేరే పదంతో ప్రయత్నించండి — ఊరి పేరు లేదా అంశం.', 'Try another word, such as a place or a topic.')}</div>`;
    }
    res.setHeader('X-Robots-Tag', 'noindex');
    this.send(res, layout(ctx, { title: `${term} — MAVY NEWS`, description: '', canonical: absolute('/find'), body, side: sideHtml }), 200, 60);
  }

  @Get('n/:slug')
  async story(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const ctx = await this.ctx(req, res);
    let a;
    try { a = await this.svc.story(slug, ctx.lang); } catch { return this.notFound(ctx, res, await this.sideHtml(ctx)); }
    ctx.current = a.category.slug;
    const card = a as unknown as Card & { related: Card[]; body?: string };
    const img = media(a.heroImageUrl);
    const url = absolute(`/n/${a.slug}`);
    const paras = String(a.body || a.summary || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
    const norm = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim();
    const showSummary = !norm(a.body).startsWith(norm(a.summary).slice(0, 40)); // summary is often the first lines of the story
    const source = a.sourceType === 'CITIZEN'
      ? T(ctx, 'ఈ వార్తను MAVY NEWS సిటిజన్ జర్నలిస్ట్ పంపారు. మా ఎడిటర్లు పరిశీలించిన తర్వాత ప్రచురించాము.', 'Sent by a MAVY NEWS citizen journalist and published after our editors checked it.')
      : `${T(ctx, 'మూలం', 'Source')}: ${esc(a.sourceLabel)}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(`${a.headline}\n${url}`)}`;
    const other = a.availableLanguages.find((l) => l !== a.language);
    const body = `<article class="story ${catCls(a.category.slug)}">
<div class="head"><p class="crumb"><a href="/c/${esc(a.category.slug)}">${esc(catName(ctx, card))}</a>${other ? ` &nbsp; <a href="?lang=${other}" lang="${other}">${other === 'en' ? 'Read in English' : 'తెలుగులో చదవండి'}</a>` : ''}</p>
<h1>${esc(a.headline)}</h1>${showSummary ? `<p class="sum">${esc(a.summary)}</p>` : ''}${meta(ctx, card)}</div>
${img ? `<figure><img src="${esc(img)}" alt="" width="1280" height="720" fetchpriority="high">${a.heroImageCredit ? `<figcaption>${T(ctx, 'ఫోటో', 'Photo')}: ${esc(a.heroImageCredit)}</figcaption>` : ''}</figure>` : ''}
<div class="text">${paras}</div>
<p class="source">${source}</p>
<div class="share"><a class="wa" href="${esc(wa)}" rel="noopener" target="_blank">${T(ctx, 'వాట్సాప్‌లో పంపండి', 'Share on WhatsApp')}</a><button type="button" id="share-btn" data-url="${esc(url)}" data-title="${esc(a.headline)}" data-done="${T(ctx, 'లింక్ కాపీ అయింది', 'Link copied')}">${T(ctx, 'లింక్ షేర్ చేయండి', 'Share link')}</button></div>
</article>
${card.related?.length ? `<div class="sec-head"><h2>${T(ctx, 'ఇలాంటి మరిన్ని వార్తలు', 'More like this')}</h2></div>${list(ctx, card.related)}` : ''}`;
    const published = a.publishedAt instanceof Date ? a.publishedAt.toISOString() : a.publishedAt;
    this.send(res, layout(ctx, {
      title: `${a.headline} | MAVY NEWS`, description: a.summary, canonical: url, og: 'article', image: img ? absolute(img) : null, body,
      side: await this.sideHtml(ctx),
      jsonld: {
        '@context': 'https://schema.org', '@type': 'NewsArticle', headline: String(a.headline).slice(0, 110), description: a.summary,
        inLanguage: a.language, datePublished: published, dateModified: a.updatedAt, mainEntityOfPage: url,
        ...(img ? { image: [absolute(img)] } : {}),
        author: a.reporter ? { '@type': 'Person', name: a.reporter } : { '@type': 'Organization', name: 'MAVY NEWS' },
        publisher: { '@type': 'NewsMediaOrganization', name: 'MAVY NEWS', logo: { '@type': 'ImageObject', url: absolute('/site/icon-512.png') } },
        ...(card.locations.length ? { contentLocation: card.locations.map((l) => ({ '@type': 'Place', name: l.nameEn })) } : {}),
      },
    }), 200, 300);
  }

  @Get('about')
  async about(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.ctx(req, res);
    const body = `<div class="doc"><h1>${T(ctx, 'MAVY NEWS గురించి', 'About MAVY NEWS')}</h1>
<p>${T(ctx, 'MAVY NEWS అనంతపురం, శ్రీ సత్యసాయి జిల్లాల కోసం స్థానిక వార్తా వేదిక. మీ మండలం, మీ పట్టణం, మీ ఊరి వార్తలను తెలుగులో, ఇంగ్లీష్‌లో అందిస్తాం.', 'MAVY NEWS is a local news platform for Anantapur and Sri Sathya Sai districts. We report the news of your mandal, town and village, in Telugu and English.')}</p>
<h2>${T(ctx, 'మేము వార్తలు ఎలా ప్రచురిస్తాం', 'How we publish')}</h2>
<p>${T(ctx, 'ప్రతి వార్తను మా ఎడిటర్లు పరిశీలించిన తర్వాతే ప్రచురిస్తాం. సిటిజన్ జర్నలిస్టులు యాప్ ద్వారా వార్తలు పంపుతారు; ఆధార్‌తో ధృవీకరించిన తర్వాతే వారికి అనుమతి ఇస్తాం. ఇతర సంస్థల నుంచి తీసుకున్న సమాచారానికి మూలం పేరు స్పష్టంగా రాస్తాం.', 'Every story is checked by our editors before it is published. Citizen journalists send stories through the app and are verified before they can post. When information comes from another outlet, we name the source.')}</p>
<h2>${T(ctx, 'తప్పు కనిపిస్తే', 'If something is wrong')}</h2>
<p>${T(ctx, 'యాప్‌లో వార్త కింద "రిపోర్ట్" నొక్కండి, లేదా', 'Tap "Report" under the story in the app, or see')} <a href="/grievance">${T(ctx, 'ఫిర్యాదుల పేజీ', 'our grievance page')}</a>.</p>
<p><small>MAVY TECH SOLUTIONS PVT LTD</small></p></div>`;
    this.send(res, layout(ctx, { title: T(ctx, 'మా గురించి — MAVY NEWS', 'About — MAVY NEWS'), description: 'About MAVY NEWS', canonical: absolute('/about'), body, side: await this.sideHtml(ctx) }), 200, 3600);
  }

  @Get('grievance')
  async grievance(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.ctx(req, res);
    const g = config.grievance;
    const officer = g.name ? `<h2>${T(ctx, 'గ్రీవెన్స్ అధికారి', 'Grievance Officer')}</h2><p>${esc(g.name)}${g.email ? `<br>${T(ctx, 'ఈమెయిల్', 'Email')}: <a href="mailto:${esc(g.email)}">${esc(g.email)}</a>` : ''}${g.phone ? `<br>${T(ctx, 'ఫోన్', 'Phone')}: ${esc(g.phone)}` : ''}${g.address ? `<br>${esc(g.address)}` : ''}</p>` : '';
    const body = `<div class="doc"><h1>${T(ctx, 'ఫిర్యాదుల పరిష్కారం', 'Grievance redressal')}</h1>
<p>${T(ctx, 'ఏదైనా వార్త తప్పుగా, అభ్యంతరకరంగా, లేదా మీ గోప్యతకు భంగం కలిగించేలా ఉంటే మాకు తెలియజేయండి. ఇది సమాచార సాంకేతిక (మధ్యవర్తుల మార్గదర్శకాలు మరియు డిజిటల్ మీడియా నైతిక నియమావళి) నియమాలు, 2021 ప్రకారం మా ఫిర్యాదుల వ్యవస్థ.', 'If a story is wrong, offensive, or harms your privacy, tell us. This is our grievance mechanism under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.')}</p>
<h2>${T(ctx, 'ఎలా ఫిర్యాదు చేయాలి', 'How to complain')}</h2>
<ol><li>${T(ctx, 'MAVY NEWS యాప్‌లో ఆ వార్త తెరవండి.', 'Open the story in the MAVY NEWS app.')}</li><li>${T(ctx, '"మరిన్ని" → "రిపోర్ట్" నొక్కి కారణం ఎంచుకోండి.', 'Tap "More" → "Report" and choose the reason.')}</li><li>${T(ctx, 'మీ ఫిర్యాదు 24 గంటల్లో అందినట్లు ధృవీకరిస్తాం, 15 రోజుల్లో పరిష్కరిస్తాం.', 'We acknowledge within 24 hours and resolve within 15 days.')}</li></ol>
${officer}</div>`;
    this.send(res, layout(ctx, { title: T(ctx, 'ఫిర్యాదులు — MAVY NEWS', 'Grievances — MAVY NEWS'), description: 'Grievance redressal — MAVY NEWS', canonical: absolute('/grievance'), body, side: await this.sideHtml(ctx) }), 200, 3600);
  }

  @Get('privacy')
  async privacy(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.ctx(req, res);
    const body = `<div class="doc"><h1>${T(ctx, 'గోప్యతా విధానం', 'Privacy policy')}</h1>
<p>${T(ctx, 'ఈ వెబ్‌సైట్ చదవడానికి ఖాతా అవసరం లేదు. మీరు ఎంచుకున్న భాషను గుర్తుంచుకోవడానికి మాత్రమే ఒక కుకీ వాడతాం. ప్రకటనల ట్రాకింగ్ లేదు.', 'You do not need an account to read this website. We use one cookie only to remember your language. There is no advertising tracking.')}</p>
<h2>${T(ctx, 'యాప్‌లో', 'In the app')}</h2>
<ul><li>${T(ctx, 'లాగిన్ కోసం మీ మొబైల్ నంబర్ మాత్రమే తీసుకుంటాం.', 'We use your mobile number only to log you in.')}</li>
<li>${T(ctx, 'జర్నలిస్ట్‌గా చేరేటప్పుడు ఆధార్ ఫోటో అడుగుతాం — ఆధార్ నంబర్ అడగము. నిర్ణయం తర్వాత ఆ ఫోటో శాశ్వతంగా తొలగిస్తాం.', 'When you apply as a journalist we ask for an Aadhaar photo, never the Aadhaar number. The photo is deleted for good after the decision.')}</li>
<li>${T(ctx, 'మీరు యాప్‌లోనే మీ ఖాతాను తొలగించవచ్చు. మీ వ్యక్తిగత వివరాలు చెరిపివేయబడతాయి.', 'You can delete your account in the app. Your personal details are erased.')}</li>
<li>${T(ctx, 'మీ వివరాలను ఎవరికీ అమ్మము.', 'We never sell your data.')}</li></ul>
<p><small>MAVY TECH SOLUTIONS PVT LTD</small></p></div>`;
    this.send(res, layout(ctx, { title: T(ctx, 'గోప్యతా విధానం — MAVY NEWS', 'Privacy — MAVY NEWS'), description: 'Privacy policy — MAVY NEWS', canonical: absolute('/privacy'), body, side: await this.sideHtml(ctx) }), 200, 3600);
  }

  // ---------- files and search-engine helpers ----------
  @Get('site/:file')
  file(@Param('file') file: string, @Res() res: Response) {
    const type = SITE_FILES[file];
    const p = path.join(SITE_DIR, file);
    if (!type || !existsSync(p)) throw new NotFoundException();
    res.setHeader('Cache-Control', file.endsWith('.css') || file.endsWith('.js') ? 'public, max-age=3600' : 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type(type).sendFile(p);
  }

  @Get('robots.txt')
  robots(@Res() res: Response) {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=86400')
      .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /newsroom\nDisallow: /find\nSitemap: ${absolute('/sitemap.xml')}\nSitemap: ${absolute('/news-sitemap.xml')}\n`);
  }

  @Get('sitemap.xml')
  async sitemap(@Res() res: Response) {
    const rows = await this.svc.sitemapRows();
    const cats = (await this.svc.categories()).filter((c) => !c.isVirtual || c.slug === 'breaking');
    const urls = [`<url><loc>${absolute('/')}</loc><changefreq>hourly</changefreq></url>`,
      ...cats.map((c) => `<url><loc>${absolute(`/c/${c.slug}`)}</loc><changefreq>hourly</changefreq></url>`),
      ...HOME_DISTRICTS.map((d) => `<url><loc>${absolute(`/d/${d}`)}</loc><changefreq>hourly</changefreq></url>`),
      ...rows.map((r) => `<url><loc>${esc(absolute(`/n/${r.slug}`))}</loc><lastmod>${(r.updatedAt ?? r.publishedAt)!.toISOString()}</lastmod></url>`)];
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  }

  @Get('news-sitemap.xml')
  async newsSitemap(@Res() res: Response) {
    const rows = await this.svc.newsSitemapRows();
    const urls = rows.map((a) => {
      const t = a.translations.find((x) => x.language === 'te') ?? a.translations[0];
      return `<url><loc>${esc(absolute(`/n/${a.slug}`))}</loc><news:news><news:publication><news:name>MAVY NEWS</news:name><news:language>${t?.language ?? 'te'}</news:language></news:publication><news:publication_date>${a.publishedAt!.toISOString()}</news:publication_date><news:title>${esc(t?.headline)}</news:title></news:news></url>`;
    });
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls.join('')}</urlset>`);
  }
}

@Module({ imports: [ArticlesModule, FeedModule], controllers: [SiteController], providers: [SiteService] })
export class SiteModule {}
