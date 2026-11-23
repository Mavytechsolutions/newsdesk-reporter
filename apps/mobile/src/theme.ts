import { useColorScheme } from 'react-native';
import { useSettings } from './store/settings';

const brand = {
  navy: '#0B1F3A',
  red: '#D7262E',
  green: '#16A34A',
  white: '#FFFFFF',
};

const light = {
  ...brand,
  dark: false,
  bg: '#F4F6FA',
  card: '#FFFFFF',
  text: '#0B1220',
  muted: '#5B6577',
  border: '#E3E7EE',
  header: brand.navy,
  headerText: '#FFFFFF',
  chip: '#E9EEF6',
  chipActive: brand.navy,
  chipActiveText: '#FFFFFF',
  skeleton: '#E3E7EE',
  citizen: '#B45309',
};

const dark: typeof light = {
  ...brand,
  dark: true,
  bg: '#070C16',
  card: '#111A2B',
  text: '#F2F5FA',
  muted: '#9AA6BA',
  border: '#1F2A3F',
  header: '#0A1424',
  headerText: '#FFFFFF',
  chip: '#18233A',
  chipActive: brand.green,
  chipActiveText: '#FFFFFF',
  skeleton: '#1A2438',
  citizen: '#F59E0B',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useSettings((s) => s.theme);
  const mode = pref === 'system' ? system : pref;
  return mode === 'dark' ? dark : light;
}

/** Telugu text uses Noto Sans Telugu for clean rendering; English uses the system font. */
export function useFont() {
  const lang = useSettings((s) => s.language);
  return (weight: 'regular' | 'bold' = 'regular') =>
    lang === 'te' ? (weight === 'bold' ? 'NotoSansTelugu_700Bold' : 'NotoSansTelugu_400Regular') : undefined;
}
