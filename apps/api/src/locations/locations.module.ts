import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, SQL } from 'drizzle-orm';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Db, InjectDb } from '../db/db.module';
import { locations, locationTypeEnum } from '../db/schema';
import { Public } from '../common/auth.decorators';

@Injectable()
export class LocationsService {
  constructor(@InjectDb() private readonly db: Db) {}

  list(parentId?: string, type?: string) {
    const where: SQL[] = [parentId ? eq(locations.parentId, parentId) : type ? eq(locations.type, type as any) : isNull(locations.parentId)];
    if (parentId && type) where.push(eq(locations.type, type as any));
    return this.db.select().from(locations).where(and(...where)).orderBy(asc(locations.nameEn));
  }

  async get(id: string) {
    const [loc] = await this.db.select().from(locations).where(eq(locations.id, id));
    if (!loc) throw new NotFoundException('Location not found');
    const ancestorIds = loc.path.split('/').filter((x) => x && x !== id);
    const breadcrumb = ancestorIds.length ? await this.db.select().from(locations).where(inArray(locations.id, ancestorIds)) : [];
    breadcrumb.sort((a, b) => a.path.length - b.path.length);
    return { ...loc, breadcrumb };
  }

  search(q: string) {
    const term = `%${q.replace(/[%_]/g, '')}%`;
    return this.db.select().from(locations).where(or(ilike(locations.nameEn, term), ilike(locations.nameTe, term))).orderBy(asc(locations.nameEn)).limit(30);
  }

  /** Loads the given ids and checks they all exist. */
  async requireAll(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.select().from(locations).where(inArray(locations.id, ids));
    if (rows.length !== new Set(ids).size) throw new NotFoundException('One or more locations do not exist');
    return rows;
  }
}

/** True if `path` (a location's materialised path) lies inside any of the given ancestor ids. */
export function isWithinAny(path: string, ancestorIds: string[]) {
  return ancestorIds.some((id) => path.includes(`/${id}/`));
}

class ListQuery {
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsIn(locationTypeEnum.enumValues) type?: string;
}
class SearchQuery { @IsString() @MinLength(2) q: string; }

@Controller('locations')
@Public()
class LocationsController {
  constructor(private readonly svc: LocationsService) {}
  @Get() list(@Query() q: ListQuery) { return this.svc.list(q.parentId, q.type); }
  @Get('search') search(@Query() q: SearchQuery) { return this.svc.search(q.q); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }
}

@Module({ controllers: [LocationsController], providers: [LocationsService], exports: [LocationsService] })
export class LocationsModule {}
