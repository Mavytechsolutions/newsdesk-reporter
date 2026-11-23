import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../components/ui';
import { PlacePicker } from './PlacesScreen';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { useSettings, Lang } from '../store/settings';

/** First launch: choose language, then places. */
export function OnboardingScreen() {
  const th = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'lang' | 'places'>('lang');
  const { setLanguage, setPlaces, finishOnboarding } = useSettings();

  if (step === 'places')
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <PlacePicker doneLabel={t.continue} onSkip={finishOnboarding} onDone={(p) => { setPlaces(p); finishOnboarding(); }} />
      </View>
    );

  const pick = (l: Lang) => {
    setLanguage(l);
    setStep('places');
  };
  return (
    <View style={[styles.wrap, { backgroundColor: th.navy, paddingTop: insets.top + 60 }]}>
      <T bold size={38} color="#fff" style={{ letterSpacing: 2 }}>MAVY <T bold size={38} color={th.green}>NEWS</T></T>
      <T color="rgba(255,255,255,0.8)" size={16} style={{ marginTop: 6 }}>మీ ఊరి వార్తలు · Your local news</T>
      <View style={{ flex: 1 }} />
      <T color="#fff" size={16} style={{ marginBottom: 14 }}>మీ భాషను ఎంచుకోండి / Choose your language</T>
      <Lng title="తెలుగు" sub="Telugu" onPress={() => pick('te')} />
      <Lng title="English" sub="ఇంగ్లీష్" onPress={() => pick('en')} />
      <View style={{ height: insets.bottom + 40 }} />
    </View>
  );
}

function Lng({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.lang, { backgroundColor: pressed ? th.green : 'rgba(255,255,255,0.08)' }]}>
      <T bold size={24} color="#fff" style={{ fontFamily: 'NotoSansTelugu_700Bold' }}>{title}</T>
      <T color="rgba(255,255,255,0.7)">{sub}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 24 },
  lang: { borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
});
