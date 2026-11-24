import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme, LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, NotoSansTelugu_400Regular, NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu';
import { initAuth, useAuth } from './src/api/client';
import { useSettings } from './src/store/settings';
import { useFont, useTheme } from './src/theme';
import { useT } from './src/i18n';
import { HomeScreen } from './src/screens/HomeScreen';
import { ArticleScreen } from './src/screens/ArticleScreen';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { ListFeedScreen } from './src/screens/ListFeedScreen';
import { PlacesScreen } from './src/screens/PlacesScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { CommentsScreen } from './src/screens/CommentsScreen';
import { ShareCardHost } from './src/share/ShareCard';
import { BookmarksScreen, HistoryScreen, LoginScreen, ProfileScreen, TopicsScreen, VideosScreen } from './src/screens/OtherScreens';
import { BecomeJournalistScreen, JournalistDeskScreen, WriteStoryScreen } from './src/screens/JournalistScreens';
import { AdminHomeScreen, AdminJournalistsScreen, AdminLoginScreen, AdminPasswordScreen, AdminRequestsScreen, AdminReviewScreen, AdminSubAdminsScreen } from './src/screens/AdminScreens';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, gcTime: 30 * 60_000 } },
});

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

/** Tapping a shared link (https://mavynews.in/n/<slug>) or a notification opens the story. */
const linking: LinkingOptions<any> = {
  prefixes: ['mavynews://', 'https://mavynews.in'],
  config: { screens: { Article: 'n/:slug', Main: { screens: { Home: '', Explore: 'search', Bookmarks: 'saved' } } } },
};

function MainTabs() {
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const icons: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
    Home: ['home', 'home-outline'], Videos: ['play-circle', 'play-circle-outline'], Explore: ['compass', 'compass-outline'],
    Bookmarks: ['bookmark', 'bookmark-outline'], Profile: ['person', 'person-outline'],
  };
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: th.dark ? th.green : th.navy,
        tabBarInactiveTintColor: th.muted,
        tabBarStyle: { backgroundColor: th.card, borderTopColor: th.border },
        tabBarLabelStyle: { fontFamily: font(), fontSize: 11 },
        headerTitleStyle: { fontFamily: font('bold') },
        tabBarIcon: ({ focused, color, size }) => <Ionicons name={icons[route.name][focused ? 0 : 1]} size={size} color={color} />,
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: t.home }} />
      <Tabs.Screen name="Videos" component={VideosScreen} options={{ title: t.videos, headerShown: true }} />
      <Tabs.Screen name="Explore" component={ExploreScreen} options={{ title: t.explore }} />
      <Tabs.Screen name="Bookmarks" component={BookmarksScreen} options={{ title: t.bookmarks }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ title: t.profile }} />
    </Tabs.Navigator>
  );
}

function Root() {
  const th = useTheme();
  const t = useT();
  const font = useFont();
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const language = useSettings((s) => s.language);
  const authReady = useAuth((s) => s.ready);
  const [fontsLoaded] = useFonts({ NotoSansTelugu_400Regular, NotoSansTelugu_700Bold });

  useEffect(() => {
    initAuth();
  }, []);

  if (!hydrated || !authReady || !fontsLoaded)
    return <View style={{ flex: 1, backgroundColor: '#0B1F3A', justifyContent: 'center' }}><ActivityIndicator color="#16A34A" size="large" /></View>;

  const navTheme = th.dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: th.bg, card: th.card, text: th.text, primary: th.green, border: th.border } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: th.bg, card: th.card, text: th.text, primary: th.navy, border: th.border } };

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <StatusBar style="light" />
      {!onboarded ? (
        <OnboardingScreen />
      ) : (
        <Stack.Navigator screenOptions={{ headerTintColor: th.text, headerBackButtonDisplayMode: 'minimal', headerTitleStyle: { fontFamily: font('bold') } }}>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Article" component={ArticleScreen} options={{ title: '', animation: 'slide_from_right' }} />
          <Stack.Screen name="ListFeed" component={ListFeedScreen} />
          <Stack.Screen name="Places" component={PlacesScreen} options={{ title: t.myPlaces }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: '', presentation: 'modal' }} />
          <Stack.Screen name="Topics" component={TopicsScreen} options={{ title: t.myTopics }} />
          <Stack.Screen name="Comments" component={CommentsScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: t.history }} />
          <Stack.Screen name="BecomeJournalist" component={BecomeJournalistScreen} options={{ title: language === 'te' ? 'జర్నలిస్ట్ దరఖాస్తు' : 'Become a journalist' }} />
          <Stack.Screen name="JournalistDesk" component={JournalistDeskScreen} options={{ title: language === 'te' ? 'నా జర్నలిస్ట్ డెస్క్' : 'My journalist desk' }} />
          <Stack.Screen name="WriteStory" component={WriteStoryScreen} options={{ title: language === 'te' ? 'వార్త రాయండి' : 'Write a story' }} />
          <Stack.Screen name="AdminLogin" component={AdminLoginScreen} options={{ title: '', presentation: 'modal' }} />
          <Stack.Screen name="AdminPassword" component={AdminPasswordScreen} options={{ title: '' }} />
          <Stack.Screen name="Admin" component={AdminHomeScreen} options={{ title: language === 'te' ? 'అడ్మిన్ ప్యానెల్' : 'Admin panel' }} />
          <Stack.Screen name="AdminReview" component={AdminReviewScreen} options={{ title: language === 'te' ? 'వార్తల సమీక్ష' : 'Review stories' }} />
          <Stack.Screen name="AdminRequests" component={AdminRequestsScreen} options={{ title: language === 'te' ? 'జర్నలిస్ట్ దరఖాస్తులు' : 'Journalist requests' }} />
          <Stack.Screen name="AdminJournalists" component={AdminJournalistsScreen} options={{ title: language === 'te' ? 'జర్నలిస్టులు' : 'Journalists' }} />
          <Stack.Screen name="AdminSubAdmins" component={AdminSubAdminsScreen} options={{ title: language === 'te' ? 'సబ్-అడ్మిన్లు' : 'Sub-admins' }} />
        </Stack.Navigator>
      )}
      <ShareCardHost />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
