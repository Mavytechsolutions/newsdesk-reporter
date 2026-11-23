import React, { useLayoutEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useArticles, useLocations } from '../api/hooks';
import { FeedList } from '../components/FeedList';
import { Chip } from '../components/ui';
import { useTheme } from '../theme';
import { useName } from '../i18n';

/** News for one place, topic or breaking alerts. For a district, shows its mandals/towns as quick filters. */
export function ListFeedScreen({ route, navigation }: any) {
  const { title, filter, districtId } = route.params as { title: string; filter: any; districtId?: string };
  const th = useTheme();
  const name = useName();
  const q = useArticles(filter);
  const children = useLocations(districtId);
  useLayoutEffect(() => navigation.setOptions({ title }), [navigation, title]);

  const header = districtId && children.data ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      {children.data.filter((c) => c.type === 'MANDAL' || c.type === 'MUNICIPALITY').map((c) => (
        <Chip key={c.id} label={name(c)} onPress={() => navigation.push('ListFeed', { title: name(c), filter: { locationId: c.id } })} />
      ))}
    </ScrollView>
  ) : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      {header ? <View style={{ paddingTop: 8 }}>{header}</View> : null}
      <FeedList query={q} mode="immersive" />
    </View>
  );
}
