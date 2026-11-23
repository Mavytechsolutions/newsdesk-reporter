import { Body, Controller, Global, HttpCode, Module, NotImplementedException, Post } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { createSmsProvider, SMS_PROVIDER } from './sms/sms.provider';
import { ClientIp, Public } from '../common/auth.decorators';

class OtpRequestDto { @IsString() @Length(10, 16) phone: string; }
class OtpVerifyDto { @IsString() @Length(10, 16) phone: string; @IsString() @Length(6, 6) code: string; }
class StaffLoginDto { @IsEmail() email: string; @IsString() @MinLength(8) password: string; }
class RefreshDto { @IsString() @MinLength(20) refreshToken: string; }
class SocialDto { @IsString() idToken: string; }

@Controller('auth')
@Public()
class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() dto: OtpRequestDto, @ClientIp() ip: string) {
    return this.auth.requestOtp(dto.phone, ip);
  }

  @Post('otp/verify') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyOtp(@Body() dto: OtpVerifyDto, @ClientIp() ip: string) {
    return this.auth.verifyOtp(dto.phone, dto.code, ip);
  }

  @Post('guest') @HttpCode(200)
  guest() {
    return this.auth.guest();
  }

  @Post('staff/login') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  staffLogin(@Body() dto: StaffLoginDto, @ClientIp() ip: string) {
    return this.auth.staffLogin(dto.email, dto.password, ip);
  }

  @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout') @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  /** Phase 2: verify Google ID token with GOOGLE_CLIENT_ID, then link/create user by googleId. */
  @Post('google') google(@Body() _dto: SocialDto) {
    throw new NotImplementedException('Google login is switched on in Phase 2 (needs GOOGLE_CLIENT_ID).');
  }

  /** Phase 2: verify Apple identity token against Apple public keys, then link/create user by appleId. */
  @Post('apple') apple(@Body() _dto: SocialDto) {
    throw new NotImplementedException('Apple login is switched on in Phase 2 (needs Apple Developer account).');
  }
}

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, { provide: SMS_PROVIDER, useFactory: createSmsProvider }],
  exports: [AuthService, JwtModule, SMS_PROVIDER],
})
export class AuthModule {}
