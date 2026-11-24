/**
 * Admin inside the app (email + password login). Same powers as the web admin page:
 *  - review stories (approve & publish / send back / reject / take down)
 *  - journalist requests (view Aadhaar, approve / reject)
 *  - journalists (points, suspend / reactivate)
 *  - sub-admins for a district or a mandal (Super Admin only)
 * Sub-admins only see their own area — the server enforces this.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl,
  ScrollView, Share, StyleSheet, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, logout, saveLogin, serverUrl, useAuth } from '../api/client';
import { useMe } from '../api/hooks';
import type { JournalistLevel, Place } from '../api/types';
import { Button, Chip, EmptyState, ErrorState, T } from '../components/ui';
import { useFont, useTheme } from '../theme';
import { useSettings } from '../store/settings';
import { LevelBadge, PlaceSelect } from './JournalistScreens';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR'];
export function useIsAdmin() {
  const me = useMe();
  const role = me.data?.sessionRole;
  return { isAdmin: !!role && ADMIN_ROLES.includes(role), role, me };
}

/** Telugu / English text picked by the app language. */
function useL() {
  const lang = useSettings((s) => s.language);
  return (te: string, en: string) => (lang === 'te' ? te : en);
}

/** Yes/No question that also works in the web preview. */
function ask(title: string, yes: string, no: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(title));
  return new Promise((res) => Alert.alert('MAVY NEWS', title, [{ text: no, style: 'cancel', onPress: () => res(false) }, { text: yes, onPress: () => res(true) }], { cancelable: true, onDismiss: () => res(false) }));
}
function tell(text: string) {
  if (Platform.OS === 'web') window.alert(text); else Alert.alert('MAVY NEWS', text);
}
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** A small box that asks for a reason / note (Android has no text prompt built in). */
function NoteBox({ visible, title, onCancel, onSend }: { visible: boolean; title: string; onCancel: () => void; onSend: (note: string) => void }) {
  const th = useTheme();
  const L = useL();
  const font = useFont();
  const [note, setNote] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBg}>
        <View style={[styles.modal, { backgroundColor: th.card }]}>
          <T bold size={16}>{title}</T>
          <TextInput value={note} onChangeText={setNote} multiline autoFocus maxLength={500} textAlignVertical="top"
            style={[styles.input, { color: th.text, borderColor: th.border, minHeight: 100, fontFamily: font() }]} accessibilityLabel={title} />
          <View style={[styles.row, { marginTop: 12 }]}>
            <Button kind="outline" title={L('రద్దు', 'Cancel')} style={{ flex: 1, marginRight: 8 }} onPress={() => { setNote(''); onCancel(); }} />
            <Button title={L('పంపండి', 'Send')} disabled={!note.trim()} style={{ flex: 1 }} onPress={() => { const n = note.trim(); setNote(''); onSend(n); }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function call(phone?: string | null) {
  return phone ? (
    <Pressable onPress={() => Linking.openURL(`tel:${phone}`)} hitSlop={6} accessibilityRole="link">
      <T bold size={13} color="#2563EB">📞 {phone.replace(/^\+91/, '')}</T>
    </Pressable>
  ) : null;
}

// ================= Login =================
export function AdminLoginScreen({ navigation }: any) {
  const th = useTheme();
  const L = useL();
  const font = useFont();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = [styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card, fontFamily: font() }];

  const login = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await api<{ accessToken: string; refreshToken: string; role: string }>('/auth/staff/login', { method: 'POST', body: { email: email.trim(), password } });
      if (!ADMIN_ROLES.includes(r.role)) {
        api('/auth/logout', { method: 'POST', body: { refreshToken: r.refreshToken } }).catch(() => undefined);
        throw new Error(L('ఈ లాగిన్ అడ్మిన్లు, సబ్-అడ్మిన్ల కోసం మాత్రమే. రిపోర్టర్లు వెబ్ న్యూస్‌రూమ్ వాడండి.', 'This login is only for admins and sub-admins. Reporters please use the web newsroom.'));
      }
      await saveLogin(r.accessToken, r.refreshToken);
      setPassword('');
      qc.clear();
      navigation.replace('Admin');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
      <Ionicons name="shield-checkmark-outline" size={48} color={th.green} />
      <T bold size={22} style={{ marginTop: 12 }}>{L('అడ్మిన్ లాగిన్', 'Admin login')}</T>
      <T color={th.muted} style={{ marginTop: 4, marginBottom: 20 }}>{L('అడ్మిన్, సబ్-అడ్మిన్ల కోసం. మీకు ఇచ్చిన ఈమెయిల్, పాస్‌వర్డ్ నమోదు చేయండి.', 'For admins and sub-admins. Enter the email and password you were given.')}</T>
      <T bold size={14}>{L('యూజర్‌నేమ్ / ఈమెయిల్', 'Username / email')}</T>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="username"
        style={input} accessibilityLabel="Username" placeholder="admin" placeholderTextColor={th.muted} />
      <T bold size={14} style={{ marginTop: 14 }}>{L('పాస్‌వర్డ్', 'Password')}</T>
      <View style={styles.row}>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="password"
          style={[...input, { flex: 1 }]} accessibilityLabel="Password" onSubmitEditing={login} />
        <Pressable onPress={() => setShow(!show)} style={{ padding: 10 }} accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={24} color={th.muted} />
        </Pressable>
      </View>
      <Button title={L('లాగిన్', 'Log in')} icon="log-in-outline" onPress={login} loading={busy} disabled={email.trim().length < 3 || password.length < 6} style={{ marginTop: 18 }} />
      {error ? <T color={th.red} style={{ marginTop: 14 }}>{error}</T> : null}
      <Pressable onPress={() => navigation.navigate('AdminPassword', { login: email.trim() })} style={{ marginTop: 22, alignItems: 'center' }} accessibilityRole="link">
        <T color={th.green} bold>{L('పాస్‌వర్డ్ మర్చిపోయారా? / మార్చండి (OTP)', 'Forgot / change password (OTP)')}</T>
      </Pressable>
    </ScrollView>
  );
}

// ================= Change / forgotten password (OTP to the recovery mobile) =================
export function AdminPasswordScreen({ navigation, route }: any) {
  const th = useTheme();
  const L = useL();
  const font = useFont();
  const qc = useQueryClient();
  const [login, setLogin] = useState<string>(route?.params?.login || '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = [styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card, fontFamily: font() }];

  const sendOtp = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await api<{ to: string }>('/auth/staff/password/otp', { method: 'POST', body: { login: login.trim() } });
      setSentTo(r.to);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    setError('');
    if (!PASSWORD_RULE.test(pw)) return setError(L('పాస్‌వర్డ్ కనీసం 10 అక్షరాలు, అక్షరాలు + అంకెలు ఉండాలి', 'Password: at least 10 characters with letters and numbers'));
    if (pw !== pw2) return setError(L('రెండు పాస్‌వర్డ్‌లు ఒకేలా లేవు', 'The two passwords do not match'));
    setBusy(true);
    try {
      await api('/auth/staff/password/reset', { method: 'POST', body: { login: login.trim(), code: code.trim(), newPassword: pw } });
      // every session of this account was logged out: start fresh
      if (useAuth.getState().loggedIn) { await logout(); qc.clear(); }
      tell(L('✔ పాస్‌వర్డ్ మార్చబడింది. కొత్త పాస్‌వర్డ్‌తో లాగిన్ అవ్వండి.', '✔ Password changed. Log in with the new password.'));
      navigation.navigate('AdminLogin');
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
      <Ionicons name="key-outline" size={44} color={th.green} />
      <T bold size={21} style={{ marginTop: 10 }}>{L('పాస్‌వర్డ్ మార్చండి', 'Change password')}</T>
      <T color={th.muted} style={{ marginTop: 4, marginBottom: 18, lineHeight: 22 }}>{L('మీ రిజిస్టర్డ్ మొబైల్‌కు OTP వస్తుంది. ఆ OTP తో కొత్త పాస్‌వర్డ్ పెట్టండి.', 'An OTP is sent to your registered mobile. Use it to set a new password.')}</T>
      <T bold size={14}>{L('యూజర్‌నేమ్ / ఈమెయిల్', 'Username / email')}</T>
      <TextInput value={login} onChangeText={setLogin} editable={!sentTo} autoCapitalize="none" autoCorrect={false} style={input} placeholder="admin" placeholderTextColor={th.muted} accessibilityLabel="Username" />
      {!sentTo ? (
        <Button title={L('OTP పంపండి', 'Send OTP')} icon="chatbubble-ellipses-outline" loading={busy} disabled={busy || login.trim().length < 3} onPress={sendOtp} style={{ marginTop: 16 }} />
      ) : (
        <>
          <T style={{ marginTop: 16 }}>{L(`OTP పంపబడింది: ${sentTo} (10 నిమిషాలు చెల్లుతుంది)`, `OTP sent to ${sentTo} (valid 10 minutes)`)}</T>
          <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp"
            placeholder="● ● ● ● ● ●" placeholderTextColor={th.muted} style={[...input, { marginTop: 8, fontSize: 22, letterSpacing: 6, textAlign: 'center' }]} accessibilityLabel="OTP" />
          <T bold size={14} style={{ marginTop: 14 }}>{L('కొత్త పాస్‌వర్డ్ (10+ అక్షరాలు, అంకెలతో)', 'New password (10+ characters, with numbers)')}</T>
          <View style={styles.row}>
            <TextInput value={pw} onChangeText={setPw} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} style={[...input, { flex: 1 }]} accessibilityLabel="New password" />
            <Pressable onPress={() => setShow(!show)} style={{ padding: 10 }} accessibilityRole="button"><Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={24} color={th.muted} /></Pressable>
          </View>
          <T bold size={14} style={{ marginTop: 14 }}>{L('మళ్లీ టైప్ చేయండి', 'Type it again')}</T>
          <TextInput value={pw2} onChangeText={setPw2} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} style={input} accessibilityLabel="Repeat new password" />
          <Button title={L('పాస్‌వర్డ్ మార్చండి', 'Change password')} icon="checkmark-circle-outline" loading={busy} disabled={busy || code.length !== 6 || !pw} onPress={save} style={{ marginTop: 18 }} />
          <Pressable onPress={() => { setSentTo(null); setCode(''); }} style={{ marginTop: 14, alignItems: 'center' }}><T color={th.green}>{L('OTP మళ్లీ పంపండి', 'Send OTP again')}</T></Pressable>
        </>
      )}
      {error ? <T color={th.red} style={{ marginTop: 14 }}>{error}</T> : null}
    </ScrollView>
  );
}

// ================= Admin home =================
export function AdminHomeScreen({ navigation }: any) {
  const th = useTheme();
  const L = useL();
  const qc = useQueryClient();
  const { isAdmin, role, me } = useIsAdmin();
  const counts = useQuery({
    queryKey: ['admin', 'counts'],
    enabled: isAdmin,
    queryFn: async () => {
      const [w, a, j] = await Promise.all([
        api<{ total: number }>('/newsroom/articles?limit=1&source=journalist&statuses=SUBMITTED,IN_REVIEW'),
        api<unknown[]>('/admin/journalist-applications?status=PENDING'),
        api<unknown[]>('/admin/journalists'),
      ]);
      return { waiting: w.total, requests: a.length, journalists: j.length };
    },
  });
  if (me.isPending) return <ActivityIndicator color={th.green} style={{ margin: 40 }} />;
  if (!isAdmin)
    return <EmptyState icon="lock-closed-outline" title={L('అడ్మిన్ లాగిన్ అవసరం', 'Admin login needed')} action={{ title: L('అడ్మిన్ లాగిన్', 'Admin login'), onPress: () => navigation.replace('AdminLogin') }} />;
  const roleName = role === 'SUPER_ADMIN' ? L('సూపర్ అడ్మిన్', 'Super Admin') : role === 'MANAGING_EDITOR' ? L('మేనేజింగ్ ఎడిటర్', 'Managing Editor') : L('సబ్-అడ్మిన్', 'Sub-admin');
  const c = counts.data;
  const item = (icon: any, title: string, sub: string, screen: string, badge?: number) => (
    <Pressable onPress={() => navigation.navigate(screen)} accessibilityRole="button" style={({ pressed }) => [styles.card, styles.row, { backgroundColor: th.card, borderColor: th.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.iconCircle, { backgroundColor: th.navy }]}><Ionicons name={icon} size={22} color="#fff" /></View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <T bold size={16}>{title}</T>
        <T size={12.5} color={th.muted}>{sub}</T>
      </View>
      {badge ? <View style={[styles.count, { backgroundColor: th.red }]}><T bold size={13} color="#fff">{badge}</T></View> : null}
      <Ionicons name="chevron-forward" size={18} color={th.muted} />
    </Pressable>
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={counts.isRefetching} onRefresh={() => { counts.refetch(); }} />}>
      <View style={[styles.card, { backgroundColor: th.navy, borderColor: th.navy }]}>
        <T bold size={18} color="#fff">{me.data?.name || me.data?.email}</T>
        <T size={13} color="#C9D3E3">{roleName} · {me.data?.email}</T>
      </View>
      <View style={[styles.row, { marginBottom: 10 }]}>
        <Count n={c?.waiting} label={L('సమీక్షకు వార్తలు', 'Stories waiting')} />
        <Count n={c?.requests} label={L('కొత్త దరఖాస్తులు', 'New requests')} />
        <Count n={c?.journalists} label={L('జర్నలిస్టులు', 'Journalists')} />
      </View>
      {counts.isError ? <T color={th.red} style={{ marginBottom: 8 }}>{errText(counts.error)}</T> : null}
      {item('newspaper-outline', L('వార్తల సమీక్ష', 'Review stories'), L('ఆమోదించి ప్రచురించండి, మార్పులు కోరండి', 'Approve & publish, send back, reject'), 'AdminReview', c?.waiting)}
      {item('id-card-outline', L('జర్నలిస్ట్ దరఖాస్తులు', 'Journalist requests'), L('ఆధార్ చూసి ఆమోదించండి', 'Check Aadhaar and approve'), 'AdminRequests', c?.requests)}
      {item('ribbon-outline', L('జర్నలిస్టులు & పాయింట్లు', 'Journalists & points'), L('స్థాయిలు, పాయింట్లు, నిలిపివేత', 'Levels, points, suspend'), 'AdminJournalists')}
      {role === 'SUPER_ADMIN' ? item('people-outline', L('సబ్-అడ్మిన్లు', 'Sub-admins'), L('జిల్లా / మండలానికి సబ్-అడ్మిన్', 'For a district or a mandal'), 'AdminSubAdmins') : null}
      <Button kind="outline" icon="key-outline" title={L('పాస్‌వర్డ్ మార్చండి (OTP)', 'Change password (OTP)')} style={{ marginTop: 16 }}
        onPress={() => navigation.navigate('AdminPassword', { login: (me.data as any)?.username || me.data?.email })} />
      <Button kind="outline" icon="log-out-outline" title={L('అడ్మిన్ లాగ్ అవుట్', 'Admin log out')} style={{ marginTop: 10 }}
        onPress={async () => { await logout(); qc.clear(); navigation.navigate('Main', { screen: 'Profile' }); }} />
      <T size={12} color={th.muted} style={{ marginTop: 14, textAlign: 'center' }}>
        {L('కంప్యూటర్‌లో కూడా:', 'Also on a computer:')} {serverUrl()}/admin
      </T>
    </ScrollView>
  );
}

function Count({ n, label }: { n?: number; label: string }) {
  const th = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: th.card }]}>
      <T bold size={24} color={th.navy === th.header ? th.navy : th.green}>{n ?? '–'}</T>
      <T size={11.5} color={th.muted} style={{ textAlign: 'center' }}>{label}</T>
    </View>
  );
}

// ================= Review stories =================
const STATUS_LABEL: Record<string, [string, string, string]> = {
  SUBMITTED: ['సమీక్షకు', 'Waiting', '#2563EB'], IN_REVIEW: ['సమీక్షలో', 'In review', '#2563EB'], CHANGES_REQUESTED: ['మార్పులు కావాలి', 'Sent back', '#B45309'],
  APPROVED: ['ఆమోదం', 'Approved', '#7C3AED'], SCHEDULED: ['షెడ్యూల్', 'Scheduled', '#7C3AED'], PUBLISHED: ['ప్రచురితం', 'Published', '#16A34A'],
  REJECTED: ['తిరస్కరణ', 'Rejected', '#D7262E'], ARCHIVED: ['తీసివేశారు', 'Taken down', '#D7262E'], DRAFT: ['డ్రాఫ్ట్', 'Draft', '#6B7280'],
};
interface AdminArticle {
  id: string; slug: string; status: string; isBreaking: boolean; heroImageUrl: string | null; updatedAt: string;
  translations: { language: string; headline: string; summary: string; body: string }[];
  category: { nameTe: string; nameEn: string } | null;
  locations: { location: { nameTe: string; nameEn: string } }[];
  author: { name: string | null; contributorLevel: JournalistLevel | null; phone: string | null } | null;
}

export function AdminReviewScreen() {
  const th = useTheme();
  const L = useL();
  const lang = useSettings((s) => s.language);
  const qc = useQueryClient();
  const { role } = useIsAdmin();
  const [statuses, setStatuses] = useState('SUBMITTED,IN_REVIEW');
  const [source, setSource] = useState<'journalist' | 'staff' | ''>('journalist');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ a: AdminArticle; action: 'request_changes' | 'reject' | 'archive' | 'delete' } | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'review', statuses, source],
    queryFn: () => api<{ items: AdminArticle[]; total: number }>(`/newsroom/articles?limit=50&statuses=${statuses}${source ? `&source=${source}` : ''}`),
  });
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['admin', 'counts'] }); };
  const move = (id: string, action: string, note?: string) => api(`/newsroom/articles/${id}/transition`, { method: 'POST', body: note ? { action, note } : { action } });

  const publish = async (a: AdminArticle) => {
    setBusyId(a.id);
    try {
      const plan = ({ SUBMITTED: ['start_review', 'approve', 'publish'], IN_REVIEW: ['approve', 'publish'], APPROVED: ['publish'] } as Record<string, string[]>)[a.status] ?? [];
      for (const action of plan) await move(a.id, action);
      tell(L('✔ ప్రచురించబడింది. జర్నలిస్ట్‌కు పాయింట్లు జమ అయ్యాయి.', '✔ Published. Points added for the journalist.'));
      refresh();
    } catch (e) { tell(errText(e)); } finally { setBusyId(null); }
  };
  const withNote = async (note: string) => {
    if (!noteFor) return;
    const { a, action } = noteFor;
    setNoteFor(null);
    if (action === 'delete') return remove(a, note);
    setBusyId(a.id);
    try {
      if (action === 'reject' && a.status === 'SUBMITTED') await move(a.id, 'start_review');
      await move(a.id, action, note);
      refresh();
    } catch (e) { tell(errText(e)); } finally { setBusyId(null); }
  };

  const ALL = 'DRAFT,SUBMITTED,IN_REVIEW,CHANGES_REQUESTED,APPROVED,SCHEDULED,PUBLISHED,REJECTED,ARCHIVED';
  const remove = async (a: AdminArticle, reason?: string) => {
    setBusyId(a.id);
    try {
      await api(`/newsroom/articles/${a.id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`, { method: 'DELETE' });
      tell(L('✔ తొలగించబడింది', '✔ Deleted'));
      refresh();
    } catch (e) { tell(errText(e)); } finally { setBusyId(null); }
  };
  const askDelete = async (a: AdminArticle) => {
    const live = a.status === 'PUBLISHED' || a.status === 'SCHEDULED';
    const t0 = a.translations[0]?.headline ?? '';
    if (!(await ask(L(`ఈ వార్తను శాశ్వతంగా తొలగించాలా? తిరిగి తీసుకురాలేము.\n\n${t0}`, `Delete this story for good? This cannot be undone.\n\n${t0}`), L('తొలగించు', 'Delete'), L('రద్దు', 'Cancel')))) return;
    if (live) setNoteFor({ a, action: 'delete' });
    else remove(a);
  };
  const filters: [string, string, string][] = [
    ['SUBMITTED,IN_REVIEW', 'సమీక్షకు', 'Waiting'], [ALL, 'అన్నీ', 'All'], ['DRAFT', 'డ్రాఫ్ట్‌లు', 'Drafts'], ['CHANGES_REQUESTED', 'తిరిగి పంపినవి', 'Sent back'], ['PUBLISHED', 'ప్రచురితం', 'Published'],
    ['REJECTED', 'తిరస్కరణ', 'Rejected'], ['ARCHIVED', 'తీసివేసినవి', 'Taken down'],
  ];
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map(([v, te, en]) => <Chip key={v} label={lang === 'te' ? te : en} active={statuses === v} onPress={() => setStatuses(v)} />)}
        </ScrollView>
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Chip label={L('జర్నలిస్టులు', 'Journalists')} active={source === 'journalist'} onPress={() => setSource('journalist')} />
          <Chip label={L('న్యూస్‌రూమ్', 'Newsroom')} active={source === 'staff'} onPress={() => setSource('staff')} />
          <Chip label={L('అన్నీ', 'All')} active={source === ''} onPress={() => setSource('')} />
        </View>
      </View>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data?.items ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={q.isFetching && !q.isPending} onRefresh={refresh} />}
          ListEmptyComponent={q.isPending ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : <T color={th.muted} style={{ textAlign: 'center', margin: 30 }}>{L('✔ ఇక్కడ వార్తలు ఏవీ లేవు', '✔ Nothing here')}</T>}
          renderItem={({ item: a }) => {
            const t = a.translations.find((x) => x.language === lang) ?? a.translations[0];
            const s = STATUS_LABEL[a.status] ?? STATUS_LABEL.DRAFT;
            const busy = busyId === a.id;
            const places = a.locations.map((l) => (lang === 'te' ? l.location.nameTe : l.location.nameEn)).join(', ');
            return (
              <View style={[styles.card, { backgroundColor: th.card, borderColor: th.border }]}>
                <View style={styles.row}>
                  <View style={[styles.status, { backgroundColor: s[2] }]}><T bold size={11.5} color="#fff">{lang === 'te' ? s[0] : s[1]}</T></View>
                  <T size={12} color={th.muted} style={{ marginLeft: 8, flex: 1 }} numberOfLines={1}>
                    {a.category ? (lang === 'te' ? a.category.nameTe : a.category.nameEn) : ''}{places ? ` · 📍 ${places}` : ''}
                  </T>
                </View>
                <T bold size={17} style={{ marginTop: 8, lineHeight: 26 }}>{a.isBreaking ? '🔴 ' : ''}{t?.headline}</T>
                {a.heroImageUrl ? <Image source={{ uri: a.heroImageUrl }} style={styles.hero} resizeMode="cover" /> : null}
                <T size={15} style={{ marginTop: 8, lineHeight: 25 }}>{t?.body || t?.summary}</T>
                <View style={[styles.row, { marginTop: 10, flexWrap: 'wrap' }]}>
                  <T bold size={13} style={{ marginRight: 6 }}>✍ {a.author?.name ?? '—'}</T>
                  {a.author?.contributorLevel ? <LevelBadge level={a.author.contributorLevel} small /> : null}
                  <View style={{ width: 8 }} />
                  {call(a.author?.phone)}
                </View>
                {busy ? <ActivityIndicator color={th.green} style={{ marginTop: 12 }} /> : (
                  <View style={{ marginTop: 12 }}>
                    {['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(a.status) ? (
                      <>
                        <Button title={L('ఆమోదించి ప్రచురించు', 'Approve & publish')} icon="checkmark-circle-outline" onPress={() => publish(a)} />
                        <View style={[styles.row, { marginTop: 8 }]}>
                          <Button kind="outline" title={L('మార్పులు కోరండి', 'Send back')} icon="return-up-back-outline" style={{ flex: 1, marginRight: 8 }}
                            onPress={() => setNoteFor({ a, action: 'request_changes' })} />
                          {a.status !== 'APPROVED' ? <Button kind="danger" title={L('తిరస్కరించు', 'Reject')} icon="close-circle-outline" style={{ flex: 1 }}
                            onPress={() => setNoteFor({ a, action: 'reject' })} /> : null}
                        </View>
                      </>
                    ) : null}
                    {a.status === 'PUBLISHED' && role !== 'DISTRICT_EDITOR' ? (
                      <Button kind="outline" title={L('తీసివేయి (పాయింట్లు వెనక్కి)', 'Take down (points taken back)')} icon="eye-off-outline" onPress={() => setNoteFor({ a, action: 'archive' })} />
                    ) : null}
                    {role !== 'DISTRICT_EDITOR' || !['PUBLISHED', 'SCHEDULED'].includes(a.status) ? (
                      <Button kind="danger" title={L('శాశ్వతంగా తొలగించు', 'Delete for good')} icon="trash-outline" style={{ marginTop: 8 }} onPress={() => askDelete(a)} />
                    ) : null}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
      <NoteBox visible={!!noteFor} onCancel={() => setNoteFor(null)} onSend={withNote}
        title={noteFor?.action === 'request_changes' ? L('ఏమి మార్చాలి? (జర్నలిస్ట్‌కు యాప్‌లో కనిపిస్తుంది)', 'What should they fix? (shown in their app)')
          : noteFor?.action === 'reject' ? L('ఎందుకు తిరస్కరిస్తున్నారు?', 'Why are you rejecting it?')
          : noteFor?.action === 'delete' ? L('ఎందుకు తొలగిస్తున్నారు?', 'Why are you deleting it?') : L('ఎందుకు తీసివేస్తున్నారు?', 'Why are you taking it down?')} />
    </View>
  );
}

// ================= Journalist requests =================
interface Request {
  id: string; name: string; phone: string | null; status: string; note: string | null; createdAt: string; reviewedAt: string | null; hasAadhaar: boolean;
  place: { nameTe: string; nameEn: string };
}

/** Loads the private Aadhaar photo into memory only (never saved on the phone). */
async function loadAadhaar(id: string): Promise<string> {
  const res = await fetch(`${serverUrl()}/api/v1/admin/journalist-applications/${id}/aadhaar`, { headers: { Authorization: `Bearer ${useAuth.getState().access}` } });
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'The Aadhaar photo was already deleted' : 'Could not load the photo');
  const blob = await res.blob();
  return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = fail; r.readAsDataURL(blob); });
}

export function AdminRequestsScreen() {
  const th = useTheme();
  const L = useL();
  const lang = useSettings((s) => s.language);
  const qc = useQueryClient();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const q = useQuery({ queryKey: ['admin', 'requests', status], queryFn: () => api<Request[]>(`/admin/journalist-applications?status=${status}`) });
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['admin', 'counts'] }); };
  const decide = async (r: Request, decision: 'approve' | 'reject', note?: string) => {
    setBusyId(r.id);
    try {
      await api(`/admin/journalist-applications/${r.id}/decision`, { method: 'POST', body: { decision, note } });
      setPhotos((p) => { const n = { ...p }; delete n[r.id]; return n; });
      tell(decision === 'approve' ? L(`✔ ${r.name} ఇప్పుడు జూనియర్ జర్నలిస్ట్.`, `✔ ${r.name} is now a Junior Journalist.`) : L('✔ తిరస్కరించబడింది', '✔ Rejected'));
      refresh();
    } catch (e) { tell(errText(e)); } finally { setBusyId(null); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <View style={[styles.row, { paddingHorizontal: 12, paddingTop: 10 }]}>
        <Chip label={L('కొత్తవి', 'Waiting')} active={status === 'PENDING'} onPress={() => setStatus('PENDING')} />
        <Chip label={L('ఆమోదించినవి', 'Approved')} active={status === 'APPROVED'} onPress={() => setStatus('APPROVED')} />
        <Chip label={L('తిరస్కరించినవి', 'Rejected')} active={status === 'REJECTED'} onPress={() => setStatus('REJECTED')} />
      </View>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={q.isFetching && !q.isPending} onRefresh={refresh} />}
          ListHeaderComponent={status === 'PENDING' ? <T size={13} color={th.muted} style={{ marginBottom: 10, lineHeight: 20 }}>🔒 {L('ఆధార్ ఫోటో, పేరు సరిపోలుతున్నాయో చూడండి. నిర్ణయం తర్వాత ఫోటో సర్వర్ నుంచి శాశ్వతంగా తొలగించబడుతుంది. ఫోటో ఫోన్‌లో సేవ్ అవ్వదు.', 'Check the name matches the Aadhaar. The photo is deleted from the server after your decision and is never saved on this phone.')}</T> : undefined}
          ListEmptyComponent={q.isPending ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : <T color={th.muted} style={{ textAlign: 'center', margin: 30 }}>{L('✔ దరఖాస్తులు ఏవీ లేవు', '✔ No requests')}</T>}
          renderItem={({ item: r }) => (
            <View style={[styles.card, { backgroundColor: th.card, borderColor: th.border }]}>
              <T bold size={18}>{r.name}</T>
              <T size={13.5} color={th.muted} style={{ marginTop: 2 }}>📍 {lang === 'te' ? r.place.nameTe : r.place.nameEn} · {new Date(r.createdAt).toLocaleDateString(lang === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short' })}</T>
              <View style={{ marginTop: 4 }}>{call(r.phone)}</View>
              {r.note ? <T size={13.5} style={{ marginTop: 6 }}>{L('గమనిక', 'Note')}: {r.note}</T> : null}
              {photos[r.id] ? <Image source={{ uri: photos[r.id] }} style={styles.aadhaar} resizeMode="contain" accessibilityLabel="Aadhaar" /> : null}
              {r.status === 'PENDING' ? (busyId === r.id ? <ActivityIndicator color={th.green} style={{ marginTop: 12 }} /> : (
                <View style={{ marginTop: 12 }}>
                  {r.hasAadhaar && !photos[r.id] ? (
                    <Button kind="outline" icon="id-card-outline" title={L('ఆధార్ చూడండి', 'View Aadhaar')} style={{ marginBottom: 8 }}
                      onPress={async () => { setBusyId(r.id); try { const uri = await loadAadhaar(r.id); setPhotos((p) => ({ ...p, [r.id]: uri })); } catch (e) { tell(errText(e)); } finally { setBusyId(null); } }} />
                  ) : null}
                  <View style={styles.row}>
                    <Button title={L('ఆమోదించు', 'Approve')} icon="checkmark-circle-outline" style={{ flex: 1, marginRight: 8 }}
                      onPress={async () => { if (await ask(L(`${r.name} ను జూనియర్ జర్నలిస్ట్‌గా ఆమోదించాలా?`, `Approve ${r.name} as Junior Journalist?`), L('ఆమోదించు', 'Approve'), L('రద్దు', 'Cancel'))) decide(r, 'approve'); }} />
                    <Button kind="danger" title={L('తిరస్కరించు', 'Reject')} icon="close-circle-outline" style={{ flex: 1 }} onPress={() => setRejecting(r)} />
                  </View>
                </View>
              )) : null}
            </View>
          )}
        />
      )}
      <NoteBox visible={!!rejecting} title={L('కారణం రాయండి (వ్యక్తికి యాప్‌లో కనిపిస్తుంది)', 'Reason (shown to the person)')}
        onCancel={() => setRejecting(null)} onSend={(n) => { const r = rejecting!; setRejecting(null); decide(r, 'reject', n); }} />
    </View>
  );
}

// ================= Journalists =================
interface Journalist {
  id: string; name: string | null; phone: string | null; level: JournalistLevel; points: number; approvedPosts: number; suspendedAt: string | null;
  place: { nameTe: string; nameEn: string };
}
export function AdminJournalistsScreen() {
  const th = useTheme();
  const L = useL();
  const lang = useSettings((s) => s.language);
  const [suspending, setSuspending] = useState<Journalist | null>(null);
  const q = useQuery({ queryKey: ['admin', 'journalists'], queryFn: () => api<Journalist[]>('/admin/journalists') });
  const act = async (j: Journalist, action: 'suspend' | 'reactivate', reason?: string) => {
    try { await api(`/admin/journalists/${j.id}`, { method: 'PATCH', body: { action, reason } }); q.refetch(); } catch (e) { tell(errText(e)); }
  };
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={q.isFetching && !q.isPending} onRefresh={() => { q.refetch(); }} />}
        ListHeaderComponent={<T size={13} color={th.muted} style={{ marginBottom: 10, lineHeight: 20 }}>{L('జూనియర్ 5 · జర్నలిస్ట్ (100+) 10 · సీనియర్ (500+, బ్యాడ్జ్) 20 పాయింట్లు ఒక్కో ప్రచురిత వార్తకు.', 'Junior 5 · Journalist (100+) 10 · Senior (500+, badge) 20 points per published story.')}</T>}
        ListEmptyComponent={q.isPending ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : <T color={th.muted} style={{ textAlign: 'center', margin: 30 }}>{L('ఇంకా జర్నలిస్టులు లేరు', 'No journalists yet')}</T>}
        renderItem={({ item: j, index }) => (
          <View style={[styles.card, { backgroundColor: th.card, borderColor: j.suspendedAt ? th.red : th.border }]}>
            <View style={styles.row}>
              <T bold size={16} style={{ flex: 1 }}>{index + 1}. {j.name ?? '—'}</T>
              <T bold size={18} color={th.green}>{j.points}</T>
              <T size={12} color={th.muted}> {L('పాయింట్లు', 'pts')}</T>
            </View>
            <View style={[styles.row, { marginTop: 6, flexWrap: 'wrap' }]}>
              <LevelBadge level={j.level} small />
              <T size={13} color={th.muted} style={{ marginLeft: 8 }}>{j.approvedPosts} {L('వార్తలు', 'stories')} · 📍 {lang === 'te' ? j.place.nameTe : j.place.nameEn}</T>
            </View>
            <View style={[styles.row, { marginTop: 8 }]}>
              <View style={{ flex: 1 }}>{call(j.phone)}</View>
              {j.suspendedAt
                ? <Button title={L('మళ్లీ అనుమతించు', 'Reactivate')} onPress={() => act(j, 'reactivate')} />
                : <Button kind="outline" icon="pause-circle-outline" title={L('నిలిపివేయి', 'Suspend')} onPress={() => setSuspending(j)} />}
            </View>
          </View>
        )}
      />
      <NoteBox visible={!!suspending} title={L('ఎందుకు నిలిపివేస్తున్నారు?', 'Why suspend?')}
        onCancel={() => setSuspending(null)} onSend={(n) => { const j = suspending!; setSuspending(null); act(j, 'suspend', n); }} />
    </View>
  );
}

// ================= Sub-admins (Super Admin) =================
interface Staff {
  userId: string; designation: string | null; suspendedAt: string | null; revokedAt: string | null;
  user: { id: string; email: string | null; name: string | null; phone: string | null; role: string };
  assignments: { nameTe: string; nameEn: string }[];
}
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,}$/;

export function AdminSubAdminsScreen() {
  const th = useTheme();
  const L = useL();
  const lang = useSettings((s) => s.language);
  const font = useFont();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [place, setPlace] = useState<{ district?: Place; mandal?: Place }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suspending, setSuspending] = useState<Staff | null>(null);
  const list = useQuery({ queryKey: ['admin', 'staff'], queryFn: () => api<Staff[]>('/admin/staff') });
  const input = [styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card, fontFamily: font() }];
  const nm = (p: { nameTe: string; nameEn: string }) => (lang === 'te' ? p.nameTe : p.nameEn);

  const create = async () => {
    setError('');
    if (name.trim().length < 2) return setError(L('పేరు రాయండి', 'Enter the name'));
    if (!email.includes('@')) return setError(L('సరైన ఈమెయిల్ రాయండి', 'Enter a valid email'));
    if (!PASSWORD_RULE.test(password)) return setError(L('పాస్‌వర్డ్ కనీసం 10 అక్షరాలు, అక్షరాలు + అంకెలు ఉండాలి', 'Password: at least 10 characters with letters and numbers'));
    if (!place.district) return setError(L('జిల్లా ఎంచుకోండి', 'Choose a district'));
    const area = place.mandal ?? place.district;
    setBusy(true);
    try {
      await api('/admin/staff', { method: 'POST', body: {
        name: name.trim(), email: email.trim().toLowerCase(), password, role: 'DISTRICT_EDITOR', designation: `Sub-admin · ${area.nameEn}`,
        locationIds: [area.id], ...(phone.trim() ? { phone: phone.trim() } : {}),
      } });
      const details = `MAVY NEWS ${L('సబ్-అడ్మిన్', 'sub-admin')} (${nm(area)})\n${L('యాప్ → ప్రొఫైల్ → అడ్మిన్ లాగిన్', 'App → Profile → Admin login')}\n${L('ఈమెయిల్', 'Email')}: ${email.trim().toLowerCase()}\n${L('పాస్‌వర్డ్', 'Password')}: ${password}`;
      setName(''); setEmail(''); setPhone(''); setPassword(''); setPlace({});
      list.refetch();
      if (await ask(L('✔ సబ్-అడ్మిన్ సృష్టించబడింది. లాగిన్ వివరాలు వారికి (WhatsApp ద్వారా) పంపాలా?', '✔ Sub-admin created. Send them the login details (e.g. WhatsApp)?'), L('పంపండి', 'Send'), L('తర్వాత', 'Later')))
        Share.share({ message: details }).catch(() => undefined);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const act = async (s: Staff, action: 'suspend' | 'reactivate', reason?: string) => {
    try { await api(`/admin/staff/${s.user.id}`, { method: 'PATCH', body: { action, reason } }); list.refetch(); } catch (e) { tell(errText(e)); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { backgroundColor: th.card, borderColor: th.green }]}>
        <T bold size={18}>{L('కొత్త సబ్-అడ్మిన్', 'New sub-admin')}</T>
        <T size={13} color={th.muted} style={{ marginTop: 4, lineHeight: 20 }}>{L('సబ్-అడ్మిన్ తన జిల్లా / మండలం వార్తలు, జర్నలిస్ట్ దరఖాస్తులు మాత్రమే చూసి ఆమోదించగలరు.', 'A sub-admin can review stories and journalist requests only from their own area.')}</T>
        <T bold style={styles.label}>{L('పేరు', 'Name')} *</T>
        <TextInput value={name} onChangeText={setName} maxLength={80} style={input} accessibilityLabel="Name" />
        <T bold style={styles.label}>{L('ఈమెయిల్ (లాగిన్ కోసం)', 'Email (for login)')} *</T>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={input} accessibilityLabel="Email" />
        <T bold style={styles.label}>{L('పాస్‌వర్డ్ (10+ అక్షరాలు, అంకెలతో)', 'Password (10+ characters, with numbers)')} *</T>
        <TextInput value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} style={input} accessibilityLabel="Password" />
        <T bold style={styles.label}>{L('మొబైల్ (ఐచ్ఛికం)', 'Mobile (optional)')}</T>
        <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, '').slice(0, 13))} keyboardType="phone-pad" style={input} accessibilityLabel="Mobile" />
        <T bold style={styles.label}>{L('ప్రాంతం — జిల్లా, లేదా ఒక మండలం', 'Area — a district, or one mandal')} *</T>
        <PlaceSelect value={place} onChange={setPlace} />
        {place.district ? <T bold color={th.green} style={{ marginTop: 8 }}>→ {place.mandal ? `${nm(place.mandal)} ${L('మండలం', 'mandal')}` : `${nm(place.district)} ${L('జిల్లా మొత్తం', '(whole district)')}`}</T> : null}
        {error ? <T color={th.red} bold style={{ marginTop: 10 }}>{error}</T> : null}
        <Button title={L('సబ్-అడ్మిన్ సృష్టించండి', 'Create sub-admin')} icon="person-add-outline" loading={busy} disabled={busy} onPress={create} style={{ marginTop: 14 }} />
      </View>

      <T bold size={17} style={{ marginTop: 10, marginBottom: 8 }}>{L('సబ్-అడ్మిన్లు & సిబ్బంది', 'Sub-admins & staff')}</T>
      {list.isPending ? <ActivityIndicator color={th.green} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (list.data ?? []).map((s) => {
        const off = s.suspendedAt || s.revokedAt;
        const areas = s.assignments.map(nm).join(', ') || (['SUPER_ADMIN', 'MANAGING_EDITOR'].includes(s.user.role) ? L('అన్ని ప్రాంతాలు', 'All areas') : '—');
        return (
          <View key={s.userId} style={[styles.card, { backgroundColor: th.card, borderColor: off ? th.red : th.border }]}>
            <T bold size={15.5}>{s.user.name || s.user.email}</T>
            <T size={12.5} color={th.muted}>{s.user.role === 'DISTRICT_EDITOR' ? L('సబ్-అడ్మిన్', 'Sub-admin') : s.user.role} · 📍 {areas}</T>
            <T size={12.5} color={th.muted}>{s.user.email}</T>
            <View style={[styles.row, { marginTop: 6 }]}>
              <View style={{ flex: 1 }}>{call(s.user.phone)}</View>
              {s.user.role === 'SUPER_ADMIN' ? null : off
                ? <Button title={L('మళ్లీ అనుమతించు', 'Reactivate')} onPress={() => act(s, 'reactivate')} />
                : <Button kind="outline" icon="pause-circle-outline" title={L('నిలిపివేయి', 'Suspend')} onPress={() => setSuspending(s)} />}
            </View>
          </View>
        );
      })}
      <NoteBox visible={!!suspending} title={L('ఎందుకు నిలిపివేస్తున్నారు?', 'Why suspend?')}
        onCancel={() => setSuspending(null)} onSend={(n) => { const s = suspending!; setSuspending(null); act(s, 'suspend', n); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6 },
  stat: { flex: 1, borderRadius: 14, padding: 10, alignItems: 'center', marginHorizontal: 3 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
  label: { marginTop: 14, marginBottom: 6 },
  status: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  hero: { width: '100%', height: 200, borderRadius: 10, marginTop: 8 },
  aadhaar: { width: '100%', height: 240, borderRadius: 10, marginTop: 10, backgroundColor: '#eee' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modal: { borderRadius: 16, padding: 16 },
});
