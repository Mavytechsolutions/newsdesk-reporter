import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, Patch, Put } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
import { Db, InjectDb } from '../db/db.module';
import { bookmarks, categories, comments, dislikes, likes, readEvents, userCategories, userLocations, users } from '../db/schema';
import { AuthUser, ClientIp, CurrentUser } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';
import { LocationsModule, LocationsService } from '../locations/locations.module';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsUrl({ protocols: ['https'] }) photoUrl?: string;
  @IsOptional() @IsIn(['te', 'en']) language?: 'te' | 'en';
  @IsOptional() @IsBoolean() notifyBreaking?: boolean;
  @IsOptional() @IsBoolean() notifyDistrict?: boolean;
}
class SetLocationsDto {
  @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) locationIds: string[];
  @IsOptional() @IsUUID() primaryId?: string;
}
class SetCategoriesDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) categoryIds: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly locationsSvc: LocationsService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async me(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { passwordHash: false, googleId: false, appleId: false },
      with: { locations: { with: { location: true } }, categories: { with: { category: true } } },
    });
    return {
      ...user,
      locations: user!.locations.map((l) => ({ ...l.location, isPrimary: l.isPrimary })),
      categories: user!.categories.map((c) => c.category),
    };
  }

  async update(userId: string, dto: UpdateProfileDto) {
    if (dto.name !== undefined) {
      // a journalist's name is checked against their Aadhaar and appears on every story: only the admin can change it
      const [u] = await this.db.select({ level: users.contributorLevel, name: users.name }).from(users).where(eq(users.id, userId));
      if (u?.level && dto.name.trim() !== (u.name ?? '')) throw new BadRequestException('Your name is verified as a MAVY NEWS journalist. Ask the admin to change it.');
    }
    await this.db.update(users).set({ ...dto, updatedAt: new Date() }).where(eq(users.id, userId));
    return this.me(userId);
  }

  async setLocations(userId: string, dto: SetLocationsDto) {
    if (dto.primaryId && !dto.locationIds.includes(dto.primaryId)) throw new BadRequestException('primaryId must be one of locationIds');
    await this.locationsSvc.requireAll(dto.locationIds);
    await this.db.transaction(async (tx) => {
      await tx.delete(userLocations).where(eq(userLocations.userId, userId));
      if (dto.locationIds.length)
        await tx.insert(userLocations).values([...new Set(dto.locationIds)].map((locationId, i) => ({
          userId, locationId, isPrimary: dto.primaryId ? dto.primaryId === locationId : i === 0,
        })));
    });
    return this.me(userId);
  }

  async setCategories(userId: string, dto: SetCategoriesDto) {
    const ids = [...new Set(dto.categoryIds)];
    if (ids.length) {
      const found = await this.db.select({ id: categories.id }).from(categories).where(and(inArray(categories.id, ids), eq(categories.active, true)));
      if (found.length !== ids.length) throw new BadRequestException('One or more categories do not exist');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(userCategories).where(eq(userCategories.userId, userId));
      if (ids.length) await tx.insert(userCategories).values(ids.map((categoryId) => ({ userId, categoryId })));
    });
    return this.me(userId);
  }

  /** DPDP: erase personal data, keep an anonymous row so published bylines/audit stay consistent. */
  async deleteAccount(userId: string, ip: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(userLocations).where(eq(userLocations.userId, userId));
      await tx.delete(userCategories).where(eq(userCategories.userId, userId));
      await tx.delete(bookmarks).where(eq(bookmarks.userId, userId));
      await tx.delete(likes).where(eq(likes.userId, userId));
      await tx.delete(dislikes).where(eq(dislikes.userId, userId));
      await tx.update(comments).set({ status: 'HIDDEN' }).where(eq(comments.userId, userId));
      await tx.execute(sql`update articles a set comment_count = (select count(*) from comments c where c.article_id = a.id and c.status = 'VISIBLE')
        where a.id in (select article_id from comments where user_id = ${userId})`);
      await tx.delete(readEvents).where(eq(readEvents.userId, userId));
      await this.auth.revokeAll(userId, tx as unknown as Db);
      await tx.update(users).set({
        phone: null, email: null, name: null, photoUrl: null, googleId: null, appleId: null, passwordHash: null,
        status: 'DELETED', deletedAt: new Date(), updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await this.audit.log({ actorId: userId, action: 'user.delete_account', entity: 'user', entityId: userId, ip }, tx as unknown as Db);
    });
    return { deleted: true };
  }
}

@Controller('me')
class MeController {
  constructor(private readonly svc: UsersService) {}
  /** sessionRole = what this login may do right now (phone/OTP logins are always READER; email+password gives newsroom powers) */
  @Get() async me(@CurrentUser() u: AuthUser) { return { ...(await this.svc.me(u.id)), sessionRole: u.role }; }
  @Patch() update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) { return this.svc.update(u.id, dto); }
  @Put('locations') setLocations(@CurrentUser() u: AuthUser, @Body() dto: SetLocationsDto) { return this.svc.setLocations(u.id, dto); }
  @Put('categories') setCategories(@CurrentUser() u: AuthUser, @Body() dto: SetCategoriesDto) { return this.svc.setCategories(u.id, dto); }
  @Delete() @HttpCode(200) remove(@CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.deleteAccount(u.id, ip); }
}

@Module({ imports: [LocationsModule], controllers: [MeController], providers: [UsersService] })
export class UsersModule {}
