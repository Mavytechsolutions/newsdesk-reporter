import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { and, desc, eq, lt, SQL } from 'drizzle-orm';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Db, InjectDb } from '../db/db.module';
import { auditLogs } from '../db/schema';
import { Roles } from '../common/auth.decorators';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(e: AuditEntry, tx: Db = this.db) {
    await tx.insert(auditLogs).values({
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      metadata: e.metadata ?? null,
      ip: e.ip ?? null,
    });
  }

  async list(q: AuditQuery) {
    const where: SQL[] = [];
    if (q.entity) where.push(eq(auditLogs.entity, q.entity));
    if (q.entityId) where.push(eq(auditLogs.entityId, q.entityId));
    if (q.actorId) where.push(eq(auditLogs.actorId, q.actorId));
    if (q.before) where.push(lt(auditLogs.createdAt, new Date(q.before)));
    const limit = q.limit ?? 50;
    const rows = await this.db.select().from(auditLogs).where(and(...where)).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return { items: rows, nextBefore: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null };
  }
}

class AuditQuery {
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@Controller('admin/audit-logs')
@Roles('SUPER_ADMIN', 'MANAGING_EDITOR')
class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() list(@Query() q: AuditQuery) {
    return this.audit.list(q);
  }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
