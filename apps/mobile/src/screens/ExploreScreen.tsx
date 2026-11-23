import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useLocations, useSearch, useSuggest } from '../api/hooks';
import { FeedList } from '../components/FeedList';
import { Chip, EmptyState, IconBtn, T } from '../components/ui';
import { useFont, useTheme } from '../theme';
import { useName, useT } from '../i18n';
import { useSettings } from '../store/settings';

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

export function ExploreScreen({ navigation, route }: any) {
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const name = useName();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState<string>(route.params?.q ?? '');
  const [submitted, setSubmitted] = useState<string>(route.params?.q ?? '');
  const typed = useDebounced(text);
  const suggest = useSuggest(typed);
  const results = useSearch(submitted);
  const { recentSearches, addRecentSearch, clearRecentSearches } = useSettings();
  const cats = useCategories();
  const states = useLocations();
  const ap = states.data?.find((x) => x.nameEn === 'Andhra Pradesh');
  const districts = useLocations(ap?.id);

  useEffect(() => {
    if (route.params?.q) { setText(route.params.q); setSubmitted(route.params.q); }
  }, [route.params?.q]);

  const run = (q: string) => {
    const v = q.trim();
    if (v.length < 2) return;
    setText(v);
    setSubmitted(v);
    addRecentSearch(v);
  };
  const didYouMean = results.data?.pages[0]?.didYouMean;
  const showResults = submitted.length >= 2 && submitted === text.trim();

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <View style={[styles.search, { backgroundColor: th.card, borderColor: th.border }]}>
        <Ionicons name="search" size={20} color={th.muted} />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => run(text)}
          placeholder={t.searchPlaceholder}
          placeholderTextColor={th.muted}
          returnKeyType="search"
          autoCorrect={false}
          style={[styles.input, { color: th.text, fontFamily: font() }]}
          accessibilityLabel={t.searchPlaceholder}
        />
        {text ? <IconBtn label={t.clear} name="close-circle" color={th.muted} onPress={() => { setText(''); setSubmitted(''); }} /> : null}
      </View>

      {showResults ? (
        <FeedList
          query={results}
          empty={
            <EmptyState icon="search-outline" title={t.noResults}
              action={didYouMean ? { title: `${t.didYouMean}: ${didYouMean}?`, onPress: () => run(didYouMean) } : undefined} />
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {text.trim().length >= 2 && suggest.data && (suggest.data.locations.length > 0 || suggest.data.tags.length > 0) ? (
            <View style={{ marginBottom: 16 }}>
              {suggest.data.locations.map((l) => (
                <Pressable key={l.id} style={[styles.sugg, { borderColor: th.border }]} onPress={() => navigation.navigate('ListFeed', { title: name(l), filter: { locationId: l.id } })}>
                  <Ionicons name="location-outline" size={18} color={th.green} />
                  <T style={{ marginLeft: 10 }}>{name(l)}</T>
                </Pressable>
              ))}
              {suggest.data.tags.map((tag) => (
                <Pressable key={tag} style={[styles.sugg, { borderColor: th.border }]} onPress={() => run(tag)}>
                  <Ionicons name="pricetag-outline" size={18} color={th.muted} />
                  <T style={{ marginLeft: 10 }}>#{tag}</T>
                </Pressable>
              ))}
              <Pressable style={[styles.sugg, { borderColor: th.border }]} onPress={() => run(text)}>
                <Ionicons name="search" size={18} color={th.muted} />
                <T bold style={{ marginLeft: 10 }}>“{text.trim()}”</T>
              </Pressable>
            </View>
          ) : null}

          {recentSearches.length > 0 && (
            <>
              <View style={styles.titleRow}>
                <T bold size={16}>{t.recent}</T>
                <Pressable onPress={clearRecentSearches}><T color={th.green}>{t.clear}</T></Pressable>
              </View>
              <View style={styles.wrap}>{recentSearches.map((r) => <Chip key={r} label={r} onPress={() => run(r)} />)}</View>
            </>
          )}

          <T bold size={16} style={{ marginTop: 16, marginBottom: 8 }}>{t.browsePlaces}</T>
          {districts.data?.map((d) => (
            <Pressable key={d.id} style={[styles.place, { backgroundColor: th.card }]} onPress={() => navigation.navigate('ListFeed', { title: name(d), filter: { locationId: d.id }, districtId: d.id })}>
              <Ionicons name="location" size={20} color={th.green} />
              <T bold size={16} style={{ marginLeft: 10, flex: 1 }}>{name(d)}</T>
              <Ionicons name="chevron-forward" size={18} color={th.muted} />
            </Pressable>
          ))}

          <T bold size={16} style={{ marginTop: 16, marginBottom: 8 }}>{t.browseTopics}</T>
          <View style={styles.wrap}>
            {cats.data?.filter((c) => !c.isVirtual).map((c) => (
              <Chip key={c.slug} label={name(c)} onPress={() => navigation.navigate('ListFeed', { title: name(c), filter: { category: c.slug } })} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', margin: 12, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12, marginLeft: 8 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  sugg: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  place: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 8 },
});
