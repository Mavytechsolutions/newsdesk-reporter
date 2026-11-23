import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocations } from '../api/hooks';
import { api, useAuth } from '../api/client';
import type { Place } from '../api/types';
import { Button, Chip, ErrorState, T } from '../components/ui';
import { useTheme } from '../theme';
import { useName, useT } from '../i18n';
import { useSettings } from '../store/settings';
import { useQueryClient } from '@tanstack/react-query';

/** Pick districts and mandals/towns. Used during first-time setup and from Profile. */
export function PlacePicker({ onDone, doneLabel, onSkip }: { onDone: (p: Place[]) => void; doneLabel: string; onSkip?: () => void }) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const insets = useSafeAreaInsets();
  const states = useLocations();
  const ap = states.data?.find((x) => x.nameEn === 'Andhra Pradesh') ?? states.data?.[0];
  const districts = useLocations(ap?.id);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Place[]>(useSettings.getState().places);
  const has = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: Place) => setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p].slice(0, 10)));

  if (states.isError || districts.isError)
    return (
      <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
        <ErrorState error={states.error ?? districts.error} onRetry={() => { states.refetch(); districts.refetch(); }} />
      </View>
    );
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <T bold size={22}>{t.choosePlaces}</T>
        <T color={th.muted} style={{ marginTop: 4, marginBottom: 12 }}>{t.choosePlacesHint}</T>
        {!districts.data ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : districts.data.map((d) => (
          <View key={d.id} style={[styles.box, { backgroundColor: th.card, borderColor: has(d.id) ? th.green : th.border }]}>
            <View style={styles.row}>
              <Pressable onPress={() => toggle(d)} style={[styles.row, { flex: 1 }]} accessibilityRole="checkbox" accessibilityState={{ checked: has(d.id) }}>
                <Ionicons name={has(d.id) ? 'checkbox' : 'square-outline'} size={24} color={has(d.id) ? th.green : th.muted} />
                <T bold size={17} style={{ marginLeft: 10 }}>{name(d)}</T>
              </Pressable>
              <Pressable onPress={() => setOpen(open === d.id ? null : d.id)} hitSlop={10} accessibilityRole="button">
                <Ionicons name={open === d.id ? 'chevron-up' : 'chevron-down'} size={22} color={th.muted} />
              </Pressable>
            </View>
            {open === d.id && <Children parent={d} has={has} toggle={toggle} />}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.bar, { backgroundColor: th.card, borderColor: th.border, paddingBottom: insets.bottom + 12 }]}>
        <T color={th.muted} size={13} style={{ marginBottom: 8 }}>{picked.length ? `${picked.map(name).join(', ')} — ${picked.length} ${t.selected}` : t.allPlaces}</T>
        <View style={styles.row}>
          {onSkip && <Button kind="outline" title={t.skip} onPress={onSkip} style={{ flex: 1, marginRight: 8 }} />}
          <Button title={doneLabel} onPress={() => onDone(picked)} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

function Children({ parent, has, toggle }: { parent: Place; has: (id: string) => boolean; toggle: (p: Place) => void }) {
  const th = useTheme();
  const name = useName();
  const q = useLocations(parent.id);
  const local = useMemo(() => (q.data ?? []).filter((c) => c.type === 'MANDAL' || c.type === 'MUNICIPALITY'), [q.data]);
  if (!q.data) return <ActivityIndicator color={th.green} style={{ margin: 12 }} />;
  return (
    <View style={[styles.wrap, { marginTop: 12 }]}>
      {local.map((c) => <Chip key={c.id} label={name(c)} active={has(c.id)} onPress={() => toggle(c)} />)}
    </View>
  );
}

/** Route used from Home header / Profile. Saves on the phone and, when logged in, to the account. */
export function PlacesScreen({ navigation }: any) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <PlacePicker
      doneLabel={t.done}
      onDone={async (places) => {
        useSettings.getState().setPlaces(places);
        if (useAuth.getState().loggedIn)
          await api('/me/locations', { method: 'PUT', body: { locationIds: places.map((p) => p.id) } }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ['feed'] });
        navigation.goBack();
      }}
    />
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, borderTopWidth: 1 },
});
