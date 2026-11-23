import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useCategories, useFeed } from '../api/hooks';
import { FeedList } from '../components/FeedList';
import { EmptyState, IconBtn, T } from '../components/ui';
import { useFont, useTheme } from '../theme';
import { useName, useT } from '../i18n';
import { useSettings } from '../store/settings';

/**
 * Home. In the full-screen story view the top bar and the bottom tabs float over the story:
 * they show when the app opens, hide after the first swipe, and come back when you tap a story.
 */
export function HomeScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const font = useFont();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [tab, setTab] = useState('for-you');
  const cats = useCategories();
  const feed = useFeed(tab);
  const { feedMode, setFeedMode, places } = useSettings();
  const immersive = feedMode === 'immersive';
  const [chrome, setChrome] = useState(true);
  const [headerH, setHeaderH] = useState(120);
  const anim = useRef(new Animated.Value(1)).current;
  const tabsRef = useRef<any>(null);
  const tabX = useRef<Record<string, number>>({});
  const placeLabel = places.length ? (places.length === 1 ? name(places[0]) : `${name(places[0])} +${places.length - 1}`) : t.allPlaces;
  const needsLocation = feed.data?.pages[0]?.needsLocation;
  const showChrome = !immersive || chrome;

  useEffect(() => {
    Animated.timing(anim, { toValue: showChrome ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [showChrome, anim]);

  // Bottom tabs float over the story in full-screen view, so hiding them never changes the story size.
  useEffect(() => {
    if (!focused) return;
    const base = { backgroundColor: th.card, borderTopColor: th.border };
    navigation.setOptions({
      tabBarStyle: immersive ? { ...base, position: 'absolute', display: showChrome ? 'flex' : 'none' } : base,
      tabBarLabelStyle: { fontFamily: font(), fontSize: 11 },
    });
  }, [navigation, immersive, showChrome, focused, th, font]);

  const header = (
    <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)} style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: th.header }]}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <T bold size={20} color="#fff" style={{ letterSpacing: 1 }}>MAVY <T bold size={20} color={th.green}>NEWS</T></T>
          <Pressable onPress={() => navigation.navigate('Places')} style={styles.row} accessibilityRole="button" accessibilityLabel={t.myPlaces}>
            <Ionicons name="location" size={13} color={th.green} />
            <T size={12} color="rgba(255,255,255,0.85)" numberOfLines={1} style={{ marginLeft: 3, maxWidth: 200 }}>{placeLabel}</T>
            <Ionicons name="chevron-down" size={13} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
        <IconBtn label={immersive ? t.compact : t.immersive} name={immersive ? 'list-outline' : 'phone-portrait-outline'} color="#fff"
          onPress={() => setFeedMode(immersive ? 'compact' : 'immersive')} />
        <IconBtn label={t.explore} name="search" color="#fff" onPress={() => navigation.navigate('Explore')} />
        <IconBtn label={t.alerts} name="notifications-outline" color="#fff" onPress={() => navigation.navigate('ListFeed', { title: t.alerts, filter: { breaking: true } })} />
        <IconBtn label={t.profile} name="person-circle-outline" color="#fff" size={26} onPress={() => navigation.navigate('Profile')} />
      </View>
      <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, paddingBottom: 12, paddingRight: 24 }}>
        {(cats.data ?? [{ slug: 'for-you', nameEn: 'For You', nameTe: 'మీ కోసం' } as any]).map((c) => {
          const active = c.slug === tab;
          return (
            <Pressable
              key={c.slug}
              onLayout={(e) => (tabX.current[c.slug] = e.nativeEvent.layout.x)}
              onPress={() => {
                setTab(c.slug);
                tabsRef.current?.scrollTo({ x: Math.max(0, (tabX.current[c.slug] ?? 0) - 24), animated: true });
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tabPill, active ? { backgroundColor: th.green, borderColor: th.green } : null]}
            >
              {c.slug === 'breaking' ? <View style={[styles.liveDot, { backgroundColor: active ? '#fff' : th.red }]} /> : null}
              <T bold={active} size={15} color="#fff" style={{ lineHeight: 24 }}>{name(c)}</T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const body = needsLocation ? (
    <View style={{ flex: 1, paddingTop: immersive ? headerH : 0 }}>
      <EmptyState icon="location-outline" title={t.needsLocation} action={{ title: t.choosePlacesBtn, onPress: () => navigation.navigate('Places') }} />
    </View>
  ) : (
    <FeedList
      key={`${tab}-${feedMode}`}
      query={feed}
      mode={feedMode}
      onTapStory={() => setChrome((c) => !c)}
      onPageChange={() => setChrome(false)}
    />
  );

  if (!immersive)
    return (
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        {header}
        {body}
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {body}
      <Animated.View
        pointerEvents={showChrome ? 'auto' : 'none'}
        style={[styles.overlay, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-headerH, 0] }) }] }]}
      >
        {header}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12 },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, elevation: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tabPill: {
    flexDirection: 'row', alignItems: 'center', marginRight: 8, paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
});
