import { Logger } from '@nestjs/common';
import { config } from '../../config';

/** Any SMS gateway (MSG91, Twilio, 2Factor…) implements this. */
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** Development only: prints the OTP in the server window. Blocked in production. */
export class ConsoleSmsProvider implements SmsProvider {
  private readonly log = new Logger('SMS');
  /** Last code per phone, so automated tests can read it. */
  readonly sent = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.sent.set(phone, code);
    this.log.warn(`DEV OTP for ${phone}: ${code}`);
  }
}

/**
 * MSG91 OTP API. Requires MSG91_AUTH_KEY and a DLT-approved MSG91_TEMPLATE_ID
 * whose text contains the ##OTP## variable.
 */
export class Msg91SmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string) {
    if (!config.msg91AuthKey || !config.msg91TemplateId) throw new Error('MSG91 credentials are not configured');
    const res = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: config.msg91AuthKey },
      body: JSON.stringify({ template_id: config.msg91TemplateId, mobile: phone.replace('+', ''), otp: code }),
    });
    if (!res.ok) throw new Error(`MSG91 error ${res.status}`);
  }
}

export function createSmsProvider(): SmsProvider {
  switch (config.smsProvider) {
    case 'msg91':
      return new Msg91SmsProvider();
    case 'console':
      return new ConsoleSmsProvider();
    default:
      throw new Error(`Unknown SMS_PROVIDER "${config.smsProvider}"`);
  }
}
