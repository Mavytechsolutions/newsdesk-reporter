import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required setting ${name} in .env`);
  return v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  return v ? Number(v) : def;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtlDays: num('REFRESH_TTL_DAYS', 30),
  smsProvider: process.env.SMS_PROVIDER ?? 'console',
  msg91AuthKey: process.env.MSG91_AUTH_KEY ?? '',
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID ?? '',
  otpTtlSeconds: num('OTP_TTL_SECONDS', 300),
  otpMaxPerHour: num('OTP_MAX_PER_HOUR', 5),
  otpMaxAttempts: num('OTP_MAX_ATTEMPTS', 5),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  enableScheduler: process.env.DISABLE_SCHEDULER !== '1',
  /** Public address of this server, used in shared story links (e.g. http://194.238.17.81:8474 or https://api.mavynews.in) */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? `http://localhost:${num('PORT', 4000)}`).replace(/\/$/, ''),
  /** Where people can get the app (shown on shared story pages) */
  appDownloadUrl: process.env.APP_DOWNLOAD_URL ?? '',
};

if (config.env === 'production') {
  if (config.jwtAccessSecret.length < 32 || config.jwtAccessSecret.startsWith('change-me'))
    throw new Error('Set a strong JWT_ACCESS_SECRET for production');
  if (config.smsProvider === 'console') throw new Error('SMS_PROVIDER=console is not allowed in production');
}
