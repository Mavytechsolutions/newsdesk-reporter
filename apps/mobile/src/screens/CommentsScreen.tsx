import React, { useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useComments } from '../api/hooks';
import { api, useAuth } from '../api/client';
import { Button, EmptyState, ErrorState, T } from '../components/ui';
import { useFont, useTheme } from '../theme';
import { timeAgo, useT } from '../i18n';

/** Read and write comments on a story. Writing needs login; readers can delete their own (long-press). */
export function CommentsScreen({ route, navigation }: any) {
  const { articleId, headline } = route.params as { articleId: string; headline: string };
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const loggedIn = useAuth((s) => s.loggedIn);
  const q = useComments(articleId);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useLayoutEffect(() => navigation.setOptions({ title: t.comments }), [navigation, t.comments]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['comments', articleId] });
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['article'] });
  };
  const send = async () => {
    setErr('');
    setBusy(true);
    try {
      await api(`/articles/${articleId}/comments`, { method: 'POST', body: { body: text } });
      setText('');
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };
  const remove = (id: string) =>
    Alert.alert(t.appName, t.deleteComment, [
      { text: t.cancel, style: 'cancel' },
      { text: t.confirm, style: 'destructive', onPress: async () => { await api(`/comments/${id}`, { method: 'DELETE' }).catch(() => undefined); refresh(); } },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: th.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <T bold size={15} numberOfLines={2} style={[styles.head, { backgroundColor: th.card, borderColor: th.border }]}>{headline}</T>
      {q.isPending ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, flexGrow: 1 }}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title={t.noComments} />}
          renderItem={({ item }) => (
            <Pressable onLongPress={item.mine ? () => remove(item.id) : undefined} style={[styles.comment, { backgroundColor: th.card }]}>
              <View style={styles.row}>
                <Ionicons name="person-circle" size={28} color={th.muted} />
                <T bold size={14} style={{ marginLeft: 6, flex: 1 }}>{item.author}</T>
                <T size={12} color={th.muted}>{timeAgo(item.createdAt, t)}</T>
                {item.mine && (
                  <Pressable onPress={() => remove(item.id)} hitSlop={8} accessibilityLabel={t.deleteComment} style={{ marginLeft: 8 }}>
                    <Ionicons name="trash-outline" size={16} color={th.muted} />
                  </Pressable>
                )}
              </View>
              <T size={15} style={{ marginTop: 4 }}>{item.body}</T>
            </Pressable>
          )}
        />
      )}
      <View style={[styles.inputBar, { backgroundColor: th.card, borderColor: th.border, paddingBottom: insets.bottom + 8 }]}>
        {loggedIn ? (
          <>
            {err ? <T size={13} color={th.red} style={{ marginBottom: 6 }}>{err}</T> : null}
            <View style={styles.row}>
              <TextInput value={text} onChangeText={setText} placeholder={t.writeComment} placeholderTextColor={th.muted} maxLength={500} multiline
                style={[styles.input, { color: th.text, borderColor: th.border, fontFamily: font() }]} accessibilityLabel={t.writeComment} />
              <Pressable onPress={send} disabled={!text.trim() || busy} accessibilityRole="button" accessibilityLabel={t.send}
                style={[styles.send, { backgroundColor: text.trim() ? th.green : th.border }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />}
              </Pressable>
            </View>
          </>
        ) : (
          <Button title={t.loginToComment} icon="call-outline" onPress={() => navigation.navigate('Login')} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { padding: 12, borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  comment: { borderRadius: 12, padding: 12, marginBottom: 8 },
  inputBar: { borderTopWidth: 1, padding: 10 },
  input: { flex: 1, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
