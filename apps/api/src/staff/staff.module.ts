import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Db, InjectDb } from '../db/db.module';
import { staffAssignments, staffProfiles, users, Role } from '../db/schema';
import { AuthUser, ClientIp, CurrentUser, Roles, STAFF_ROLES } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';
import { normalizeIndianPhone } from '../common/text';
import { LocationsModule, LocationsService } from '../locations/locations.module';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,}$/;

class CreateStaffDto {
  @IsEmail() email: string;
  @IsString() @Matches(PASSWORD_RULE, { message: 'Password must be at least 10 characters with letters and numbers' }) password: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsIn(STAFF_ROLES) role: Role;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) locationIds?: string[];
  /** Mobile number, so this person can also log in to the app with OTP and see their own byline. */
  @IsOptional() @IsString() @MaxLength(16) phone?: string;
}
class UpdateStaffDto {
  @IsOptional() @IsIn(STAFF_ROLES) role?: Role;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) locationIds?: string[];
  @IsOptional() @IsIn(['suspend', 'reactivate', 'revoke']) action?: 'suspend' | 'reactivate' | 'revoke';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@Injectable()
export class StaffService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly locationsSvc: LocationsService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list() {
    const rows = await this.db.query.staffProfiles.findMany({
      with: { user: { columns: { id: true, email: true, name: true, phone: true, role: true, status: true } }, assignments: { with: { location: true } } },
      orderBy: desc(staffProfiles.createdAt),
    });
    return rows.map((s) => ({ ...s, assignments: s.assignments.map((a) => a.location) }));
  }

  async create(dto: CreateStaffDto, actor: AuthUser, ip: string) {
    const email = dto.email.toLowerCase().trim();
    const [exists] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new ConflictException('A user with this email already exists');
    await this.locationsSvc.requireAll(dto.locationIds ?? []);
    let phone: string | null = null;
    if (dto.phone) {
      phone = normalizeIndianPhone(dto.phone);
      if (!phone) throw new BadRequestException('Enter a valid 10-digit Indian mobile number');
    }
    const [byPhone] = phone ? await this.db.select().from(users).where(eq(users.phone, phone)) : [];
    if (byPhone && byPhone.role !== 'READER') throw new ConflictException('This mobile number already belongs to a staff member');
    const passwordHash = await AuthService.hashPassword(dto.password);
    const id = await this.db.transaction(async (tx) => {
      const [u] = byPhone
        // the person already uses the app as a reader: upgrade that same account
        ? await tx.update(users).set({ email, passwordHash, name: dto.name, role: dto.role, status: 'ACTIVE', updatedAt: new Date() }).where(eq(users.id, byPhone.id)).returning({ id: users.id })
        : await tx.insert(users).values({ email, phone, passwordHash, name: dto.name, role: dto.role, language: 'te' }).returning({ id: users.id });
      await tx.insert(staffProfiles).values({ userId: u.id, designation: dto.designation, verified: true });
      if (dto.locationIds?.length) await tx.insert(staffAssignments).values(dto.locationIds.map((locationId) => ({ staffId: u.id, locationId })));
      await this.audit.log({ actorId: actor.id, action: 'staff.create', entity: 'user', entityId: u.id, metadata: { role: dto.role, locationIds: dto.locationIds }, ip }, tx as unknown as Db);
      return u.id;
    });
    return this.get(id);
  }

  async get(id: string) {
    const s = await this.db.query.staffProfiles.findFirst({
      where: eq(staffProfiles.userId, id),
      with: { user: { columns: { id: true, email: true, name: true, phone: true, role: true, status: true } }, assignments: { with: { location: true } } },
    });
    if (!s) throw new NotFoundException('Staff member not found');
    return { ...s, assignments: s.assignments.map((a) => a.location) };
  }

  async update(id: string, dto: UpdateStaffDto, actor: AuthUser, ip: string) {
    const before = await this.get(id);
    if (id === actor.id && (dto.action || dto.role)) throw new BadRequestException('You cannot change your own role or access');
    if (dto.locationIds) await this.locationsSvc.requireAll(dto.locationIds);
    await this.db.transaction(async (tx) => {
      if (dto.role) await tx.update(users).set({ role: dto.role, updatedAt: new Date() }).where(eq(users.id, id));
      const profile: Partial<typeof staffProfiles.$inferInsert> = {};
      if (dto.designation !== undefined) profile.designation = dto.designation;
      if (dto.verified !== undefined) profile.verified = dto.verified;
      if (dto.action === 'suspend') profile.suspendedAt = new Date();
      if (dto.action === 'reactivate') { profile.suspendedAt = null; profile.revokedAt = null; }
      if (dto.action === 'revoke') profile.revokedAt = new Date();
      if (Object.keys(profile).length) await tx.update(staffProfiles).set(profile).where(eq(staffProfiles.userId, id));
      if (dto.action === 'suspend' || dto.action === 'revoke') await this.auth.revokeAll(id, tx as unknown as Db);
      if (dto.locationIds) {
        await tx.delete(staffAssignments).where(eq(staffAssignments.staffId, id));
        if (dto.locationIds.length) await tx.insert(staffAssignments).values(dto.locationIds.map((locationId) => ({ staffId: id, locationId })));
      }
      await this.audit.log({
        actorId: actor.id, action: dto.action ? `staff.${dto.action}` : 'staff.update', entity: 'user', entityId: id, ip,
        metadata: { before: { role: before.user.role, assignments: before.assignments.map((a) => a.id) }, change: dto },
      }, tx as unknown as Db);
    });
    return this.get(id);
  }
}

@Controller('admin/staff')
@Roles('SUPER_ADMIN')
class StaffController {
  constructor(private readonly svc: StaffService) {}
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@Body() dto: CreateStaffDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) { return this.svc.create(dto, u, ip); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentUser() u: AuthUser, @ClientIp() ip: string) {
    return this.svc.update(id, dto, u, ip);
  }
}

@Module({ imports: [LocationsModule], controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
