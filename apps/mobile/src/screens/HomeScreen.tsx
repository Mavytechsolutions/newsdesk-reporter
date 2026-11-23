import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useFeed } from '../api/hooks';
import { FeedList } from '../components/FeedList';
import { EmptyState, IconBtn, T } from '../components/ui';
import { useTheme } from '../theme';
import { useName, useT } from '../i18n';
import { useSettings } from '../store/settings';

export function HomeScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('for-you');
  const cats = useCategories();
  const feed = useFeed(tab);
  const { feedMode, setFeedMode, places } = useSettings();
  const placeLabel = places.length ? (places.length === 1 ? name(places[0]) : `${name(places[0])} +${places.length - 1}`) : t.allPlaces;

  const needsLocation = feed.data?.pages[0]?.needsLocation;
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: th.header }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <T bold size={20} color="#fff" style={{ letterSpacing: 1 }}>MAVY <T bold size={20} color={th.green}>NEWS</T></T>
            <Pressable onPress={() => navigation.navigate('Places')} style={styles.row} accessibilityRole="button" accessibilityLabel={t.myPlaces}>
              <Ionicons name="location" size={13} color={th.green} />
              <T size={12} color="rgba(255,255,255,0.85)" numberOfLines={1} style={{ marginLeft: 3, maxWidth: 200 }}>{placeLabel}</T>
              <Ionicons name="chevron-down" size={13} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
          <IconBtn label={feedMode === 'compact' ? t.immersive : t.compact} name={feedMode === 'compact' ? 'phone-portrait-outline' : 'list-outline'} color="#fff"
            onPress={() => setFeedMode(feedMode === 'compact' ? 'immersive' : 'compact')} />
          <IconBtn label={t.explore} name="search" color="#fff" onPress={() => navigation.navigate('Explore')} />
          <IconBtn label={t.alerts} name="notifications-outline" color="#fff" onPress={() => navigation.navigate('ListFeed', { title: t.alerts, filter: { breaking: true } })} />
          <IconBtn label={t.profile} name="person-circle-outline" color="#fff" size={26} onPress={() => navigation.navigate('Profile')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
          {(cats.data ?? [{ slug: 'for-you', nameEn: 'For You', nameTe: 'మీ కోసం' } as any]).map((c) => {
            const active = c.slug === tab;
            return (
              <Pressable key={c.slug} onPress={() => setTab(c.slug)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.tab}>
                <T bold={active} size={14} color={active ? '#fff' : 'rgba(255,255,255,0.7)'}>
                  {c.slug === 'breaking' ? '🔴 ' : ''}{name(c)}
                </T>
                <View style={[styles.underline, { backgroundColor: active ? th.green : 'transparent' }]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {needsLocation ? (
        <EmptyState icon="location-outline" title={t.needsLocation} action={{ title: t.choosePlacesBtn, onPress: () => navigation.navigate('Places') }} />
      ) : (
        <FeedList key={`${tab}-${feedMode}`} query={feed} mode={feedMode} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tab: { marginRight: 18, alignItems: 'center' },
  underline: { height: 3, width: '100%', borderRadius: 2, marginTop: 4 },
});
