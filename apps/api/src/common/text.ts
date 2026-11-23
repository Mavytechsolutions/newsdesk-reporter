import { randomBytes } from 'crypto';

/** URL-safe slug that works for Telugu headlines too (falls back to a random id). */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  const suffix = randomBytes(3).toString('hex');
  return base ? `${base}-${suffix}` : `news-${suffix}`;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Indian mobile number → +91XXXXXXXXXX, or null if invalid. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}
