import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextProps, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFont, useTheme } from '../theme';
import { useT } from '../i18n';
import { ApiError, serverUrl } from '../api/client';

/** Text that automatically uses the Telugu font when the app is in Telugu. */
export function T({ bold, style, color, size = 15, ...p }: TextProps & { bold?: boolean; color?: string; size?: number }) {
  const th = useTheme();
  const font = useFont();
  return (
    <Text
      {...p}
      style={[{ color: color ?? th.text, fontSize: size, fontFamily: font(bold ? 'bold' : 'regular'), fontWeight: bold ? '700' : '400', lineHeight: size * 1.5 }, style]}
    />
  );
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, loading, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'outline' | 'danger'; icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const th = useTheme();
  const bg = kind === 'primary' ? th.green : 'transparent';
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? th.red : th.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: kind === 'primary' ? th.green : kind === 'danger' ? th.red : th.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
      {!loading && <T bold color={fg} size={15}>{title}</T>}
    </Pressable>
  );
}

export function IconBtn({ name, onPress, color, label, size = 22 }: { name: keyof typeof Ionicons.glyphMap; onPress: () => void; color?: string; label: string; size?: number }) {
  const th = useTheme();
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={10} onPress={onPress} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={name} size={size} color={color ?? th.text} />
    </Pressable>
  );
}

function Pulse({ style }: { style: ViewStyle }) {
  const th = useTheme();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.5, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: th.skeleton, borderRadius: 6, opacity: v }, style]} />;
}

/** Grey placeholder cards shown while news is loading. */
export function FeedSkeleton({ count = 4 }: { count?: number }) {
  const th = useTheme();
  return (
    <View style={{ padding: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.skelCard, { backgroundColor: th.card }]}>
          <Pulse style={{ height: 160, borderRadius: 10 }} />
          <Pulse style={{ height: 18, marginTop: 12, width: '90%' }} />
          <Pulse style={{ height: 18, marginTop: 8, width: '70%' }} />
          <Pulse style={{ height: 12, marginTop: 12, width: '40%' }} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; hint?: string; action?: { title: string; onPress: () => void } }) {
  const th = useTheme();
  return (
    <View style={s.center}>
      <Ionicons name={icon} size={56} color={th.muted} />
      <T bold size={18} style={{ marginTop: 12, textAlign: 'center' }}>{title}</T>
      {hint ? <T color={th.muted} style={{ marginTop: 6, textAlign: 'center' }}>{hint}</T> : null}
      {action ? <Button title={action.title} onPress={action.onPress} style={{ marginTop: 18 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const offline = error instanceof ApiError && error.offline;
  return (
    <EmptyState
      icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
      title={offline ? t.offlineTitle : t.errorTitle}
      hint={offline ? `${serverUrl()}` : error instanceof Error ? error.message : undefined}
      action={{ title: t.retry, onPress: onRetry }}
    />
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      style={[s.chip, { backgroundColor: active ? th.chipActive : th.chip }]}>
      <T size={14} bold={active} color={active ? th.chipActiveText : th.text}>{label}</T>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 360 },
  skelCard: { borderRadius: 14, padding: 12, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8, marginBottom: 8 },
});
