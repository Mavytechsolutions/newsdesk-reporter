import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Linking, Share } from 'react-native';
import { api, qs, useAuth } from './client';
import type { ArticleCard, Category, Me, Page, Place } from './types';
import { useSettings } from '../store/settings';

/** Pages loaded 15 at a time — never the whole feed (low-bandwidth friendly). */
const PAGE = 15;

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), staleTime: 3600_000 });
}

export function useFeed(tab: string) {
  const lang = useSettings((s) => s.language);
  const placeIds = useSettings((s) => s.places.map((p) => p.id).join(','));
  return useInfiniteQuery({
    queryKey: ['feed', tab, lang, placeIds],
    queryFn: ({ pageParam }) => api<Page>(`/feed${qs({ tab, lang, locationIds: placeIds, cursor: pageParam, limit: PAGE })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Stories filtered by place and/or category (Explore screens). */
export function useArticles(filter: { locationId?: string; category?: string; breaking?: boolean }) {
  const lang = useSettings((s) => s.language);
  return useInfiniteQuery({
    queryKey: ['articles', filter, lang],
    queryFn: ({ pageParam }) => api<Page>(`/articles${qs({ ...filter, lang, cursor: pageParam, limit: PAGE })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useSearch(q: string) {
  const lang = useSettings((s) => s.language);
  return useInfiniteQuery({
    queryKey: ['search', q, lang],
    enabled: q.trim().length >= 2,
    queryFn: ({ pageParam }) => api<Page>(`/search${qs({ q: q.trim(), lang, cursor: pageParam, limit: PAGE })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useSuggest(q: string) {
  return useQuery({
    queryKey: ['suggest', q],
    enabled: q.trim().length >= 2,
    queryFn: () => api<{ locations: Place[]; tags: string[] }>(`/search/suggest${qs({ q: q.trim() })}`),
    staleTime: 60_000,
  });
}

export function useArticle(slug: string, lang: string) {
  return useQuery({ queryKey: ['article', slug, lang], queryFn: () => api<ArticleCard>(`/articles/${encodeURIComponent(slug)}${qs({ lang })}`) });
}

export function useLocations(parentId?: string) {
  return useQuery({ queryKey: ['locations', parentId ?? 'root'], queryFn: () => api<Place[]>(`/locations${qs({ parentId })}`), staleTime: 86400_000 });
}

export function useMe() {
  const loggedIn = useAuth((s) => s.loggedIn);
  return useQuery({ queryKey: ['me'], enabled: loggedIn, queryFn: () => api<Me>('/me') });
}

export function useHistory() {
  const lang = useSettings((s) => s.language);
  return useQuery({ queryKey: ['history', lang], queryFn: () => api<ArticleCard[]>(`/me/history${qs({ lang })}`) });
}

// ---------- actions ----------

/** Save for offline reading (always on the phone; also synced to the account when logged in). */
export function useToggleSave() {
  const { save, unsave } = useSettings.getState();
  const lang = useSettings((s) => s.language);
  return async (a: ArticleCard, on: boolean) => {
    if (on) {
      // make sure we keep the full text for offline reading
      const full = a.body ? a : await api<ArticleCard>(`/articles/${encodeURIComponent(a.slug)}${qs({ lang })}`).catch(() => a);
      save(full);
    } else unsave(a.id);
    if (useAuth.getState().loggedIn) api(`/me/bookmarks/${a.id}`, { method: on ? 'PUT' : 'DELETE' }).catch(() => undefined);
  };
}

export function useLike(onNeedLogin: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) => {
      if (!useAuth.getState().loggedIn) {
        onNeedLogin();
        return Promise.reject(new Error('login'));
      }
      return api<{ liked: boolean; likeCount: number }>(`/articles/${id}/like`, { method: 'POST', body: { liked } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['article'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export async function shareArticle(a: ArticleCard, via: 'any' | 'whatsapp' = 'any') {
  const text = `${a.headline}\n\n${a.summary}\n\n${a.shareUrl}\n— MAVY NEWS`;
  api(`/articles/${a.id}/share`, { method: 'POST' }).catch(() => undefined);
  if (via === 'whatsapp') {
    const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
    if (await Linking.canOpenURL(url).catch(() => false)) return Linking.openURL(url);
  }
  try {
    await Share.share({ message: text, url: a.shareUrl, title: a.headline });
  } catch (e: any) {
    Alert.alert('Share', e?.message ?? 'Could not share');
  }
}

export function markRead(id: string) {
  if (useAuth.getState().loggedIn) api(`/articles/${id}/read`, { method: 'POST' }).catch(() => undefined);
}
