/**
 * Citizen journalists: "Become a journalist today" (name + place + Aadhaar photo),
 * the journalist desk (level, points, my stories) and writing a story from the phone.
 * Levels: Junior (0–99 approved stories, 5 points each) → Journalist (100+, 10) → Senior (500+, 20, badge).
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, useAuth } from '../api/client';
import { useCategories, useJournalistMe, useLocations, useMyPosts } from '../api/hooks';
import type { JournalistLevel, MyPost, Place } from '../api/types';
import { Button, Chip, ErrorState, T } from '../components/ui';
import { useTheme } from '../theme';
import { useName } from '../i18n';
import { useSettings } from '../store/settings';

/** Success message that also works in the web preview (where Alert does nothing). */
function done(message: string, ok: string, then: () => void) {
  if (Platform.OS === 'web') { window.alert(message); then(); return; }
  Alert.alert('MAVY NEWS', message, [{ text: ok, onPress: then }], { cancelable: false });
}

// ---------- words (Telugu / English) ----------
const W = {
  te: {
    become: 'జర్నలిస్ట్ అవ్వండి — ఈ రోజే!', becomeHint: 'మీ ఊరి వార్తలు మీరే రాయండి. మా ఎడిటర్లు చూసి ప్రచురిస్తారు. ప్రతి వార్తకు పాయింట్లు గెలవండి.',
    apply: 'దరఖాస్తు చేయండి', loginFirst: 'ముందు ఫోన్ నంబర్‌తో లాగిన్ అవ్వండి',
    pending: 'మీ దరఖాస్తు పరిశీలనలో ఉంది', pendingHint: 'MAVY NEWS టీమ్ మీ వివరాలు చూసి త్వరలో ఆమోదిస్తుంది.',
    rejected: 'మీ దరఖాస్తు ఆమోదం పొందలేదు', reason: 'కారణం', applyAgain: 'మళ్లీ దరఖాస్తు చేయండి',
    suspended: 'మీ జర్నలిస్ట్ అనుమతి తాత్కాలికంగా నిలిపివేయబడింది. దయచేసి MAVY NEWS ను సంప్రదించండి.',
    write: 'వార్త రాయండి', desk: 'నా జర్నలిస్ట్ డెస్క్', points: 'పాయింట్లు', stories: 'ప్రచురిత వార్తలు',
    toNext: (n: number, lvl: string) => `${lvl} కావడానికి ఇంకా ${n} వార్తలు`, top: 'మీరు అత్యున్నత స్థాయిలో ఉన్నారు!',
    perPost: (p: number) => `ప్రతి ఆమోదిత వార్తకు ${p} పాయింట్లు`,
    fullName: 'పూర్తి పేరు (ఆధార్‌లో ఉన్నట్లు)', namePh: 'ఉదా: కె. రమేష్ కుమార్',
    yourPlace: 'మీరు ఎక్కడి నుంచి వార్తలు పంపుతారు?', state: 'రాష్ట్రం', district: 'జిల్లా', mandal: 'మండలం / పట్టణం (ఐచ్ఛికం)',
    aadhaar: 'ఆధార్ కార్డ్ ఫోటో', aadhaarHint: 'మాస్క్‌డ్ ఆధార్ (చివరి 4 అంకెలు మాత్రమే కనిపించేది) పంపితే మంచిది. ఆధార్ నంబర్ మేము అడగము. ఆమోదం/తిరస్కరణ తర్వాత ఫోటో శాశ్వతంగా తొలగించబడుతుంది.',
    camera: 'ఫోటో తీయండి', gallery: 'గ్యాలరీ నుంచి', change: 'మార్చండి',
    consent: 'నా వయస్సు 18 ఏళ్లు పైబడి ఉంది. ఈ ఆధార్ నాదే. నేను నిజమైన, నేను స్వయంగా చూసిన/నిర్ధారించిన వార్తలు మాత్రమే పంపుతాను. తప్పుడు వార్తలు పంపితే నా అనుమతి రద్దు కావచ్చని అంగీకరిస్తున్నాను.',
    send: 'దరఖాస్తు పంపండి', sent: 'దరఖాస్తు పంపబడింది! ఆమోదం వచ్చాక మీరు వార్తలు పంపగలరు.',
    needName: 'మీ పూర్తి పేరు రాయండి', needPlace: 'మీ జిల్లా ఎంచుకోండి', needPhoto: 'ఆధార్ ఫోటో జత చేయండి', needConsent: 'ప్రకటనను అంగీకరించండి',
    levels: 'స్థాయిలు & పాయింట్లు', levelRow: (from: number, p: number) => `${from}+ వార్తలు · ఒక్కో వార్తకు ${p} పాయింట్లు`,
    myStories: 'నా వార్తలు', noStories: 'ఇంకా వార్తలు పంపలేదు. "వార్త రాయండి" నొక్కండి.',
    editorSays: 'ఎడిటర్ సూచన', fixResend: 'సరిచేసి మళ్లీ పంపండి',
    lang: 'భాష', headline: 'హెడ్‌లైన్', headlinePh: 'చిన్నగా, స్పష్టంగా — ఏమి జరిగింది?', body: 'పూర్తి వార్త', bodyPh: 'ఎవరు, ఏమి, ఎక్కడ, ఎప్పుడు, ఎందుకు — వివరంగా రాయండి.',
    category: 'వర్గం', place: 'ప్రాంతం', photo: 'ఫోటో (ఐచ్ఛికం)', photoHint: 'మీరే తీసిన ఫోటో మాత్రమే. ఇంటర్నెట్ ఫోటోలు వద్దు (కాపీరైట్).',
    sendStory: 'ఎడిటర్‌కు పంపండి', storySent: 'వార్త ఎడిటర్‌కు పంపబడింది! ఆమోదం తర్వాత యాప్‌లో కనిపిస్తుంది, మీకు పాయింట్లు వస్తాయి.',
    needHeadline: 'హెడ్‌లైన్ కనీసం 10 అక్షరాలు ఉండాలి', needBody: 'వార్త కనీసం 30 అక్షరాలు ఉండాలి', needCat: 'వర్గం ఎంచుకోండి',
    rules: 'గుర్తుంచుకోండి: నిజమైన వార్తలు మాత్రమే · వ్యక్తిగత దూషణలు వద్దు · బాధితుల పేర్లు/ముఖాలు (పిల్లలు, లైంగిక నేరాలు) వెల్లడించవద్దు.',
    wait: 'దయచేసి ఆగండి…', ok: 'సరే', error: 'సమస్య',
  },
  en: {
    become: 'Become a journalist today!', becomeHint: 'Report the news from your area. Our editors check and publish it. Earn points for every story.',
    apply: 'Apply now', loginFirst: 'Log in with your phone number first',
    pending: 'Your request is being checked', pendingHint: 'The MAVY NEWS team will review your details soon.',
    rejected: 'Your request was not approved', reason: 'Reason', applyAgain: 'Apply again',
    suspended: 'Your journalist access is paused. Please contact MAVY NEWS.',
    write: 'Write a story', desk: 'My journalist desk', points: 'Points', stories: 'Published stories',
    toNext: (n: number, lvl: string) => `${n} more stories to become ${lvl}`, top: 'You are at the top level!',
    perPost: (p: number) => `${p} points for every approved story`,
    fullName: 'Full name (as on Aadhaar)', namePh: 'e.g. K. Ramesh Kumar',
    yourPlace: 'Where will you report from?', state: 'State', district: 'District', mandal: 'Mandal / town (optional)',
    aadhaar: 'Aadhaar card photo', aadhaarHint: 'A masked Aadhaar (only the last 4 digits visible) is best. We never ask for your Aadhaar number. The photo is deleted for good after the decision.',
    camera: 'Take photo', gallery: 'From gallery', change: 'Change',
    consent: 'I am over 18. This Aadhaar is mine. I will send only true news that I have seen or checked myself. I accept that sending false news can end my access.',
    send: 'Send request', sent: 'Request sent! Once approved, you can send stories.',
    needName: 'Write your full name', needPlace: 'Choose your district', needPhoto: 'Add your Aadhaar photo', needConsent: 'Please accept the declaration',
    levels: 'Levels & points', levelRow: (from: number, p: number) => `${from}+ stories · ${p} points per story`,
    myStories: 'My stories', noStories: 'No stories yet. Tap "Write a story".',
    editorSays: 'Editor says', fixResend: 'Fix and resend',
    lang: 'Language', headline: 'Headline', headlinePh: 'Short and clear — what happened?', body: 'Full story', bodyPh: 'Who, what, where, when, why — in detail.',
    category: 'Category', place: 'Place', photo: 'Photo (optional)', photoHint: 'Only photos you took yourself. No internet photos (copyright).',
    sendStory: 'Send to editor', storySent: 'Story sent to the editor! It appears in the app after approval, and you get points.',
    needHeadline: 'Headline needs at least 10 letters', needBody: 'Story needs at least 30 letters', needCat: 'Choose a category',
    rules: 'Remember: true news only · no personal attacks · never reveal names/faces of victims (children, sexual crimes).',
    wait: 'Please wait…', ok: 'OK', error: 'Problem',
  },
};
type Words = typeof W.te;
function useW(): Words { return useSettings((s) => s.language) === 'te' ? W.te : (W.en as Words); }

const LEVEL_NAME: Record<JournalistLevel, { te: string; en: string }> = {
  JUNIOR: { te: 'జూనియర్ జర్నలిస్ట్', en: 'Junior Journalist' },
  JOURNALIST: { te: 'జర్నలిస్ట్', en: 'Journalist' },
  SENIOR: { te: 'సీనియర్ జర్నలిస్ట్', en: 'Senior Journalist' },
};
export function levelName(level: JournalistLevel, lang: 'te' | 'en') { return LEVEL_NAME[level][lang]; }

const STATUS: Record<string, { te: string; en: string; color: string }> = {
  SUBMITTED: { te: 'సమీక్షకు వెళ్లింది', en: 'Waiting for review', color: '#2563EB' },
  IN_REVIEW: { te: 'సమీక్షలో ఉంది', en: 'In review', color: '#2563EB' },
  CHANGES_REQUESTED: { te: 'మార్పులు కావాలి', en: 'Needs changes', color: '#B45309' },
  APPROVED: { te: 'ఆమోదించారు', en: 'Approved', color: '#7C3AED' },
  SCHEDULED: { te: 'షెడ్యూల్ అయింది', en: 'Scheduled', color: '#7C3AED' },
  PUBLISHED: { te: 'ప్రచురితం', en: 'Published', color: '#16A34A' },
  REJECTED: { te: 'తిరస్కరించారు', en: 'Not approved', color: '#D7262E' },
  ARCHIVED: { te: 'తీసివేశారు', en: 'Taken down', color: '#D7262E' },
  DRAFT: { te: 'డ్రాఫ్ట్', en: 'Draft', color: '#6B7280' },
};

/** Level badge. Seniors get the gold ribbon. */
export function LevelBadge({ level, small }: { level: JournalistLevel; small?: boolean }) {
  const lang = useSettings((s) => s.language);
  const colors = { JUNIOR: ['#E9EEF6', '#0B1F3A'], JOURNALIST: ['#DCF3E4', '#0E6B32'], SENIOR: ['#FDF1D6', '#8A5A00'] }[level];
  return (
    <View style={[styles.badge, { backgroundColor: colors[0] }, small && { paddingVertical: 1, paddingHorizontal: 7 }]}>
      <Ionicons name={level === 'SENIOR' ? 'ribbon' : level === 'JOURNALIST' ? 'shield-checkmark' : 'create'} size={small ? 11 : 14} color={colors[1]} />
      <T bold size={small ? 10.5 : 12.5} color={colors[1]} style={{ marginLeft: 4 }}>{levelName(level, lang)}</T>
    </View>
  );
}

// ---------- Profile card ----------
export function JournalistCard({ navigation }: { navigation: any }) {
  const th = useTheme();
  const w = useW();
  const lang = useSettings((s) => s.language);
  const loggedIn = useAuth((s) => s.loggedIn);
  const q = useJournalistMe();
  const box = [styles.card, { backgroundColor: th.card, borderColor: th.green }];

  if (!loggedIn || !q.data || q.data.state === 'NONE' || q.data.state === 'REJECTED') {
    const rejected = q.data?.state === 'REJECTED';
    return (
      <View style={box}>
        <View style={styles.row}>
          <View style={[styles.iconCircle, { backgroundColor: th.green }]}><Ionicons name="mic" size={22} color="#fff" /></View>
          <T bold size={17} style={{ flex: 1, marginLeft: 10 }}>{rejected ? w.rejected : w.become}</T>
        </View>
        {rejected && q.data?.application?.note ? <T color={th.red} style={{ marginTop: 8 }}>{w.reason}: {q.data.application.note}</T> : null}
        <T color={th.muted} style={{ marginTop: 8, lineHeight: 22 }}>{w.becomeHint}</T>
        <Button title={rejected ? w.applyAgain : w.apply} icon="arrow-forward" style={{ marginTop: 12 }}
          onPress={() => (loggedIn ? navigation.navigate('BecomeJournalist') : navigation.navigate('Login'))} />
        {!loggedIn ? <T size={12} color={th.muted} style={{ marginTop: 6, textAlign: 'center' }}>{w.loginFirst}</T> : null}
      </View>
    );
  }
  const d = q.data;
  if (d.state === 'PENDING')
    return (
      <View style={box}>
        <View style={styles.row}>
          <Ionicons name="hourglass-outline" size={24} color={th.green} />
          <T bold size={16} style={{ marginLeft: 10, flex: 1 }}>{w.pending}</T>
        </View>
        <T color={th.muted} style={{ marginTop: 6 }}>{w.pendingHint}</T>
      </View>
    );
  if (d.state === 'SUSPENDED')
    return (<View style={[styles.card, { backgroundColor: th.card, borderColor: th.red }]}><T color={th.red} bold>{w.suspended}</T></View>);
  return (
    <View style={box}>
      <Pressable onPress={() => navigation.navigate('JournalistDesk')} accessibilityRole="button">
        <View style={styles.row}>
          <LevelBadge level={d.level!} />
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={18} color={th.muted} />
        </View>
        <View style={[styles.row, { marginTop: 12 }]}>
          <Stat value={d.points} label={w.points} />
          <Stat value={d.approvedPosts} label={w.stories} />
        </View>
        <Progress approved={d.approvedPosts} next={d.next} lang={lang} />
      </Pressable>
      <Button title={w.write} icon="create-outline" style={{ marginTop: 12 }} onPress={() => navigation.navigate('WriteStory')} />
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const th = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <T bold size={26} color={th.green}>{value}</T>
      <T size={12.5} color={th.muted}>{label}</T>
    </View>
  );
}

function Progress({ approved, next, lang }: { approved: number; next: { level: JournalistLevel; at: number; remaining: number } | null; lang: 'te' | 'en' }) {
  const th = useTheme();
  const w = useW();
  if (!next) return <T bold color={th.green} style={{ marginTop: 10 }}>🏆 {w.top}</T>;
  const start = next.level === 'JOURNALIST' ? 0 : 100;
  const pct = Math.max(0.03, Math.min(1, (approved - start) / (next.at - start)));
  return (
    <View style={{ marginTop: 12 }}>
      <View style={[styles.track, { backgroundColor: th.chip }]}><View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: th.green }]} /></View>
      <T size={12.5} color={th.muted} style={{ marginTop: 5 }}>{w.toNext(next.remaining, levelName(next.level, lang))}</T>
    </View>
  );
}

// ---------- shared: place picker (state → district → mandal) ----------
function PlaceSelect({ value, onChange }: { value: { district?: Place; mandal?: Place }; onChange: (v: { district?: Place; mandal?: Place }) => void }) {
  const th = useTheme();
  const w = useW();
  const name = useName();
  const states = useLocations();
  const [stateId, setStateId] = useState<string | null>(null);
  const st = states.data?.find((s) => s.id === stateId) ?? states.data?.find((s) => s.nameEn === 'Andhra Pradesh') ?? states.data?.[0];
  const districts = useLocations(st?.id);
  const children = useLocations(value.district?.id);
  const HOME = ['Anantapur', 'Sri Sathya Sai'];
  const list = useMemo(() => [...(districts.data ?? [])].sort((a, b) => {
    const ia = HOME.indexOf(a.nameEn), ib = HOME.indexOf(b.nameEn);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }), [districts.data]);
  const mandals = (children.data ?? []).filter((c) => c.type === 'MANDAL' || c.type === 'MUNICIPALITY');
  return (
    <View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {(states.data ?? []).map((s) => <Chip key={s.id} label={name(s)} active={s.id === st?.id} onPress={() => { setStateId(s.id); onChange({}); }} />)}
      </View>
      <T bold size={14} style={styles.sub}>{w.district}</T>
      {!districts.data ? <ActivityIndicator color={th.green} /> : value.district ? (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Chip label={`✓ ${name(value.district)}`} active onPress={() => onChange({})} />
          <T size={12} color={th.muted}>({w.change})</T>
        </View>
      ) : (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {list.map((d) => <Chip key={d.id} label={name(d)} onPress={() => onChange({ district: d })} />)}
        </View>
      )}
      {value.district && mandals.length ? (
        <>
          <T bold size={14} style={styles.sub}>{w.mandal}</T>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {mandals.map((m) => <Chip key={m.id} label={name(m)} active={value.mandal?.id === m.id}
              onPress={() => onChange({ district: value.district, mandal: value.mandal?.id === m.id ? undefined : m })} />)}
          </View>
        </>
      ) : null}
    </View>
  );
}

async function pickPhoto(fromCamera: boolean) {
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false };
  const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.fileName ?? 'photo.jpg', type: a.mimeType ?? 'image/jpeg' };
}

function PhotoField({ photo, setPhoto }: { photo: { uri: string; name: string; type: string } | null; setPhoto: (p: any) => void }) {
  const th = useTheme();
  const w = useW();
  return (
    <View>
      {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" /> : null}
      <View style={[styles.row, { marginTop: 8 }]}>
        <Button kind="outline" icon="camera-outline" title={w.camera} style={{ flex: 1, marginRight: 8 }} onPress={async () => { const p = await pickPhoto(true); if (p) setPhoto(p); }} />
        <Button kind="outline" icon="images-outline" title={w.gallery} style={{ flex: 1 }} onPress={async () => { const p = await pickPhoto(false); if (p) setPhoto(p); }} />
      </View>
      {photo ? <Pressable onPress={() => setPhoto(null)}><T color={th.red} size={13} style={{ marginTop: 6 }}>✕ {w.change}</T></Pressable> : null}
    </View>
  );
}

// ---------- Become a journalist ----------
export function BecomeJournalistScreen({ navigation }: any) {
  const th = useTheme();
  const w = useW();
  const lang = useSettings((s) => s.language);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [place, setPlace] = useState<{ district?: Place; mandal?: Place }>({});
  const [photo, setPhoto] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (name.trim().length < 3) return setError(w.needName);
    if (!place.district) return setError(w.needPlace);
    if (!photo) return setError(w.needPhoto);
    if (!consent) return setError(w.needConsent);
    setBusy(true);
    try {
      await apiUpload('/journalist/apply', { name: name.trim(), locationId: (place.mandal ?? place.district).id, consent: 'true' }, photo);
      await qc.invalidateQueries({ queryKey: ['journalist'] });
      done(w.sent, w.ok, () => navigation.goBack());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <T bold size={22}>{w.become}</T>
      <T color={th.muted} style={{ marginTop: 6, lineHeight: 22 }}>{w.becomeHint}</T>
      <LevelsTable lang={lang} />

      <T bold style={styles.label}>{w.fullName} *</T>
      <TextInput value={name} onChangeText={setName} placeholder={w.namePh} placeholderTextColor={th.muted} maxLength={80}
        style={[styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card }]} accessibilityLabel={w.fullName} />

      <T bold style={styles.label}>{w.yourPlace} *</T>
      <PlaceSelect value={place} onChange={setPlace} />

      <T bold style={styles.label}>{w.aadhaar} *</T>
      <T size={13} color={th.muted} style={{ lineHeight: 20 }}>🔒 {w.aadhaarHint}</T>
      <PhotoField photo={photo} setPhoto={setPhoto} />

      <Pressable onPress={() => setConsent(!consent)} style={[styles.row, { marginTop: 18, alignItems: 'flex-start' }]} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
        <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={26} color={consent ? th.green : th.muted} />
        <T size={14} style={{ flex: 1, marginLeft: 10, lineHeight: 22 }}>{w.consent}</T>
      </Pressable>

      {error ? <T color={th.red} bold style={{ marginTop: 12 }}>{error}</T> : null}
      <Button title={busy ? w.wait : w.send} icon="send" loading={busy} disabled={busy} onPress={submit} style={{ marginTop: 16 }} />
    </ScrollView>
  );
}

function LevelsTable({ lang }: { lang: 'te' | 'en' }) {
  const th = useTheme();
  const w = useW();
  const rows: [JournalistLevel, number, number][] = [['JUNIOR', 0, 5], ['JOURNALIST', 100, 10], ['SENIOR', 500, 20]];
  return (
    <View style={[styles.card, { backgroundColor: th.card, borderColor: th.border, marginTop: 14 }]}>
      <T bold size={15} style={{ marginBottom: 6 }}>{w.levels}</T>
      {rows.map(([lvl, from, p]) => (
        <View key={lvl} style={[styles.row, { marginTop: 8 }]}>
          <LevelBadge level={lvl} small />
          <T size={13} color={th.muted} style={{ marginLeft: 8, flex: 1 }}>{w.levelRow(from, p)}</T>
        </View>
      ))}
    </View>
  );
}

// ---------- Journalist desk ----------
export function JournalistDeskScreen({ navigation }: any) {
  const th = useTheme();
  const w = useW();
  const lang = useSettings((s) => s.language);
  const me = useJournalistMe();
  const posts = useMyPosts();
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const d = me.data;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {!d ? <ActivityIndicator color={th.green} style={{ margin: 30 }} /> : (
        <View style={[styles.card, { backgroundColor: th.card, borderColor: th.green }]}>
          <T bold size={19}>{d.name}</T>
          <View style={[styles.row, { marginTop: 6 }]}>{d.level ? <LevelBadge level={d.level} /> : null}</View>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Stat value={d.points} label={w.points} />
            <Stat value={d.approvedPosts} label={w.stories} />
          </View>
          {d.pointsPerPost ? <T size={13} color={th.muted} style={{ marginTop: 6 }}>{w.perPost(d.pointsPerPost)}</T> : null}
          {d.level ? <Progress approved={d.approvedPosts} next={d.next} lang={lang} /> : null}
          {d.state === 'APPROVED' ? <Button title={w.write} icon="create-outline" style={{ marginTop: 14 }} onPress={() => navigation.navigate('WriteStory')} /> : null}
          {d.state === 'SUSPENDED' ? <T color={th.red} bold style={{ marginTop: 10 }}>{w.suspended}</T> : null}
        </View>
      )}
      <LevelsTable lang={lang} />
      <T bold size={18} style={{ marginTop: 8, marginBottom: 8 }}>{w.myStories}</T>
      {posts.isPending ? <ActivityIndicator color={th.green} /> : posts.isError ? <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
        : !posts.data?.length ? <T color={th.muted}>{w.noStories}</T>
        : posts.data.map((p) => <PostRow key={p.id} p={p} lang={lang} onFix={() => navigation.navigate('WriteStory', { post: p })} />)}
    </ScrollView>
  );
}

function PostRow({ p, lang, onFix }: { p: MyPost; lang: 'te' | 'en'; onFix: () => void }) {
  const th = useTheme();
  const w = useW();
  const s = STATUS[p.status] ?? STATUS.DRAFT;
  return (
    <View style={[styles.card, { backgroundColor: th.card, borderColor: th.border }]}>
      <View style={styles.row}>
        <View style={[styles.status, { backgroundColor: s.color }]}><T bold size={11.5} color="#fff">{s[lang]}</T></View>
        {p.points ? <T bold color={th.green} style={{ marginLeft: 8 }}>+{p.points}</T> : null}
        <View style={{ flex: 1 }} />
        <T size={12} color={th.muted}>{new Date(p.createdAt).toLocaleDateString(lang === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short' })}</T>
      </View>
      <T bold size={15.5} style={{ marginTop: 8, lineHeight: 24 }}>{p.headline}</T>
      <T size={12.5} color={th.muted} style={{ marginTop: 2 }}>{lang === 'te' ? p.category.nameTe : p.category.nameEn}{p.location ? ` · 📍 ${lang === 'te' ? p.location.nameTe : p.location.nameEn}` : ''}</T>
      {p.editorNote && p.status !== 'PUBLISHED' ? (
        <View style={[styles.note, { backgroundColor: th.chip }]}>
          <T size={13.5}><T bold size={13.5}>{w.editorSays}: </T>{p.editorNote}</T>
        </View>
      ) : null}
      {p.status === 'CHANGES_REQUESTED' ? <Button title={w.fixResend} icon="create-outline" kind="outline" style={{ marginTop: 10 }} onPress={onFix} /> : null}
    </View>
  );
}

// ---------- Write a story (new, or fix one the editor sent back) ----------
export function WriteStoryScreen({ navigation, route }: any) {
  const th = useTheme();
  const w = useW();
  const name = useName();
  const qc = useQueryClient();
  const editing: MyPost | undefined = route?.params?.post;
  const appLang = useSettings((s) => s.language);
  const cats = useCategories();
  const [lang, setLang] = useState<'te' | 'en'>(editing?.language ?? appLang);
  const [headline, setHeadline] = useState(editing?.headline ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [categoryId, setCategoryId] = useState<string | undefined>(editing?.category.id);
  const [place, setPlace] = useState<{ district?: Place; mandal?: Place }>(
    editing?.location ? { district: { ...editing.location, type: 'DISTRICT' } as Place } : {});
  const [photo, setPhoto] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [keepPhoto, setKeepPhoto] = useState<string | null>(editing?.heroImageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (headline.trim().length < 10) return setError(w.needHeadline);
    if (body.trim().length < 30) return setError(w.needBody);
    if (!categoryId) return setError(w.needCat);
    if (!place.district) return setError(w.needPlace);
    setBusy(true);
    try {
      let heroImageUrl = keepPhoto;
      if (photo) heroImageUrl = (await apiUpload<{ url: string }>('/journalist/media', {}, photo)).url;
      const payload = { language: lang, headline: headline.trim(), body: body.trim(), categoryId, locationId: (place.mandal ?? place.district).id, heroImageUrl };
      if (editing) await api(`/journalist/posts/${editing.id}`, { method: 'PATCH', body: payload });
      else await api('/journalist/posts', { method: 'POST', body: payload });
      await qc.invalidateQueries({ queryKey: ['journalist'] });
      done(w.storySent, w.ok, () => navigation.goBack());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: th.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      {editing?.editorNote ? (
        <View style={[styles.note, { backgroundColor: th.chip, marginTop: 0 }]}><T size={14}><T bold size={14}>{w.editorSays}: </T>{editing.editorNote}</T></View>
      ) : null}
      <T size={13} color={th.muted} style={{ lineHeight: 20 }}>⚠️ {w.rules}</T>

      <T bold style={styles.label}>{w.lang}</T>
      <View style={styles.row}>
        <Chip label="తెలుగు" active={lang === 'te'} onPress={() => setLang('te')} />
        <Chip label="English" active={lang === 'en'} onPress={() => setLang('en')} />
      </View>

      <T bold style={styles.label}>{w.headline} *</T>
      <TextInput value={headline} onChangeText={setHeadline} placeholder={w.headlinePh} placeholderTextColor={th.muted} maxLength={160}
        style={[styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card }]} accessibilityLabel={w.headline} />
      <T size={11.5} color={th.muted} style={{ textAlign: 'right', marginTop: 3 }}>{headline.length} / 160</T>

      <T bold style={styles.label}>{w.body} *</T>
      <TextInput value={body} onChangeText={setBody} placeholder={w.bodyPh} placeholderTextColor={th.muted} maxLength={5000} multiline textAlignVertical="top"
        style={[styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.card, minHeight: 180, lineHeight: 26 }]} accessibilityLabel={w.body} />
      <T size={11.5} color={th.muted} style={{ textAlign: 'right', marginTop: 3 }}>{body.length} / 5000</T>

      <T bold style={styles.label}>{w.category} *</T>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {(cats.data ?? []).filter((c) => !c.isVirtual).map((c) => <Chip key={c.id} label={name(c)} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} />)}
      </View>

      <T bold style={styles.label}>{w.place} *</T>
      <PlaceSelect value={place} onChange={setPlace} />

      <T bold style={styles.label}>{w.photo}</T>
      <T size={13} color={th.muted}>{w.photoHint}</T>
      {keepPhoto && !photo ? (
        <View>
          <Image source={{ uri: keepPhoto }} style={styles.preview} resizeMode="cover" />
          <Pressable onPress={() => setKeepPhoto(null)}><T color={th.red} size={13} style={{ marginTop: 6 }}>✕ {w.change}</T></Pressable>
        </View>
      ) : <PhotoField photo={photo} setPhoto={setPhoto} />}

      {error ? <T color={th.red} bold style={{ marginTop: 12 }}>{error}</T> : null}
      <Button title={busy ? w.wait : w.sendStory} icon="send" loading={busy} disabled={busy} onPress={submit} style={{ marginTop: 18 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  label: { marginTop: 18, marginBottom: 6 },
  sub: { marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
  preview: { width: '100%', height: 200, borderRadius: 12, marginTop: 8 },
  status: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  note: { borderRadius: 10, padding: 10, marginTop: 10, marginBottom: 6 },
});
