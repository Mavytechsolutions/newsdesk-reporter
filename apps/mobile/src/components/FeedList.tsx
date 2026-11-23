import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, LayoutChangeEvent, RefreshControl, View } from 'react-native';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { Page, ArticleCard } from '../api/types';
import { NewsCard } from './NewsCard';
import { StoryPage } from './StoryPage';
import { FlipDeck } from './FlipDeck';
import { EmptyState, ErrorState, FeedSkeleton } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import type { FeedMode } from '../store/settings';

/**
 * Infinite, pull-to-refresh news list used by every feed.
 * Loads one page at a time as the reader scrolls. Handles loading, error and empty states.
 * In "immersive" mode each story fills the screen and you flip through stories like pages (FlipDeck).
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
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;
  const open = (a: ArticleCard) => nav.navigate('Article', { slug: a.slug });
  const immersive = mode === 'immersive';

  const list = immersive ? (
    items.length ? (
      <FlipDeck
        items={items}
        height={height}
        keyOf={(a) => a.id}
        renderPage={(a, i, live) => <StoryPage a={a} height={height} index={i} total={total ?? items.length} onTap={live ? onTapStory : undefined} />}
        onIndexChange={onPageChange}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onRefresh={() => { query.refetch(); }}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        loadingMore={query.isFetchingNextPage}
      />
    ) : (
      empty ?? <EmptyState icon="newspaper-outline" title={t.emptyFeed} hint={t.emptyFeedHint} />
    )
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

