import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { categories } from '../db/schema';
import { Public } from '../common/auth.decorators';

@Injectable()
export class CategoriesService {
  constructor(@InjectDb() private readonly db: Db) {}
  list() {
    return this.db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sortOrder));
  }
}

@Controller('categories')
@Public()
class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}
  @Get() list() { return this.svc.list(); }
}

@Module({ controllers: [CategoriesController], providers: [CategoriesService], exports: [CategoriesService] })
export class CategoriesModule {}
