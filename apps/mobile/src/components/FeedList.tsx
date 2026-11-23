import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, LayoutChangeEvent, RefreshControl, StyleSheet, View } from 'react-native';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import type { Page, ArticleCard } from '../api/types';
import { NewsCard } from './NewsCard';
import { StoryPage } from './StoryPage';
import { EmptyState, ErrorState, FeedSkeleton } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import type { FeedMode } from '../store/settings';

/**
 * Card-deck page: while you swipe up, this story stays where it is, shrinks a little and darkens,
 * and the next story slides up over it (Way2News style). Swiping down slides it back off.
 */
function DeckPage({ index, height, scrollY, children }: { index: number; height: number; scrollY: Animated.Value; children: React.ReactNode }) {
  const range = [index * height, (index + 1) * height];
  const translateY = scrollY.interpolate({ inputRange: range, outputRange: [0, height], extrapolate: 'clamp' });
  const scale = scrollY.interpolate({ inputRange: range, outputRange: [1, 0.9], extrapolate: 'clamp' });
  const dim = scrollY.interpolate({ inputRange: range, outputRange: [0, 0.7], extrapolate: 'clamp' });
  return (
    <Animated.View style={[styles.deck, { height, transform: [{ translateY }, { scale }] }]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dim }]} />
    </Animated.View>
  );
}

/**
 * Infinite, pull-to-refresh news list used by every feed.
 * Loads one page at a time as the reader scrolls. Handles loading, error and empty states.
 * In "immersive" mode each story fills the screen and stories stack like a deck of cards.
 */
export function FeedList({ query, mode = 'compact', header, empty, onPageChange, onTapStory }: {
  query: UseInfiniteQueryResult<InfiniteData<Page>>;
  mode?: FeedMode;
  header?: React.ReactElement;
  empty?: React.ReactElement;
  onPageChange?: (index: number) => void;
  onTapStory?: () => void;
}) {
  const nav = useNavigation<any>();
  const th = useTheme();
  const t = useT();
  const [height, setHeight] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const page = useRef(0);
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;
  const open = (a: ArticleCard) => nav.navigate('Article', { slug: a.slug });
  const immersive = mode === 'immersive';

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );
  const onSettled = (y: number) => {
    if (!height) return;
    const i = Math.round(y / height);
    if (i !== page.current) {
      page.current = i;
      Haptics.selectionAsync().catch(() => undefined);
      onPageChange?.(i);
    }
  };

  const list = immersive ? (
    <Animated.FlatList
      data={items}
      keyExtractor={(a: ArticleCard) => a.id}
      renderItem={({ item, index }: { item: ArticleCard; index: number }) => (
        <DeckPage index={index} height={height} scrollY={scrollY}>
          <StoryPage a={item} height={height} index={index} total={total} onTap={onTapStory} />
        </DeckPage>
      )}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={(e: any) => onSettled(e.nativeEvent.contentOffset.y)}
      ListEmptyComponent={empty ?? <View style={{ height }}><EmptyState icon="newspaper-outline" title={t.emptyFeed} hint={t.emptyFeedHint} /></View>}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ margin: 20 }} color={th.green} /> : undefined}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={2}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { query.refetch(); }} tintColor={th.green} colors={[th.green]} />}
      pagingEnabled
      snapToInterval={height}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={(_: unknown, i: number) => ({ length: height, offset: height * i, index: i })}
      initialNumToRender={2}
      maxToRenderPerBatch={3}
      windowSize={5}
      removeClippedSubviews={false}
    />
  ) : (
    <FlatList
      data={items}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => <NewsCard a={item} onPress={() => open(item)} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty ?? <EmptyState icon="newspaper-outline" title={t.emptyFeed} hint={t.emptyFeedHint} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ margin: 20 }} color={th.green} /> : <View style={{ height: 24 }} />}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { query.refetch(); }} tintColor={th.green} colors={[th.green]} />}
      contentContainerStyle={{ paddingTop: 12 }}
      initialNumToRender={4}
      windowSize={7}
      removeClippedSubviews
    />
  );

  // One wrapper that is always mounted, so the screen height is known before the first story is shown.
  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {query.isPending || (immersive && height === 0) ? (
        <>{immersive ? null : header}<FeedSkeleton /></>
      ) : query.isError && !items.length ? (
        <>{header}<ErrorState error={query.error} onRetry={() => query.refetch()} /></>
      ) : (
        list
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { overflow: 'hidden', backgroundColor: '#000', elevation: 10, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
});
