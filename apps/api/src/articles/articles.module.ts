import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ArticlesService } from './articles.service';
import { CreateArticleDto, NewsroomListQuery, PublicListQuery, TransitionDto, UpdateArticleDto } from './articles.dto';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/auth.decorators';
import { LocationsModule } from '../locations/locations.module';

class DeleteQuery { @IsOptional() @IsString() @MaxLength(500) reason?: string; }
class LangQuery { @IsOptional() @IsIn(['te', 'en']) lang?: 'te' | 'en'; }

@Controller('articles')
@Public()
class PublicArticlesController {
  constructor(private readonly svc: ArticlesService) {}
  @Get() list(@Query() q: PublicListQuery) { return this.svc.publicList(q); }
  @Get(':slug') get(@Param('slug') slug: string, @Query() q: LangQuery, @CurrentUser() u?: AuthUser) { return this.svc.publicGet(slug, q.lang, u?.id); }
}

@Controller('newsroom/articles')
@Roles('SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR', 'SUB_EDITOR', 'REPORTER', 'VIDEO_JOURNALIST')
class NewsroomArticlesController {
  constructor(private readonly svc: ArticlesService) {}
  @Get() list(@Query() q: NewsroomListQuery, @CurrentUser() u: AuthUser) { return this.svc.newsroomList(q, u); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.newsroomGet(id); }
  @Post() create(@Body() dto: CreateArticleDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.create(dto, u, ip); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateArticleDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.update(id, dto, u, ip);
  }
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Query() q: DeleteQuery, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.remove(id, u, ip, q.reason);
  }
  @Post(':id/transition') @HttpCode(200)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.transition(id, dto, u, ip);
  }
}

@Module({ imports: [LocationsModule], controllers: [PublicArticlesController, NewsroomArticlesController], providers: [ArticlesService], exports: [ArticlesService] })
export class ArticlesModule {}
