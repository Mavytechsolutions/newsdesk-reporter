import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Place, ArticleCard } from '../api/types';

export type Lang = 'te' | 'en';
export type FeedMode = 'compact' | 'immersive';

interface SettingsState {
  hydrated: boolean;
  onboarded: boolean;
  language: Lang;
  theme: 'system' | 'light' | 'dark';
  feedMode: FeedMode;
  places: Place[];
  recentSearches: string[];
  /** Saved stories are kept on the phone with full text, so they open without internet. */
  saved: ArticleCard[];
  /** Server address; empty = the one built into the app. Changeable in Profile for testing. */
  serverUrl: string;
  setServerUrl: (u: string) => void;
  setLanguage: (l: Lang) => void;
  setTheme: (t: SettingsState['theme']) => void;
  setFeedMode: (m: FeedMode) => void;
  setPlaces: (p: Place[]) => void;
  finishOnboarding: () => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  save: (a: ArticleCard) => void;
  unsave: (id: string) => void;
  mergeSaved: (list: ArticleCard[]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      hydrated: false,
      onboarded: false,
      language: 'te',
      theme: 'system',
      feedMode: 'immersive',
      places: [],
      recentSearches: [],
      saved: [],
      serverUrl: '',
      setServerUrl: (serverUrl) => set({ serverUrl }),
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setFeedMode: (feedMode) => set({ feedMode }),
      setPlaces: (places) => set({ places }),
      finishOnboarding: () => set({ onboarded: true }),
      addRecentSearch: (q) =>
        set((s) => ({ recentSearches: [q, ...s.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10) })),
      clearRecentSearches: () => set({ recentSearches: [] }),
      save: (a) => set((s) => ({ saved: [{ ...a, bookmarked: true }, ...s.saved.filter((x) => x.id !== a.id)] })),
      unsave: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
      mergeSaved: (list) =>
        set((s) => {
          const ids = new Set(s.saved.map((x) => x.id));
          return { saved: [...s.saved, ...list.filter((x) => !ids.has(x.id))] };
        }),
      reset: () => set({ saved: [], recentSearches: [] }),
    }),
    {
      name: 'mavy-settings',
      version: 2,
      // v2: the full-screen swipe card (Way2News style) becomes the default view
      migrate: (state: any, version) => (version < 2 ? { ...state, feedMode: 'immersive' } : state),
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);
