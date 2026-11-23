import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { AuthUser, IS_PUBLIC, ROLES, STAFF_ROLES } from './auth.decorators';
import { config } from '../config';
import { Db, InjectDb } from '../db/db.module';
import { users, staffProfiles, Role } from '../db/schema';

/**
 * Global guard:
 *  1. Reads the Bearer token (if any) and attaches req.user.
 *  2. Blocks non-public routes without a valid token.
 *  3. Enforces @Roles() and re-checks staff are still active (suspension takes effect immediately).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectDb() private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);

    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (token) {
      try {
        const p = await this.jwt.verifyAsync(token, { secret: config.jwtAccessSecret });
        req.user = { id: p.sub, role: p.role, guest: p.role === 'GUEST', otp: p.amr === 'otp' } satisfies AuthUser;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Session expired. Please log in again.');
      }
    }

    if (isPublic) return true;
    const user: AuthUser | undefined = req.user;
    if (!user) throw new UnauthorizedException('Please log in.');

    if (roles?.length) {
      if (!roles.includes(user.role as Role)) throw new ForbiddenException('You do not have permission for this action.');
    } else if (user.guest) {
      throw new ForbiddenException('Please log in with your phone number to use this feature.');
    }

    if (!user.guest) {
      const [row] = await this.db
        .select({ status: users.status, role: users.role, suspendedAt: staffProfiles.suspendedAt, revokedAt: staffProfiles.revokedAt })
        .from(users)
        .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
        .where(eq(users.id, user.id));
      if (!row || row.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active.');
      if (!user.otp && STAFF_ROLES.includes(row.role) && (row.suspendedAt || row.revokedAt))
        throw new ForbiddenException('Your newsroom access is suspended.');
      // role changes take effect immediately; phone (OTP) sessions always stay reader sessions
      user.role = user.otp && STAFF_ROLES.includes(row.role) ? 'READER' : row.role;
      if (roles?.length && !roles.includes(user.role as Role)) throw new ForbiddenException('You do not have permission for this action.');
    }
    return true;
  }
}
