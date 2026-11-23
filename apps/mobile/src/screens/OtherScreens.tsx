import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { FlipDeck } from '../components/FlipDeck';
import { StoryPage } from '../components/StoryPage';
import { Button, Chip, EmptyState, ErrorState, FeedSkeleton, T } from '../components/ui';
import { useCategories, useHistory, useMe } from '../api/hooks';
import { api, logout, saveLogin, useAuth, ApiError, serverUrl, switchServer, testServer } from '../api/client';
import type { ArticleCard } from '../api/types';
import { useFont, useTheme } from '../theme';
import { useName, useT } from '../i18n';
import { useSettings } from '../store/settings';

// ---------------- Saved (offline) ----------------
export function BookmarksScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const saved = useSettings((s) => s.saved);
  const [h, setH] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
      <T bold size={22} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>{t.bookmarks}</T>
      <View style={{ flex: 1 }} onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}>
        {saved.length ? (
          <FlipDeck items={saved} height={h} keyOf={(a) => a.id}
            renderPage={(a, i) => <StoryPage a={a} height={h} index={i} total={saved.length} />} />
        ) : (
          <EmptyState icon="bookmark-outline" title={t.savedEmpty} hint={t.savedEmptyHint} />
        )}
      </View>
    </View>
  );
}

// ---------------- Videos (Phase 3) ----------------
export function VideosScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <EmptyState icon="videocam-outline" title={t.videosSoon} hint={t.videosSoonHint} action={{ title: t.readTop, onPress: () => navigation.navigate('Home') }} />
    </View>
  );
}

// ---------------- Login (phone OTP) ----------------
export function LoginScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(h);
  }, [wait]);

  const send = async () => {
    setError('');
    setBusy(true);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone } });
      setStep('code');
      setWait(30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await api<{ accessToken: string; refreshToken: string; isNewUser: boolean }>('/auth/otp/verify', { method: 'POST', body: { phone, code } });
      await saveLogin(r.accessToken, r.refreshToken);
      // Bring phone settings into the account, and account bookmarks onto the phone.
      const { places, language, mergeSaved } = useSettings.getState();
      const me = await api<any>('/me');
      if (places.length && !me.locations.length) await api('/me/locations', { method: 'PUT', body: { locationIds: places.map((p) => p.id) } });
      await api('/me', { method: 'PATCH', body: { language } });
      const serverSaved = await api<ArticleCard[]>(`/me/bookmarks?lang=${language}`).catch(() => []);
      mergeSaved(serverSaved);
      for (const a of useSettings.getState().saved) if (!serverSaved.some((x) => x.id === a.id)) api(`/me/bookmarks/${a.id}`, { method: 'PUT' }).catch(() => undefined);
      qc.invalidateQueries();
      navigation.goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card, fontFamily: font() }];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
      <Ionicons name="phone-portrait-outline" size={48} color={th.green} />
      <T bold size={22} style={{ marginTop: 12 }}>{t.login}</T>
      <T color={th.muted} style={{ marginTop: 4, marginBottom: 20 }}>{t.loginHint}</T>
      {step === 'phone' ? (
        <>
          <T bold size={14}>{t.phone}</T>
          <View style={styles.row}>
            <View style={[styles.prefix, { borderColor: th.border, backgroundColor: th.card }]}><T bold>+91</T></View>
            <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" maxLength={10}
              placeholder="98765 43210" placeholderTextColor={th.muted} style={[...input, { flex: 1 }]} autoFocus accessibilityLabel={t.phone} />
          </View>
          <Button title={t.sendOtp} onPress={send} loading={busy} disabled={!/^[6-9]\d{9}$/.test(phone)} style={{ marginTop: 16 }} />
        </>
      ) : (
        <>
          <T>{t.enterOtp} +91 {phone}</T>
          <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6}
            textContentType="oneTimeCode" autoComplete="sms-otp" placeholder="● ● ● ● ● ●" placeholderTextColor={th.muted}
            style={[...input, { marginTop: 12, fontSize: 24, letterSpacing: 8, textAlign: 'center' }]} autoFocus accessibilityLabel="OTP" />
          <Button title={t.verify} onPress={verify} loading={busy} disabled={code.length !== 6} style={{ marginTop: 16 }} />
          <Pressable disabled={wait > 0 || busy} onPress={send} style={{ marginTop: 16, alignItems: 'center' }}>
            <T color={wait > 0 ? th.muted : th.green}>{wait > 0 ? `${t.resendIn} ${wait}s` : t.resend}</T>
          </Pressable>
        </>
      )}
      {error ? <T color={th.red} style={{ marginTop: 14 }}>{error}</T> : null}
    </ScrollView>
  );
}

// ---------------- Profile & settings ----------------
export function ProfileScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const loggedIn = useAuth((s) => s.loggedIn);
  const me = useMe();
  const { language, setLanguage, theme, setTheme, places } = useSettings();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');

  const changeLanguage = (l: 'te' | 'en') => {
    setLanguage(l);
    if (loggedIn) api('/me', { method: 'PATCH', body: { language: l } }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['feed'] });
  };
  const confirm = (msg: string, onYes: () => void) =>
    Alert.alert(t.appName, msg, [{ text: t.cancel, style: 'cancel' }, { text: t.confirm, style: 'destructive', onPress: onYes }]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, padding: 16, paddingBottom: 40 }}>
      <View style={[styles.card, { backgroundColor: th.card, alignItems: 'center' }]}>
        <Ionicons name="person-circle" size={64} color={th.navy === th.header ? th.navy : th.muted} />
        {loggedIn && me.data ? (
          editing ? (
            <View style={{ width: '100%', marginTop: 8 }}>
              <TextInput value={newName} onChangeText={setNewName} placeholder={t.name} placeholderTextColor={th.muted} maxLength={80}
                style={[styles.input, { color: th.text, borderColor: th.border }]} autoFocus />
              <Button title={t.saveBtn} style={{ marginTop: 8 }} onPress={async () => {
                await api('/me', { method: 'PATCH', body: { name: newName.trim() } }).catch(() => undefined);
                setEditing(false);
                me.refetch();
              }} />
            </View>
          ) : (
            <Pressable onPress={() => { setNewName(me.data!.name ?? ''); setEditing(true); }} style={styles.row}>
              <T bold size={18} style={{ marginTop: 6 }}>{me.data.name || t.name}</T>
              <Ionicons name="create-outline" size={18} color={th.muted} style={{ marginLeft: 6, marginTop: 6 }} />
            </Pressable>
          )
        ) : null}
        {loggedIn && me.data ? <T color={th.muted}>{me.data.phone}</T> : null}
        {loggedIn && me.isError ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : null}
        {!loggedIn && (
          <>
            <T bold size={17} style={{ marginTop: 6 }}>{t.guest}</T>
            <T color={th.muted} style={{ textAlign: 'center', marginVertical: 8 }}>{t.loginHint}</T>
            <Button title={t.login} icon="call-outline" onPress={() => navigation.navigate('Login')} style={{ alignSelf: 'stretch' }} />
          </>
        )}
      </View>

      <Section title={t.language}>
        <View style={styles.row}>
          <Chip label="తెలుగు" active={language === 'te'} onPress={() => changeLanguage('te')} />
          <Chip label="English" active={language === 'en'} onPress={() => changeLanguage('en')} />
        </View>
      </Section>

      <Row icon="location-outline" label={t.myPlaces} value={places.length ? places.map(name).join(', ') : t.allPlaces} onPress={() => navigation.navigate('Places')} />
      {loggedIn && <Row icon="pricetags-outline" label={t.myTopics} value={me.data?.categories.map(name).join(', ')} onPress={() => navigation.navigate('Topics')} />}
      {loggedIn && <Row icon="time-outline" label={t.history} onPress={() => navigation.navigate('History')} />}

      <Section title={t.theme}>
        <View style={styles.row}>
          <Chip label={t.themeSystem} active={theme === 'system'} onPress={() => setTheme('system')} />
          <Chip label={t.themeLight} active={theme === 'light'} onPress={() => setTheme('light')} />
          <Chip label={t.themeDark} active={theme === 'dark'} onPress={() => setTheme('dark')} />
        </View>
      </Section>

      {loggedIn && (
        <>
          <Row icon="refresh-outline" label={t.resetPersonal} onPress={() => confirm(t.resetConfirm, async () => {
            await api('/me/personalization', { method: 'DELETE' }).catch(() => undefined);
            qc.invalidateQueries();
          })} />
          <Row icon="log-out-outline" label={t.logout} onPress={async () => { await logout(); qc.clear(); }} />
          <Row icon="trash-outline" label={t.deleteAccount} danger onPress={() => confirm(t.deleteConfirm, async () => {
            await api('/me', { method: 'DELETE' }).catch(() => undefined);
            useSettings.getState().reset();
            await logout();
            qc.clear();
          })} />
        </>
      )}
      <ServerSetting />
      <T size={12} color={th.muted} style={{ textAlign: 'center', marginTop: 20 }}>
        MAVY TECH SOLUTIONS PVT LTD · {t.version} {Constants.expoConfig?.version ?? '1.0.0'}
      </T>
    </ScrollView>
  );
}

/** Lets a tester point the installed app at their own computer's server. */
export function ServerSetting() {
  const th = useTheme();
  const t = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState(serverUrl());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    let u = url.trim();
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (!/:\d+$/.test(u.replace(/\/$/, '')) && u.startsWith('http://')) u = `${u.replace(/\/$/, '')}:4000`;
    setUrl(u);
    setBusy(true);
    const err = await testServer(u);
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    await switchServer(u);
    qc.clear();
    setMsg({ ok: true, text: t.serverOk });
  };
  return (
    <Section title={t.server}>
      <T size={12} color={th.muted}>{t.serverHint}</T>
      <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        style={[styles.input, { color: th.text, borderColor: th.border, fontSize: 15 }]} accessibilityLabel={t.server} />
      <Button title={t.testSave} kind="outline" icon="wifi-outline" loading={busy} onPress={save} style={{ marginTop: 8 }} />
      {msg ? <T color={msg.ok ? th.green : th.red} style={{ marginTop: 6 }}>{msg.text}</T> : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const th = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: th.card }]}>
      <T bold size={15} style={{ marginBottom: 8 }}>{title}</T>
      {children}
    </View>
  );
}

function Row({ icon, label, value, onPress, danger }: { icon: any; label: string; value?: string; onPress: () => void; danger?: boolean }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, styles.row, { backgroundColor: th.card, opacity: pressed ? 0.8 : 1 }]}>
      <Ionicons name={icon} size={22} color={danger ? th.red : th.green} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T bold color={danger ? th.red : th.text}>{label}</T>
        {value ? <T size={13} color={th.muted} numberOfLines={1}>{value}</T> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={th.muted} />
    </Pressable>
  );
}

// ---------------- Followed topics ----------------
export function TopicsScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const name = useName();
  const qc = useQueryClient();
  const cats = useCategories();
  const me = useMe();
  const [picked, setPicked] = useState<string[] | null>(null);
  const current = picked ?? me.data?.categories.map((c) => c.id) ?? [];
  if (!cats.data || !me.data) return <FeedSkeleton count={1} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cats.data.filter((c) => !c.isVirtual).map((c) => (
          <Chip key={c.id} label={name(c)} active={current.includes(c.id)}
            onPress={() => setPicked(current.includes(c.id) ? current.filter((x) => x !== c.id) : [...current, c.id])} />
        ))}
      </View>
      <Button title={t.saveBtn} style={{ marginTop: 20 }} onPress={async () => {
        await api('/me/categories', { method: 'PUT', body: { categoryIds: current } }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['feed'] });
        navigation.goBack();
      }} />
    </ScrollView>
  );
}

// ---------------- Reading history ----------------
export function HistoryScreen({ navigation }: any) {
  const th = useTheme();
  const t = useT();
  const q = useHistory();
  const [h, setH] = useState(0);
  if (q.isPending) return <FeedSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }} onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}>
      {list.length ? (
        <FlipDeck items={list} height={h} keyOf={(a) => a.id} onRefresh={() => { q.refetch(); }} refreshing={q.isRefetching}
          renderPage={(a, i) => <StoryPage a={a} height={h} index={i} total={list.length} />} />
      ) : (
        <EmptyState icon="time-outline" title={t.history} hint={t.historyEmpty} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, marginTop: 6 },
  prefix: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 14, marginRight: 8, marginTop: 6 },
});
