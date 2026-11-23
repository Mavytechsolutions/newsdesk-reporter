/**
 * Photo upload for the newsroom + serving the newsroom web page.
 *  POST /api/v1/newsroom/media   (staff)  multipart "file" → resized JPEG, location data removed → { url }
 *  GET  /media/<id>.jpg          (public) the photo
 *  GET  /newsroom                (public) the newsroom web page (login happens inside it)
 */
import {
  BadRequestException, Controller, Get, Module, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { promises as fs, existsSync, mkdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import { config } from '../config';

const MAX_BYTES = 10 * 1024 * 1024;
const FILE_RE = /^[a-f0-9]{32}\.jpg$/;
const PUBLIC_DIR = path.join(process.cwd(), 'public');

@Controller()
class MediaController {
  constructor(private readonly audit: AuditService) {
    if (!existsSync(config.mediaDir)) mkdirSync(config.mediaDir, { recursive: true });
  }

  @Post('newsroom/media')
  @Roles('SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR', 'SUB_EDITOR', 'REPORTER', 'VIDEO_JOURNALIST')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    if (!file) throw new BadRequestException('Choose a photo to upload');
    let out: Buffer;
    try {
      // Reads JPEG/PNG/WebP/HEIC-like inputs; .rotate() applies phone orientation; metadata (incl. GPS) is dropped.
      out = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 60_000_000 })
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new BadRequestException('This file is not a photo we can use. Please choose a JPG or PNG photo.');
    }
    const name = `${randomBytes(16).toString('hex')}.jpg`;
    await fs.writeFile(path.join(config.mediaDir, name), out);
    await this.audit.log({ actorId: u.id, action: 'media.upload', entity: 'media', entityId: name, metadata: { bytes: out.length }, ip });
    return { url: `${config.publicWebUrl}/media/${name}`, bytes: out.length };
  }

  @Public() @Get('media/:file')
  async serve(@Param('file') file: string, @Res() res: Response) {
    if (!FILE_RE.test(file)) throw new NotFoundException();
    const p = path.join(config.mediaDir, file);
    if (!existsSync(p)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type('jpg').sendFile(p);
  }

  @Public() @Get('newsroom')
  page(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-cache');
    // story photos may live on other websites: allow images from anywhere, everything else only from this server
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: http: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    res.type('html').sendFile(path.join(PUBLIC_DIR, 'newsroom.html'));
  }

  /** Telugu font for the newsroom and shared story pages (same font as the app), so Telugu looks right on every device. */
  @Public() @Get('fonts/:file')
  font(@Param('file') file: string, @Res() res: Response) {
    if (!/^NotoSansTelugu_(400Regular|700Bold)\.ttf$/.test(file)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type('font/ttf').sendFile(path.join(PUBLIC_DIR, 'fonts', file));
  }

  @Public() @Get('newsroom/app.js')
  script(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('js').sendFile(path.join(PUBLIC_DIR, 'newsroom.js'));
  }
}

@Module({ controllers: [MediaController] })
export class MediaModule {}
