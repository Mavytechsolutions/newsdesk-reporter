import { captureRef } from 'react-native-view-shot';
import Share from 'react-native-share';

/** Takes a picture of the card and opens WhatsApp (or the share sheet) with picture + text. */
export async function captureAndShare(ref: React.RefObject<any>, message: string, title: string, via: 'any' | 'whatsapp') {
  const uri = await captureRef(ref, { format: 'jpg', quality: 0.9, width: 1080, result: 'tmpfile' });
  if (via === 'whatsapp') {
    try {
      await Share.shareSingle({ social: Share.Social.WHATSAPP as any, url: uri, type: 'image/jpeg', message, filename: 'mavy-news' });
      return;
    } catch (e: any) {
      if (String(e?.message ?? e).toLowerCase().includes('cancel')) return;
      // WhatsApp not installed: fall through to the normal share sheet with the picture
    }
  }
  await Share.open({ url: uri, type: 'image/jpeg', message, title, failOnCancel: false });
}
