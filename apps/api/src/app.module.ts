import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Pool } from 'pg';
import { DbModule, PG_POOL } from './db/db.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { UsersModule } from './users/users.module';
import { StaffModule } from './staff/staff.module';
import { LocationsModule } from './locations/locations.module';
import { CategoriesModule } from './categories/categories.module';
import { ArticlesModule } from './articles/articles.module';
import { FeedModule } from './articles/feed.module';
import { CommunityModule } from './articles/community.module';
import { WebPageModule } from './articles/web-page.module';
import { Public } from './common/auth.decorators';

@Controller('health')
@Public()
class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  @Get() async health() {
    try {
      await this.pool.query('select 1');
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule, AuditModule, AuthModule, LocationsModule, CategoriesModule, UsersModule, StaffModule, ArticlesModule, FeedModule, CommunityModule, WebPageModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
