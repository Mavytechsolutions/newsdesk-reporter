/**
 * Full-screen story card (Way2News / Inshorts style): photo on top, headline, short summary,
 * time + "2 / 165", and an action bar with like, dislike, a big WhatsApp SHARE button,
 * comments, a ⋮ menu and share. Swipe up for the next story; tap the story for full text.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useNavigation } from '@react-navigation/native';
import type { ArticleCard } from '../api/types';
import { HeroImage } from './NewsCard';
import { Button, T } from './ui';
import { useFont, useTheme } from '../theme';
import { timeAgo, useName, useT } from '../i18n';
import { useSettings } from '../store/settings';
import { reportArticle, shareArticle, useReaction, useToggleSave } from '../api/hooks';

export function StoryPage({ a, height, index, total, onTap }: { a: ArticleCard; height: number; index: number; total?: number; onTap?: () => void }) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const nav = useNavigation<any>();
  const [menu, setMenu] = useState(false);
  const r = useReaction(a, () => nav.navigate('Login'));
  const open = () => nav.navigate('Article', { slug: a.slug });

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
  const imageH = Math.round(height * 0.42);
  const place = a.locations[0] ? name(a.locations[0]) : '';

  return (
    <View style={{ height, backgroundColor: th.card }}>
      <Animated.View style={{ position: 'absolute', right: 10, top: imageH + 30, opacity: hint, alignItems: 'center' }} pointerEvents="none">
        <Ionicons name="chevron-back-circle" size={44} color={th.green} />
        <T bold size={12} color={th.green}>{t.readMore}</T>
      </Animated.View>
      <Animated.View style={{ flex: 1, transform: [{ translateX: dx }] }} {...pan.panHandlers}>
      <Pressable onPress={onTap ?? open} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={a.headline}>
        <View>
          <HeroImage a={a} height={imageH} instant />
          <View style={[styles.brand, { backgroundColor: 'rgba(11,31,58,0.88)' }]}>
            <View style={[styles.brandIcon, { borderColor: th.green }]}><T bold size={10} color={th.green}>M</T></View>
            <T bold size={12} color="#fff" style={{ letterSpacing: 1 }}>MAVY <T bold size={12} color={th.green}>NEWS</T></T>
          </View>
          {a.heroImageCredit ? <T size={9} color="rgba(255,255,255,0.8)" style={styles.credit}>{a.heroImageCredit}</T> : null}
        </View>

        <View style={styles.body}>
          {(a.isBreaking || a.sourceType === 'CITIZEN' || place) ? (
            <View style={styles.tags}>
              {a.isBreaking && <View style={[styles.badge, { backgroundColor: th.red }]}><T bold size={11} color="#fff">{t.breaking}</T></View>}
              {a.sourceType === 'CITIZEN' && <View style={[styles.badge, { backgroundColor: th.citizen }]}><T bold size={11} color="#fff">{t.citizen}</T></View>}
              {place ? <T size={12} color={th.muted}>📍 {place} · {name(a.category)}</T> : null}
            </View>
          ) : null}
          <T bold size={20} style={{ lineHeight: 30 }} numberOfLines={3}>{a.headline}</T>
          <T size={17} color={th.text} style={{ marginTop: 8, lineHeight: 28, opacity: 0.9 }} numberOfLines={Math.max(3, Math.floor((height - imageH - 260) / 28))}>
            {a.summary}
          </T>
          <View style={styles.byline}>
            <T size={12} color={th.muted} style={{ flex: 1 }} numberOfLines={1}>
              {a.reporter ? `✍ ${a.reporter} · ` : ''}{a.sourceLabel}
            </T>
            <Pressable onPress={open} hitSlop={10} accessibilityRole="link" style={styles.readMore}>
              <T bold size={13} color={th.green}>{t.readMore}</T>
              <Ionicons name="chevron-forward" size={15} color={th.green} />
            </Pressable>
          </View>
        </View>
      </Pressable>
      </Animated.View>

      <View style={styles.infoRow}>
        <Ionicons name="time-outline" size={16} color={th.muted} />
        <T size={13} color={th.muted} style={{ marginLeft: 4, maxWidth: '35%' }} numberOfLines={1}>
          {timeAgo(a.publishedAt, t)}
        </T>
        <View style={{ flex: 1 }} />
        {total ? <T size={13} color={th.muted} style={{ maxWidth: '35%', textAlign: 'right' }} numberOfLines={1}><T bold size={13}>{index + 1}</T> {t.of} {total} {t.pages}</T> : null}
      </View>

      <View style={[styles.bar, { borderTopColor: th.border, backgroundColor: th.card }]}>
        <BarBtn icon={r.liked ? 'thumbs-up' : 'thumbs-up-outline'} color={r.liked ? th.green : th.text} label={t.like} count={r.likeCount} onPress={r.like} />
        <BarBtn icon={r.disliked ? 'thumbs-down' : 'thumbs-down-outline'} color={r.disliked ? th.red : th.text} label={t.dislike} count={r.dislikeCount} onPress={r.dislike} />
        <View style={styles.centerSlot}>
          <Pressable onPress={() => shareArticle(a, 'whatsapp')} accessibilityRole="button" accessibilityLabel={t.whatsapp}
            style={({ pressed }) => [styles.wa, { borderColor: th.card, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
            <Ionicons name="logo-whatsapp" size={34} color="#fff" />
          </Pressable>
          <T bold size={11} color={th.muted} style={{ marginTop: 2 }}>{t.share.toUpperCase()}</T>
        </View>
        <BarBtn icon="chatbox-ellipses-outline" color={th.text} label={t.comments} count={a.commentCount}
          onPress={() => nav.navigate('Comments', { articleId: a.id, headline: a.headline })} />
        <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.more} style={styles.dots}>
          <Ionicons name="ellipsis-vertical" size={20} color={th.muted} />
        </Pressable>
        <Pressable onPress={() => shareArticle(a)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.share} style={styles.dots}>
          <Ionicons name="arrow-redo" size={26} color="#1E88E5" />
        </Pressable>
      </View>

      <MoreSheet a={a} visible={menu} onClose={() => setMenu(false)} onOpen={() => { setMenu(false); open(); }} />
    </View>
  );
}

function BarBtn({ icon, color, label, count, onPress }: { icon: any; color: string; label: string; count: number; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} ${count}`} style={styles.barBtn}>
      <Ionicons name={icon} size={24} color={color} />
      <T size={14} color={th.muted} style={{ marginLeft: 5 }}>{count > 0 ? compact(count) : ''}</T>
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
  brand: { position: 'absolute', left: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderTopRightRadius: 6 },
  brandIcon: { borderWidth: 1.5, borderRadius: 3, width: 16, height: 16, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  credit: { position: 'absolute', right: 6, bottom: 4, textShadowColor: '#000', textShadowRadius: 3 },
  body: { paddingHorizontal: 16, paddingTop: 12, flex: 1 },
  tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  badge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 4 },
  byline: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  readMore: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, height: 62, paddingHorizontal: 8 },
  barBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minWidth: 64 },
  centerSlot: { flex: 1, alignItems: 'center', marginTop: -34 },
  wa: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#25D366', alignItems: 'center', justifyContent: 'center', borderWidth: 4, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dots: { paddingHorizontal: 8, paddingVertical: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { padding: 20, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  reason: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  note: { borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 70, marginTop: 8, fontSize: 15, textAlignVertical: 'top' },
});
