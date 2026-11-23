import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api, qs, useAuth } from './client';
import type { ArticleCard, Category, Comment, Me, Page, Place } from './types';
import { useEffect, useState } from 'react';
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

/** Share as a branded picture card (falls back to text). */
export { shareArticle } from '../share/ShareCard';

export function markRead(id: string) {
  if (useAuth.getState().loggedIn) api(`/articles/${id}/read`, { method: 'POST' }).catch(() => undefined);
}

/** Like / dislike with instant feedback; asks guests to log in. */
export function useReaction(a: ArticleCard, onNeedLogin: () => void) {
  const qc = useQueryClient();
  const [state, setState] = useState({ liked: !!a.liked, disliked: !!a.disliked, likeCount: a.likeCount, dislikeCount: a.dislikeCount });
  // keep in step when the feed reloads fresh numbers
  useEffect(() => {
    setState({ liked: !!a.liked, disliked: !!a.disliked, likeCount: a.likeCount, dislikeCount: a.dislikeCount });
  }, [a.id, a.liked, a.disliked, a.likeCount, a.dislikeCount]);
  const set = async (want: 'like' | 'dislike') => {
    if (!useAuth.getState().loggedIn) return onNeedLogin();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const reaction = (want === 'like' && state.liked) || (want === 'dislike' && state.disliked) ? 'none' : want;
    const prev = state;
    setState({
      liked: reaction === 'like',
      disliked: reaction === 'dislike',
      likeCount: prev.likeCount + (reaction === 'like' ? 1 : 0) - (prev.liked ? 1 : 0),
      dislikeCount: prev.dislikeCount + (reaction === 'dislike' ? 1 : 0) - (prev.disliked ? 1 : 0),
    });
    try {
      const r = await api<{ liked: boolean; disliked: boolean; likeCount: number; dislikeCount: number }>(`/articles/${a.id}/reaction`, { method: 'POST', body: { reaction } });
      setState({ liked: r.liked, disliked: r.disliked, likeCount: r.likeCount, dislikeCount: r.dislikeCount });
      qc.invalidateQueries({ queryKey: ['article'] });
    } catch (e: any) {
      setState(prev);
      Alert.alert('MAVY NEWS', e?.message ?? 'Could not save');
    }
  };
  return { ...state, like: () => set('like'), dislike: () => set('dislike') };
}

export function useComments(articleId: string) {
  return useInfiniteQuery({
    queryKey: ['comments', articleId],
    queryFn: ({ pageParam }) => api<{ items: Comment[]; nextCursor: string | null }>(`/articles/${articleId}/comments${qs({ cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function reportArticle(id: string, reason: string, note?: string) {
  return api<{ received: boolean }>(`/articles/${id}/report`, { method: 'POST', body: { reason, note: note?.trim() || undefined } });
}
