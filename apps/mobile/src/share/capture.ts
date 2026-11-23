
/** Web preview: picture sharing is not available, the caller falls back to text. */
export async function captureAndShare(_ref: React.RefObject<any>, _message: string, _title: string, _via: 'any' | 'whatsapp'): Promise<void> {
  throw new Error('Picture sharing is only available in the phone app');
}
