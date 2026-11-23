import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ArticleCard } from '../api/types';
import { useTheme } from '../theme';
import { T, IconBtn } from './ui';
import { timeAgo, useName, useT } from '../i18n';
import { useSettings } from '../store/settings';
import { shareArticle, useToggleSave } from '../api/hooks';

/** Shown when a story has no photo: brand colour block with the category name. */
export function HeroImage({ a, height }: { a: ArticleCard; height: number }) {
  const th = useTheme();
  const name = useName();
  if (a.heroImageUrl)
    return <Image source={{ uri: a.heroImageUrl }} style={{ width: '100%', height }} contentFit="cover" transition={200} cachePolicy="memory-disk" accessibilityLabel={a.headline} />;
  return (
    <View style={{ width: '100%', height, backgroundColor: a.isBreaking ? th.red : th.navy, alignItems: 'center', justifyContent: 'center' }}>
      <T bold color="#fff" size={13} style={{ opacity: 0.7, letterSpacing: 2 }}>MAVY NEWS</T>
      <T bold color="#fff" size={22}>{name(a.category)}</T>
    </View>
  );
}

export function Meta({ a, light }: { a: ArticleCard; light?: boolean }) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const color = light ? 'rgba(255,255,255,0.85)' : th.muted;
  const place = a.locations[0] ? name(a.locations[0]) : '';
  return (
    <View style={styles.metaRow}>
      {a.isBreaking && <View style={[styles.badge, { backgroundColor: th.red }]}><T bold size={11} color="#fff">{t.breaking}</T></View>}
      {a.sourceType === 'CITIZEN' && <View style={[styles.badge, { backgroundColor: th.citizen }]}><T bold size={11} color="#fff">{t.citizen}</T></View>}
      <T size={12} color={color}>{[name(a.category), place, timeAgo(a.publishedAt, t)].filter(Boolean).join(' · ')}</T>
    </View>
  );
}

export function CardActions({ a, light }: { a: ArticleCard; light?: boolean }) {
  const th = useTheme();
  const t = useT();
  const saved = useSettings((s) => s.saved.some((x) => x.id === a.id));
  const toggleSave = useToggleSave();
  const c = light ? '#fff' : th.muted;
  return (
    <View style={styles.actions}>
      <IconBtn label={t.whatsapp} name="logo-whatsapp" color={light ? '#fff' : '#25D366'} onPress={() => shareArticle(a, 'whatsapp')} />
      <IconBtn label={t.share} name="share-social-outline" color={c} onPress={() => shareArticle(a)} />
      <IconBtn label={saved ? t.saved : t.save} name={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? th.green : c} onPress={() => toggleSave(a, !saved)} />
    </View>
  );
}

/** Compact feed card: photo, headline, short summary, meta and actions. */
export function NewsCard({ a, onPress }: { a: ArticleCard; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, { backgroundColor: th.card, opacity: pressed ? 0.92 : 1 }]}>
      <HeroImage a={a} height={180} />
      <View style={{ padding: 14 }}>
        <Meta a={a} />
        <T bold size={18} style={{ marginTop: 6 }}>{a.headline}</T>
        <T color={th.muted} size={14} numberOfLines={3} style={{ marginTop: 6 }}>{a.summary}</T>
        <View style={styles.footer}>
          <T size={12} color={th.muted} numberOfLines={1} style={{ flex: 1 }}>{a.reporter ? `✍ ${a.reporter}` : a.sourceLabel}</T>
          <CardActions a={a} />
        </View>
      </View>
    </Pressable>
  );
}

/** Full-screen card for the immersive swipe feed (Inshorts style). */
export function ImmersiveCard({ a, height, onPress }: { a: ArticleCard; height: number; onPress: () => void }) {
  const th = useTheme();
  const t = useT();
  return (
    <View style={{ height, backgroundColor: th.card }}>
      <HeroImage a={a} height={Math.round(height * 0.42)} />
      <View style={{ flex: 1, padding: 18 }}>
        <Meta a={a} />
        <T bold size={21} style={{ marginTop: 8 }}>{a.headline}</T>
        <T size={16} style={{ marginTop: 10 }} numberOfLines={8}>{a.summary}</T>
        <View style={{ flex: 1 }} />
        <T size={12} color={th.muted}>{a.reporter ? `${t.by}: ${a.reporter} · ` : ''}{a.sourceLabel}</T>
        <View style={[styles.footer, { marginTop: 6 }]}>
          <Pressable onPress={onPress} accessibilityRole="button" style={styles.readMore}>
            <T bold color={th.green}>{t.readMore}</T>
            <Ionicons name="arrow-forward" size={16} color={th.green} style={{ marginLeft: 4 }} />
          </Pressable>
          <CardActions a={a} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', marginHorizontal: 12, marginBottom: 14, elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  readMore: { flexDirection: 'row', alignItems: 'center', flex: 1 },
});
