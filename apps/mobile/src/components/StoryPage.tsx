/**
 * MAVY NEWS full-screen story card (own MAVY design):
 *  - photo with the category label and a "place · time" label on it
 *  - a rounded story sheet that overlaps the photo, with a category-coloured accent line beside the headline
 *  - reporter badge (initials) and a "Read full story" button
 *  - a thin category-coloured progress line on the right edge (how far you are in the feed)
 *  - a floating dock: green WhatsApp "Send" button, a capsule with like / dislike / comments / more, and share
 * Tap the story to show/hide the app bars; swipe left to open the full story.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useNavigation } from '@react-navigation/native';
import type { ArticleCard } from '../api/types';
import { HeroImage } from './NewsCard';
import { Button, T } from './ui';
import { categoryColor, useFont, useTheme } from '../theme';
import { timeAgo, useName, useT } from '../i18n';
import { useSettings } from '../store/settings';
import { reportArticle, shareArticle, useReaction, useToggleSave } from '../api/hooks';

const initials = (name?: string | null) =>
  (name || 'MAVY').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function StoryPage({ a, height, index, total, onTap }: { a: ArticleCard; height: number; index: number; total?: number; onTap?: () => void }) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const nav = useNavigation<any>();
  const [menu, setMenu] = useState(false);
  const r = useReaction(a, () => nav.navigate('Login'));
  const open = () => nav.navigate('Article', { slug: a.slug });
  const accent = categoryColor(a.category.slug);

  // Swipe left on the story to open the full story (the card follows your finger a little).
  const dx = useRef(new Animated.Value(0)).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
        onPanResponderMove: (_, g) => dx.setValue(Math.max(-120, Math.min(0, g.dx))),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -70) open();
          Animated.spring(dx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.slug],
  );
  const hint = dx.interpolate({ inputRange: [-120, -30, 0], outputRange: [1, 0.3, 0] });
  const imageH = Math.round(height * 0.46);
  const place = a.locations[0] ? name(a.locations[0]) : '';
  const DOCK = 76;
  const summaryLines = Math.max(3, Math.floor((height - imageH - 150 - DOCK) / 28));
  const progress = total ? Math.min(1, (index + 1) / total) : 0;

  return (
    <View style={{ height, backgroundColor: th.card }}>
      <Animated.View style={{ position: 'absolute', right: 14, top: imageH + 40, opacity: hint, alignItems: 'center', zIndex: 2 }} pointerEvents="none">
        <Ionicons name="chevron-back-circle" size={44} color={accent} />
        <T bold size={12} color={accent}>{t.readMore}</T>
      </Animated.View>

      <Animated.View style={{ flex: 1, transform: [{ translateX: dx }] }} {...pan.panHandlers}>
        <Pressable onPress={onTap ?? open} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={a.headline}>
          {/* photo with labels on it */}
          <View>
            <HeroImage a={a} height={imageH} instant />
            {a.heroImageCredit ? <T size={9} color="rgba(255,255,255,0.85)" style={styles.credit}>📷 {a.heroImageCredit}</T> : null}
            <View style={styles.photoLabels}>
              <View style={styles.row}>
                <View style={[styles.catPill, { backgroundColor: accent }]}><T bold size={12} color="#fff">{name(a.category)}</T></View>
                {a.isBreaking && <View style={[styles.catPill, { backgroundColor: th.red, marginLeft: 6 }]}><T bold size={12} color="#fff">● {t.breaking}</T></View>}
              </View>
              <View style={styles.glass}>
                <Ionicons name="location-sharp" size={12} color="#fff" />
                <T size={12} color="#fff" numberOfLines={1} style={{ marginLeft: 3, maxWidth: 150 }}>
                  {place ? `${place} · ` : ''}{timeAgo(a.publishedAt, t)}
                </T>
              </View>
            </View>
          </View>

          {/* rounded story sheet overlapping the photo */}
          <View style={[styles.storySheet, { backgroundColor: th.card }]}>
            {a.sourceType === 'CITIZEN' && (
              <View style={[styles.citizen, { borderColor: th.citizen }]}><T bold size={11} color={th.citizen}>👥 {t.citizen}</T></View>
            )}
            <View style={styles.headRow}>
              <View style={[styles.accentBar, { backgroundColor: accent }]} />
              <T bold size={20} style={{ lineHeight: 30, flex: 1 }} numberOfLines={3}>{a.headline}</T>
            </View>
            <T size={16.5} color={th.text} style={{ marginTop: 8, lineHeight: 28, opacity: 0.88 }} numberOfLines={summaryLines}>
              {a.summary}
            </T>
            <View style={styles.byline}>
              <View style={[styles.avatar, { backgroundColor: accent }]}><T bold size={12} color="#fff">{initials(a.reporter)}</T></View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <T bold size={12.5} numberOfLines={1}>{a.reporter || 'MAVY NEWS'}</T>
                <T size={11} color={th.muted} numberOfLines={1}>{a.sourceLabel}</T>
              </View>
              <Pressable onPress={open} hitSlop={8} accessibilityRole="link" style={[styles.readPill, { borderColor: accent }]}>
                <T bold size={12.5} color={accent}>{t.readMore}</T>
                <Ionicons name="arrow-forward" size={14} color={accent} style={{ marginLeft: 3 }} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>

      {/* progress line on the right edge */}
      {total ? (
        <View style={[styles.rail, { top: imageH + 24, bottom: DOCK + 8, backgroundColor: th.border }]} pointerEvents="none">
          <View style={{ height: `${progress * 100}%`, backgroundColor: accent, borderRadius: 2 }} />
        </View>
      ) : null}

      {/* floating action dock */}
      <View style={styles.dock}>
        <Pressable onPress={() => shareArticle(a, 'whatsapp')} accessibilityRole="button" accessibilityLabel={t.whatsapp}
          style={({ pressed }) => [styles.waPill, { opacity: pressed ? 0.85 : 1 }]}>
          <Ionicons name="logo-whatsapp" size={22} color="#fff" />
          <T bold size={14} color="#fff" style={{ marginLeft: 6 }}>{t.sendWa}</T>
        </Pressable>
        <View style={[styles.capsule, { backgroundColor: th.chip }]}>
          <DockBtn icon={r.liked ? 'heart' : 'heart-outline'} color={r.liked ? '#E11D48' : th.text} label={t.like} count={r.likeCount} onPress={r.like} />
          <DockBtn icon={r.disliked ? 'heart-dislike' : 'heart-dislike-outline'} color={r.disliked ? th.muted : th.text} label={t.dislike} count={r.dislikeCount} onPress={r.dislike} />
          <DockBtn icon="chatbubble-ellipses-outline" color={th.text} label={t.comments} count={a.commentCount}
            onPress={() => nav.navigate('Comments', { articleId: a.id, headline: a.headline })} />
          <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.more} style={styles.dockBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color={th.text} />
          </Pressable>
        </View>
        <Pressable onPress={() => shareArticle(a)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t.share}
          style={({ pressed }) => [styles.shareBtn, { backgroundColor: th.navy, opacity: pressed ? 0.85 : 1 }]}>
          <Ionicons name="paper-plane" size={18} color="#fff" />
        </Pressable>
      </View>

      <MoreSheet a={a} visible={menu} onClose={() => setMenu(false)} onOpen={() => { setMenu(false); open(); }} />
    </View>
  );
}

function DockBtn({ icon, color, label, count, onPress }: { icon: any; color: string; label: string; count: number; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} ${count}`} style={styles.dockBtn}>
      <Ionicons name={icon} size={21} color={color} />
      {count > 0 ? <T size={12} color={th.muted} style={{ marginLeft: 3 }}>{compact(count)}</T> : null}
    </Pressable>
  );
}

const compact = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** ⋮ menu: open full story, save, listen, report. */
export function MoreSheet({ a, visible, onClose, onOpen }: { a: ArticleCard; visible: boolean; onClose: () => void; onOpen?: () => void }) {
  const th = useTheme();
  const t = useT();
  const saved = useSettings((s) => s.saved.some((x) => x.id === a.id));
  const toggleSave = useToggleSave();
  const [reporting, setReporting] = useState(false);
  const close = () => { setReporting(false); onClose(); };
  const items: { icon: any; label: string; onPress: () => void; color?: string }[] = [
    ...(onOpen ? [{ icon: 'reader-outline', label: t.openStory, onPress: onOpen }] : []),
    { icon: saved ? 'bookmark' : 'bookmark-outline', label: saved ? t.saved : t.save, onPress: () => { toggleSave(a, !saved); close(); } },
    { icon: 'volume-high-outline', label: t.listen, onPress: () => {
      Speech.stop();
      Speech.speak(`${a.headline}. ${a.summary}`, { language: a.language === 'te' ? 'te-IN' : 'en-IN', rate: 0.95 });
      close();
    } },
    { icon: 'flag-outline', label: t.report, color: th.red, onPress: () => setReporting(true) },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: th.card }]}>
        <View style={[styles.grabber, { backgroundColor: th.border }]} />
        {reporting ? <ReportForm a={a} onDone={close} /> : items.map((it) => (
          <Pressable key={it.label} onPress={it.onPress} style={({ pressed }) => [styles.sheetRow, { opacity: pressed ? 0.6 : 1 }]} accessibilityRole="button">
            <Ionicons name={it.icon} size={22} color={it.color ?? th.text} />
            <T size={16} color={it.color} style={{ marginLeft: 14 }}>{it.label}</T>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const REASONS = ['FAKE', 'WRONG_INFO', 'OFFENSIVE', 'COPYRIGHT', 'PRIVACY', 'OTHER'] as const;

function ReportForm({ a, onDone }: { a: ArticleCard; onDone: () => void }) {
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  if (state === 'done')
    return (
      <View style={{ alignItems: 'center', padding: 16 }}>
        <Ionicons name="checkmark-circle" size={48} color={th.green} />
        <T style={{ textAlign: 'center', marginTop: 8 }}>{t.reportThanks}</T>
        <Button title={t.done} onPress={onDone} style={{ marginTop: 16, alignSelf: 'stretch' }} />
      </View>
    );
  return (
    <View>
      <T bold size={17} style={{ marginBottom: 8 }}>{t.reportTitle}</T>
      {REASONS.map((k) => (
        <Pressable key={k} onPress={() => setReason(k)} style={styles.reason} accessibilityRole="radio" accessibilityState={{ checked: reason === k }}>
          <Ionicons name={reason === k ? 'radio-button-on' : 'radio-button-off'} size={22} color={reason === k ? th.green : th.muted} />
          <T style={{ marginLeft: 10 }}>{(t as any)[`r${k}`]}</T>
        </Pressable>
      ))}
      <TextInput value={note} onChangeText={setNote} placeholder={t.reportNote} placeholderTextColor={th.muted} maxLength={1000} multiline
        style={[styles.note, { color: th.text, borderColor: th.border, fontFamily: font() }]} accessibilityLabel={t.reportNote} />
      {state === 'error' ? <T color={th.red} style={{ marginTop: 6 }}>{err}</T> : null}
      <Button title={t.reportSend} kind="danger" disabled={!reason} loading={state === 'sending'} style={{ marginTop: 12 }}
        onPress={async () => {
          setState('sending');
          try {
            await reportArticle(a.id, reason!, note);
            setState('done');
          } catch (e: any) {
            setErr(e?.message ?? 'Error');
            setState('error');
          }
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  credit: { position: 'absolute', right: 8, top: 8, textShadowColor: '#000', textShadowRadius: 3 },
  photoLabels: { position: 'absolute', left: 12, right: 12, bottom: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 14 },
  glass: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14 },
  storySheet: { marginTop: -20, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 16, flex: 1 },
  citizen: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, marginBottom: 6 },
  headRow: { flexDirection: 'row', alignItems: 'stretch' },
  accentBar: { width: 4, borderRadius: 2, marginRight: 10, marginVertical: 4 },
  byline: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  readPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  rail: { position: 'absolute', right: 4, width: 3, borderRadius: 2, overflow: 'hidden' },
  dock: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center' },
  waPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1FAF54', borderRadius: 24, paddingHorizontal: 14, height: 46, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  capsule: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: 24, height: 46, marginHorizontal: 8 },
  dockBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6 },
  shareBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  reason: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  note: { borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 70, marginTop: 8, fontSize: 15, textAlignVertical: 'top' },
});
