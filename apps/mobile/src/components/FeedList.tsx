import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, LayoutChangeEvent, RefreshControl, View } from 'react-native';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { Page, ArticleCard } from '../api/types';
import { NewsCard, ImmersiveCard } from './NewsCard';
import { EmptyState, ErrorState, FeedSkeleton } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import type { FeedMode } from '../store/settings';

/**
 * Infinite, pull-to-refresh news list used by every feed.
 * Loads one page at a time as the reader scrolls. Handles loading, error and empty states.
 */
export function FeedList({ query, mode = 'compact', header, empty }: {
  query: UseInfiniteQueryResult<InfiniteData<Page>>;
  mode?: FeedMode;
  header?: React.ReactElement;
  empty?: React.ReactElement;
}) {
  const nav = useNavigation<any>();
  const th = useTheme();
  const t = useT();
  const [height, setHeight] = useState(0);
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const open = (a: ArticleCard) => nav.navigate('Article', { slug: a.slug });

  if (query.isPending) return <View style={{ flex: 1 }}>{header}<FeedSkeleton /></View>;
  if (query.isError && !items.length) return <View style={{ flex: 1 }}>{header}<ErrorState error={query.error} onRetry={() => query.refetch()} /></View>;

  const immersive = mode === 'immersive' && height > 0;
  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) =>
          immersive ? <ImmersiveCard a={item} height={height} onPress={() => open(item)} /> : <NewsCard a={item} onPress={() => open(item)} />
        }
        ListHeaderComponent={immersive ? undefined : header}
        ListEmptyComponent={empty ?? <EmptyState icon="newspaper-outline" title={t.emptyFeed} hint={t.emptyFeedHint} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ margin: 20 }} color={th.green} /> : <View style={{ height: 24 }} />}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { query.refetch(); }} tintColor={th.green} colors={[th.green]} />}
        pagingEnabled={immersive}
        snapToInterval={immersive ? height : undefined}
        decelerationRate={immersive ? 'fast' : 'normal'}
        showsVerticalScrollIndicator={!immersive}
        contentContainerStyle={immersive ? undefined : { paddingTop: 12 }}
        getItemLayout={immersive ? (_, i) => ({ length: height, offset: height * i, index: i }) : undefined}
        initialNumToRender={immersive ? 2 : 4}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}
