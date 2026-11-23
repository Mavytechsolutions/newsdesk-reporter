/**
 * Page-flip story viewer (MAVY NEWS): pages turn at the middle of the screen with a green fold-line glow.
 *
 * Swipe UP:   the bottom half of the current story folds up to the middle of the screen,
 *             then the top half of the next story folds down from the middle and lands.
 * Swipe DOWN: the same in reverse (previous story).
 * The flip follows your finger; let go past ~30% (or flick) and it completes, otherwise it falls back.
 *
 * How it works: each page is drawn as two halves (top / bottom) clipped at the middle of the screen.
 * The halves rotate around the middle line (rotateX with perspective). One Animated value `p` drives
 * everything on the native thread: 0 = resting, +1 = next page fully shown, -1 = previous page shown.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { T } from './ui';
import { useTheme } from '../theme';

const PERSPECTIVE = 1400;

interface Props<T> {
  items: T[];
  height: number;
  renderPage: (item: T, index: number, live: boolean) => React.ReactNode;
  keyOf: (item: T) => string;
  onIndexChange?: (index: number) => void;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  loadingMore?: boolean;
}

/** One half (top or bottom) of a page, clipped at the middle of the screen. */
function Half({ children, half, height }: { children: React.ReactNode; half: 'top' | 'bottom'; height: number }) {
  return (
    <View style={{ height: height / 2, overflow: 'hidden' }}>
      <View style={{ height, marginTop: half === 'top' ? 0 : -height / 2 }}>{children}</View>
    </View>
  );
}

export function FlipDeck<T>({ items, height, renderPage, keyOf, onIndexChange, onEndReached, onRefresh, refreshing, loadingMore }: Props<T>) {
  const th = useTheme();
  const [index, setIndex] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const p = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const state = useRef({ index, count: items.length, height });
  state.current = { index, count: items.length, height };

  // keep index valid if the list shrinks (e.g. refresh, or a saved story removed)
  useEffect(() => {
    if (index > 0 && index >= items.length) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);
  // ask for more stories a little before the end
  useEffect(() => {
    if (items.length && index >= items.length - 3) onEndReached?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  const finish = (dir: 1 | -1 | 0, velocity = 0) => {
    busy.current = true;
    Animated.spring(p, {
      toValue: dir,
      velocity,
      useNativeDriver: true,
      stiffness: 260,
      damping: 26,
      mass: 1,
      overshootClamping: true,
    }).start(() => {
      if (dir === 0) {
        setFlipping(false);
        busy.current = false;
        return;
      }
      const next = state.current.index + dir;
      Haptics.selectionAsync().catch(() => undefined);
      setIndex(next);
      setFlipping(false);
      onIndexChange?.(next);
      // reset after React has shown the new page on top (see useEffect below)
    });
  };
  // once the new page is drawn, put the flip stage back to rest (invisible behind the live page)
  useEffect(() => {
    if (!flipping) {
      p.setValue(0);
      busy.current = false;
    }
  }, [index, flipping, p]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => !busy.current && Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
        onPanResponderGrant: () => setFlipping(true),
        onPanResponderMove: (_, g) => {
          const { index: i, count, height: h } = state.current;
          let v = -g.dy / (h * 0.75);
          if (v > 0 && i >= count - 1) v = Math.min(v, 0.12); // last story: small resistance
          if (v < 0 && i <= 0) v = Math.max(v, -0.12); // first story: pull down to refresh
          p.setValue(Math.max(-1, Math.min(1, v)));
        },
        onPanResponderRelease: (_, g) => {
          const { index: i, count, height: h } = state.current;
          const v = -g.dy / (h * 0.75);
          const flick = -g.vy;
          if ((v > 0.3 || flick > 0.6) && i < count - 1) finish(1, flick);
          else if ((v < -0.3 || flick < -0.6) && i > 0) finish(-1, flick);
          else {
            if (i === 0 && v < -0.08 && onRefresh) onRefresh();
            finish(0);
          }
        },
        onPanResponderTerminate: () => finish(0),
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!items.length || !height) return null;
  const cur = items[index];
  const next = items[index + 1];
  const prev = items[index - 1];
  const h2 = height / 2;

  // ---- animation curves (all driven by p) ----
  const deg = (v: number) => `${v}deg`;
  // current bottom half: folds up 0° → 90° while p goes 0 → 0.5 (forward)
  const curBottomRot = p.interpolate({ inputRange: [0, 0.5], outputRange: [deg(0), deg(90)], extrapolate: 'clamp' });
  const curBottomOpacity = p.interpolate({ inputRange: [0.49, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const curBottomShade = p.interpolate({ inputRange: [0, 0.5], outputRange: [0, 0.55], extrapolate: 'clamp' });
  // next top half: lands from -90° → 0° while p goes 0.5 → 1
  const nextTopRot = p.interpolate({ inputRange: [0.5, 1], outputRange: [deg(-90), deg(0)], extrapolate: 'clamp' });
  const nextTopOpacity = p.interpolate({ inputRange: [0.5, 0.51], outputRange: [0, 1], extrapolate: 'clamp' });
  const nextTopShade = p.interpolate({ inputRange: [0.5, 1], outputRange: [0.45, 0], extrapolate: 'clamp' });
  // revealed underneath: next bottom half (in shadow at first), current top half (shadowed as it gets covered)
  const nextBottomShade = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.25, 0], extrapolate: 'clamp' });
  const nextBottomOpacity = p.interpolate({ inputRange: [-0.01, 0], outputRange: [0, 1], extrapolate: 'clamp' });
  const curTopShadeFwd = p.interpolate({ inputRange: [0.5, 1], outputRange: [0, 0.45], extrapolate: 'clamp' });

  // backward: current top half folds DOWN 0° → -90° while p goes 0 → -0.5
  const curTopRot = p.interpolate({ inputRange: [-0.5, 0], outputRange: [deg(-90), deg(0)], extrapolate: 'clamp' });
  const curTopOpacity = p.interpolate({ inputRange: [-0.5, -0.49], outputRange: [0, 1], extrapolate: 'clamp' });
  const curTopShadeBack = p.interpolate({ inputRange: [-0.5, 0], outputRange: [0.55, 0], extrapolate: 'clamp' });
  // previous bottom half lands from 90° → 0° while p goes -0.5 → -1
  const prevBottomRot = p.interpolate({ inputRange: [-1, -0.5], outputRange: [deg(0), deg(90)], extrapolate: 'clamp' });
  const prevBottomOpacity = p.interpolate({ inputRange: [-0.51, -0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const prevBottomShade = p.interpolate({ inputRange: [-1, -0.5], outputRange: [0, 0.45], extrapolate: 'clamp' });
  const prevTopShade = p.interpolate({ inputRange: [-1, -0.5, 0], outputRange: [0, 0.25, 0.6], extrapolate: 'clamp' });
  const prevTopOpacity = p.interpolate({ inputRange: [0, 0.01], outputRange: [1, 0], extrapolate: 'clamp' });
  const curBottomShadeBack = p.interpolate({ inputRange: [-1, -0.5], outputRange: [0.45, 0], extrapolate: 'clamp' });

  const hingeGlow = p.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0, 0.95, 0, 0.95, 0], extrapolate: 'clamp' });

  const shade = (o: Animated.AnimatedInterpolation<number>) => (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: o }]} />
  );
  const page = (item: T | undefined, i: number) => (item === undefined ? <View style={{ flex: 1, backgroundColor: th.card }} /> : renderPage(item, i, false));

  return (
    <View style={{ height, backgroundColor: '#000' }} {...pan.panHandlers}>
      {/* ---------- flip stage (only visible while flipping) ---------- */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* TOP AREA, bottom to top: previous top (under), current top, next top (flap) */}
        <View style={[styles.area, { top: 0, height: h2 }]}>
          {prev !== undefined && (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: prevTopOpacity }]}>
              <Half half="top" height={height}>{page(prev, index - 1)}</Half>
              {shade(prevTopShade)}
            </Animated.View>
          )}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: curTopOpacity, transformOrigin: 'bottom', transform: [{ perspective: PERSPECTIVE }, { rotateX: curTopRot }] }]}>
            <Half half="top" height={height}>{page(cur, index)}</Half>
            {shade(curTopShadeFwd)}
            {shade(curTopShadeBack)}
          </Animated.View>
          {next !== undefined && (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: nextTopOpacity, transformOrigin: 'bottom', transform: [{ perspective: PERSPECTIVE }, { rotateX: nextTopRot }] }]}>
              <Half half="top" height={height}>{page(next, index + 1)}</Half>
              {shade(nextTopShade)}
            </Animated.View>
          )}
        </View>
        {/* BOTTOM AREA, bottom to top: next bottom (under), current bottom, previous bottom (flap) */}
        <View style={[styles.area, { top: h2, height: h2 }]}>
          {next !== undefined && (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: nextBottomOpacity }]}>
              <Half half="bottom" height={height}>{page(next, index + 1)}</Half>
              {shade(nextBottomShade)}
            </Animated.View>
          )}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: curBottomOpacity, transformOrigin: 'top', transform: [{ perspective: PERSPECTIVE }, { rotateX: curBottomRot }] }]}>
            <Half half="bottom" height={height}>{page(cur, index)}</Half>
            {shade(curBottomShade)}
            {shade(curBottomShadeBack)}
          </Animated.View>
          {prev !== undefined && (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: prevBottomOpacity, transformOrigin: 'top', transform: [{ perspective: PERSPECTIVE }, { rotateX: prevBottomRot }] }]}>
              <Half half="bottom" height={height}>{page(prev, index - 1)}</Half>
              {shade(prevBottomShade)}
            </Animated.View>
          )}
        </View>
      </View>

      {/* MAVY touch: a green glow along the fold line while the page turns */}
      <Animated.View pointerEvents="none" style={[styles.hinge, { top: h2 - 2, opacity: hingeGlow }]} />

      {/* ---------- the live, tappable story (hidden while flipping) ---------- */}
      <View style={[StyleSheet.absoluteFill, { opacity: flipping ? 0 : 1 }]} pointerEvents={flipping ? 'none' : 'auto'} key={keyOf(cur)}>
        {renderPage(cur, index, true)}
      </View>

      {refreshing && (
        <View style={styles.toast} pointerEvents="none"><ActivityIndicator color={th.green} /></View>
      )}
      {loadingMore && index >= items.length - 1 && (
        <View style={[styles.toast, { top: undefined, bottom: 90 }]} pointerEvents="none"><ActivityIndicator color={th.green} /></View>
      )}
    </View>
  );
}

/** Small label used when there is nothing more to flip to. */
export function EndOfStories({ text }: { text: string }) {
  return <T size={12} color="#999" style={{ textAlign: 'center' }}>{text}</T>;
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: 0, right: 0, overflow: 'visible' },
  hinge: { position: 'absolute', left: 0, right: 0, height: 4, backgroundColor: '#16A34A', shadowColor: '#16A34A', shadowOpacity: 0.9, shadowRadius: 10, elevation: 8 },
  toast: { position: 'absolute', top: 70, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, padding: 8, elevation: 6 },
});
