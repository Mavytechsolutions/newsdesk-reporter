/**
 * Sharing a story as a branded MAVY NEWS picture: we draw a card off-screen,
 * take a picture of it, and send picture + headline + link to WhatsApp (or any app).
 * If anything fails (no WhatsApp, web preview, old phone), we fall back to sharing text.
 */
import React, { useEffect, useRef } from 'react';
import { Platform, Share as RNShare, StyleSheet, View, Linking } from 'react-native';
import { Image } from 'expo-image';
import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import type { ArticleCard } from '../api/types';
import { api } from '../api/client';
import { captureAndShare } from './capture';
import { T } from '../components/ui';

type Via = 'any' | 'whatsapp';
interface Req { a: ArticleCard; via: Via; done: () => void }
const useShareQueue = create<{ req: Req | null }>(() => ({ req: null }));

const shareText = (a: ArticleCard) => `${a.headline}\n\n${a.summary}\n\n👉 ${a.shareUrl}\n— MAVY NEWS`;

async function textOnly(a: ArticleCard, via: Via) {
  const text = shareText(a);
  if (via === 'whatsapp') {
    const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
    if (await Linking.canOpenURL(url).catch(() => false)) return Linking.openURL(url);
  }
  await RNShare.share({ message: text, title: a.headline }).catch(() => undefined);
}

/** Public entry point used by every share button. */
export async function shareArticle(a: ArticleCard, via: Via = 'any') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  api(`/articles/${a.id}/share`, { method: 'POST' }).catch(() => undefined);
  if (Platform.OS === 'web') return textOnly(a, via);
  await new Promise<void>((resolve) => {
    useShareQueue.setState({ req: { a, via, done: resolve } });
    setTimeout(resolve, 15000); // never leave the button stuck
  });
}

/** Mount once near the root of the app. Renders the picture card off-screen when a share is requested. */
export function ShareCardHost() {
  const req = useShareQueue((s) => s.req);
  const ref = useRef<any>(null);
  const imageReady = useRef(false);

  useEffect(() => {
    if (!req) return;
    imageReady.current = !req.a.heroImageUrl;
    let cancelled = false;
    (async () => {
      // wait (max ~2.5 s) for the photo to load so it appears in the picture
      for (let i = 0; i < 25 && !imageReady.current; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 120)); // one more frame for layout
      try {
        await captureAndShare(ref, shareText(req.a), req.a.headline, req.via);
      } catch {
        if (!cancelled) await textOnly(req.a, req.via);
      } finally {
        req.done();
        useShareQueue.setState({ req: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [req]);

  if (!req) return null;
  const a = req.a;
  const te = a.language === 'te';
  return (
    <View style={styles.offscreen} pointerEvents="none">
      <View ref={ref} collapsable={false} style={styles.card}>
        <View style={styles.top}>
          <T bold size={18} color="#fff" style={{ letterSpacing: 1 }}>MAVY <T bold size={18} color="#16A34A">NEWS</T></T>
          <T size={11} color="rgba(255,255,255,0.85)" style={{ fontFamily: 'NotoSansTelugu_400Regular' }}>మీ ఊరి వార్తలు · హైపర్ లోకల్</T>
        </View>
        {a.heroImageUrl ? (
          <Image source={{ uri: a.heroImageUrl }} style={{ width: '100%', height: 200 }} contentFit="cover"
            onLoad={() => (imageReady.current = true)} onError={() => (imageReady.current = true)} />
        ) : (
          <View style={styles.noPhoto}>
            <T bold size={24} color="#fff" style={{ fontFamily: 'NotoSansTelugu_700Bold' }}>{te ? a.category.nameTe : a.category.nameEn}</T>
          </View>
        )}
        <View style={{ padding: 14 }}>
          {a.isBreaking && <View style={styles.breaking}><T bold size={11} color="#fff">{te ? 'బ్రేకింగ్' : 'BREAKING'}</T></View>}
          <T bold size={19} color="#0B1220" style={{ lineHeight: 29, fontFamily: te ? 'NotoSansTelugu_700Bold' : undefined }}>{a.headline}</T>
          <T size={14.5} color="#28303F" style={{ marginTop: 6, lineHeight: 24, fontFamily: te ? 'NotoSansTelugu_400Regular' : undefined }} numberOfLines={9}>
            {a.summary}
          </T>
        </View>
        <View style={styles.footer}>
          <T size={11} color="#fff" style={{ flex: 1, fontFamily: 'NotoSansTelugu_400Regular' }}>
            {te ? 'పూర్తి వార్త MAVY NEWS యాప్‌లో' : 'Full story on the MAVY NEWS app'}
          </T>
          <View style={styles.badge}><T bold size={11} color="#0B1F3A">MAVY NEWS</T></View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Far off-screen but still rendered, so it can be captured.
  offscreen: { position: 'absolute', left: -2000, top: 0, width: 360 },
  card: { width: 360, backgroundColor: '#fff' },
  top: { backgroundColor: '#0B1F3A', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noPhoto: { height: 150, backgroundColor: '#0B1F3A', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  breaking: { alignSelf: 'flex-start', backgroundColor: '#D7262E', borderRadius: 4, paddingHorizontal: 7, marginBottom: 6 },
  footer: { backgroundColor: '#0B1F3A', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  badge: { backgroundColor: '#16A34A', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
});
