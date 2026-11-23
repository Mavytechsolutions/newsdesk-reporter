/**
 * Public web page for a shared story: /n/<slug>
 * WhatsApp, Facebook and Telegram read the og: tags to show a rich preview with the photo.
 * People without the app can read the story and get a link to download it.
 */
import { Controller, Get, Module, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { articles } from '../db/schema';
import { Public } from '../common/auth.decorators';
import { config } from '../config';

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Controller('n')
@Public()
class StoryPageController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get(':slug')
  async page(@Param('slug') slug: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    const a = await this.db.query.articles.findFirst({
      where: and(eq(articles.slug, slug), eq(articles.status, 'PUBLISHED')),
      with: { translations: true, category: true, author: { columns: { name: true } } },
    });
    if (!a) throw new NotFoundException('Story not found');
    const t = a.translations.find((x) => x.language === (lang === 'en' ? 'en' : 'te')) ?? a.translations[0];
    const url = `${config.publicWebUrl}/n/${a.slug}`;
    const date = a.publishedAt ? a.publishedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '';
    const body = (t.body || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
    const label = a.sourceType === 'CITIZEN' ? '<span class="tag cit">Citizen report — submitted by a reader</span>' : '';
    const html = `<!doctype html><html lang="${t.language}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.headline)} | MAVY NEWS</title>
<meta name="description" content="${esc(t.summary)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="MAVY NEWS">
<meta property="og:title" content="${esc(t.headline)}"><meta property="og:description" content="${esc(t.summary)}">
<meta property="og:url" content="${esc(url)}">${a.heroImageUrl ? `<meta property="og:image" content="${esc(a.heroImageUrl)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<style>
body{margin:0;font-family:'Noto Sans Telugu','Noto Sans',system-ui,sans-serif;background:#F4F6FA;color:#0B1220}
header{background:#0B1F3A;color:#fff;padding:14px 16px;font-weight:800;letter-spacing:1px}header b{color:#16A34A}
main{max-width:720px;margin:0 auto;background:#fff;min-height:100vh}
img{width:100%;max-height:420px;object-fit:cover;display:block}
.c{padding:16px 18px 40px}.meta{color:#5B6577;font-size:13px}.tag{display:inline-block;background:#D7262E;color:#fff;border-radius:4px;padding:1px 7px;font-size:12px;font-weight:700;margin-right:6px}
.cit{background:#B45309}h1{font-size:24px;line-height:1.45;margin:10px 0}.sum{font-size:18px;font-weight:600;line-height:1.7}
p{font-size:17px;line-height:1.8}.credit{font-size:11px;color:#5B6577;padding:4px 18px 0}
.app{display:block;text-align:center;background:#16A34A;color:#fff;text-decoration:none;font-weight:700;padding:16px;border-radius:12px;margin-top:24px;font-size:17px}
</style></head><body><main>
<header>MAVY <b>NEWS</b></header>
${a.heroImageUrl ? `<img src="${esc(a.heroImageUrl)}" alt="">${a.heroImageCredit ? `<div class="credit">Photo: ${esc(a.heroImageCredit)}</div>` : ''}` : ''}
<div class="c">
<div class="meta">${a.isBreaking ? '<span class="tag">BREAKING</span>' : ''}${label}${esc(t.language === 'te' ? a.category.nameTe : a.category.nameEn)} · ${esc(date)}${a.author?.name ? ` · ${esc(a.author.name)}` : ''}</div>
<h1>${esc(t.headline)}</h1>
<div class="sum">${esc(t.summary)}</div>
${body}
${config.appDownloadUrl ? `<a class="app" href="${esc(config.appDownloadUrl)}">📲 MAVY NEWS యాప్ డౌన్‌లోడ్ చేసుకోండి</a>` : ''}
</div></main></body></html>`;
    res
      .status(200)
      .type('html')
      .setHeader('Cache-Control', 'public, max-age=300')
      .setHeader('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
      .send(html);
  }
}

@Module({ controllers: [StoryPageController] })
export class WebPageModule {}
