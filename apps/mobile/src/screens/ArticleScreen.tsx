import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';
import { useArticle, useReaction, markRead, shareArticle, useToggleSave } from '../api/hooks';
import { MoreSheet } from '../components/StoryPage';
import { HeroImage, Meta } from '../components/NewsCard';
import { Chip, ErrorState, FeedSkeleton, T } from '../components/ui';
import { useTheme } from '../theme';
import { timeAgo, useName, useT } from '../i18n';
import { useSettings } from '../store/settings';
import type { ArticleCard } from '../api/types';

export function ArticleScreen({ route, navigation }: any) {
  const slug: string = route.params.slug;
  const appLang = useSettings((s) => s.language);
  const [lang, setLang] = useState(appLang);
  const offlineCopy = useSettings((s) => s.saved.find((x) => x.slug === slug));
  const q = useArticle(slug, lang);
  // Saved stories open without internet.
  const a: ArticleCard | undefined = q.data ?? offlineCopy;

  useEffect(() => {
    if (q.data) markRead(q.data.id);
  }, [q.data?.id]);
  useEffect(() => () => { Speech.stop(); }, []);

  if (!a && q.isPending) return <FeedSkeleton count={1} />;
  if (!a) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ArticleBody a={a} lang={lang} setLang={setLang} navigation={navigation} />;
}

function ArticleBody({ a, lang, setLang, navigation }: { a: ArticleCard; lang: 'te' | 'en'; setLang: (l: 'te' | 'en') => void; navigation: any }) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const [speaking, setSpeaking] = useState(false);
  const saved = useSettings((s) => s.saved.some((x) => x.id === a.id));
  const toggleSave = useToggleSave();
  const r = useReaction(a, () => navigation.navigate('Login'));
  const [menu, setMenu] = useState(false);

  const listen = () => {
    if (speaking) {
      Speech.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    Speech.speak(`${a.headline}. ${a.body ?? a.summary}`, {
      language: a.language === 'te' ? 'te-IN' : 'en-IN',
      rate: 0.95,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.card }} contentContainerStyle={{ paddingBottom: 40 }}>
      <HeroImage a={a} height={240} />
      {a.heroImageCredit ? <T size={11} color={th.muted} style={{ paddingHorizontal: 16, paddingTop: 4 }}>{t.photo}: {a.heroImageCredit}</T> : null}
      <View style={{ padding: 16 }}>
        <Meta a={a} />
        <T bold size={23} style={{ marginTop: 8 }}>{a.headline}</T>
        <T size={12} color={th.muted} style={{ marginTop: 8 }}>
          {lang === 'te' ? 'ప్రచురణకర్త' : 'Publisher'}: MAVY NEWS · {a.reporter ? `${t.by}: ${a.reporter} · ` : ''}{t.source}: {a.sourceLabel} · {new Date(a.publishedAt).toLocaleString(lang === 'te' ? 'te-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {a.updatedAt > a.publishedAt ? ` · ${t.updated} ${timeAgo(a.updatedAt, t)}` : ''}
        </T>

        {a.sourceType === 'CITIZEN' && (
          <View style={[styles.notice, { borderColor: th.citizen }]}>
            <Ionicons name="people-outline" size={16} color={th.citizen} />
            <T size={13} color={th.citizen} style={{ marginLeft: 6, flex: 1 }}>{a.sourceLabel}</T>
          </View>
        )}

        <View style={styles.toolbar}>
          <Pressable onPress={listen} style={[styles.tool, { backgroundColor: speaking ? th.red : th.green }]} accessibilityRole="button">
            <Ionicons name={speaking ? 'stop' : 'volume-high'} size={18} color="#fff" />
            <T bold color="#fff" size={14} style={{ marginLeft: 6 }}>{speaking ? t.stop : t.listen}</T>
          </Pressable>
          {a.availableLanguages.length > 1 &&
            a.availableLanguages.map((l) => <Chip key={l} label={l === 'te' ? 'తెలుగు' : 'English'} active={l === lang} onPress={() => setLang(l)} />)}
        </View>

        <T size={17} bold style={{ marginTop: 6 }}>{a.summary}</T>
        {(a.body ?? '').split(/\n{2,}/).map((p, i) => <T key={i} size={17} style={{ marginTop: 14 }}>{p}</T>)}

        {a.tags?.length ? (
          <View style={styles.wrap}>{a.tags.map((tag) => <Chip key={tag} label={`#${tag}`} onPress={() => navigation.navigate('Explore', { q: tag })} />)}</View>
        ) : null}
        <View style={styles.wrap}>
          {a.locations.map((l) => <Chip key={l.id} label={`📍 ${name(l)}`} onPress={() => navigation.navigate('ListFeed', { title: name(l), filter: { locationId: l.id } })} />)}
        </View>

        <View style={[styles.actionBar, { borderColor: th.border }]}>
          <Action icon={r.liked ? 'thumbs-up' : 'thumbs-up-outline'} color={r.liked ? th.green : th.text} label={`${r.likeCount || ''} ${t.like}`} onPress={r.like} />
          <Action icon={r.disliked ? 'thumbs-down' : 'thumbs-down-outline'} color={r.disliked ? th.red : th.text} label={`${r.dislikeCount || ''} ${t.dislike}`} onPress={r.dislike} />
          <Action icon="logo-whatsapp" color="#25D366" label={t.whatsapp} onPress={() => shareArticle(a, 'whatsapp')} />
          <Action icon="chatbox-ellipses-outline" color={th.text} label={`${a.commentCount || ''} ${t.comments}`} onPress={() => navigation.navigate('Comments', { articleId: a.id, headline: a.headline })} />
          <Action icon={saved ? 'bookmark' : 'bookmark-outline'} color={saved ? th.green : th.text} label={saved ? t.saved : t.save} onPress={() => toggleSave(a, !saved)} />
          <Action icon="ellipsis-horizontal" color={th.text} label={t.more} onPress={() => setMenu(true)} />
        </View>

        {a.related?.length ? (
          <>
            <T bold size={18} style={{ marginTop: 24, marginBottom: 8 }}>{t.related}</T>
            {a.related.map((r) => (
              <Pressable key={r.id} onPress={() => navigation.push('Article', { slug: r.slug })} style={[styles.related, { borderColor: th.border }]}>
                <View style={{ width: 84, height: 64, borderRadius: 8, overflow: 'hidden', marginRight: 12 }}><HeroImage a={r} height={64} /></View>
                <View style={{ flex: 1 }}>
                  <T bold size={14} numberOfLines={3}>{r.headline}</T>
                  <T size={12} color={th.muted}>{timeAgo(r.publishedAt, t)}</T>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}
      </View>
      <MoreSheet a={a} visible={menu} onClose={() => setMenu(false)} />
    </ScrollView>
  );
}

function Action({ icon, label, color, onPress }: { icon: any; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', flex: 1, paddingVertical: 8 }} accessibilityRole="button" accessibilityLabel={label.trim()}>
      <Ionicons name={icon} size={24} color={color} />
      <T size={12} style={{ marginTop: 2 }}>{label.trim()}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 14, marginBottom: 6, gap: 8 },
  tool: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 },
  actionBar: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, marginTop: 16 },
  related: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1 },
});
