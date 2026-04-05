import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import UserAvatar from '../components/common/UserAvatar';
import SearchStack from './SearchStack';
import PublishStack from './PublishStack';
import RidesStack from './RidesStack';
import InboxStack from './InboxStack';
import ProfileStack from './ProfileStack';
import { useInbox } from '../contexts/InboxContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS } from '../constants/colors';
import { navigateToGuestLogin } from './navigateToGuestLogin';
import { findMainTabNavigator } from './findMainTabNavigator';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Slightly enlarges the focused tab icon vs inactive tabs. */
const TAB_ICON_FOCUS_SCALE = 1.14;

function ScaledTabIcon({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: focused ? TAB_ICON_FOCUS_SCALE : 1 }],
      }}
    >
      {children}
    </View>
  );
}

function ProfileTabBarIcon({
  focused,
  color,
  size,
  avatarUrl,
  displayName,
}: {
  focused: boolean;
  color: string;
  size: number;
  avatarUrl?: string | null;
  displayName: string;
}): React.JSX.Element {
  const uri = (avatarUrl ?? '').trim();
  const name = displayName.trim() || 'You';
  return (
    <View
      style={[
        styles.profileTabIconRing,
        focused && styles.profileTabIconRingFocused,
        { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 },
      ]}
    >
      <UserAvatar
        uri={uri || undefined}
        name={name}
        size={size}
        backgroundColor={focused ? 'rgba(41, 190, 139, 0.18)' : '#f1f5f9'}
        fallbackTextColor={focused ? COLORS.primary : color}
      />
    </View>
  );
}

/** Nested screen name at top of Inbox stack (InboxList, Chat, RideDetail, …). */
function getInboxStackFocusedName(navigation: { getState?: () => { routes?: { name?: string }[]; index?: number } }): string | undefined {
  const st = navigation?.getState?.();
  const routes = st?.routes;
  if (!routes?.length) return undefined;
  const idx = typeof st?.index === 'number' ? st.index : routes.length - 1;
  return routes[idx]?.name;
}

function resetInboxTabToInboxList(mainTabs: { dispatch: (a: unknown) => void; getState: () => { routes?: any[]; index?: number } }): void {
  const tabState = mainTabs.getState();
  const routes = (tabState?.routes ?? []) as any[];
  const inboxIndex = routes.findIndex((r: { name?: string }) => r?.name === 'Inbox');
  if (inboxIndex < 0) return;
  const nextRoutes = routes.map((r: any) => {
    if (r?.name !== 'Inbox') return r;
    return {
      ...r,
      state: {
        routes: [{ name: 'InboxList' as const }],
        index: 0,
      },
    };
  });
  mainTabs.dispatch(
    CommonActions.reset({
      index: inboxIndex,
      routes: nextRoutes,
    } as never)
  );
}

export default function BottomTabs(): React.JSX.Element {
  const { hasUnread } = useInbox();
  const { user, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;

  return (
    <Tab.Navigator
      /** Keep tab screens mounted so Rides (etc.) state isn’t wiped when switching tabs — avoids empty flashes. */
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#64748b',
        tabBarIconStyle: { marginBottom: -2 },
        tabBarHideOnKeyboard: true,
        /** Lazy mount tab screens — smoother first open of BottomTabs. */
        lazy: true,
        /** No cross-fade — `fade` caused a visible flash / "lighting" effect between tabs. */
        animation: 'none',
        sceneStyle: {
          backgroundColor: COLORS.backgroundSecondary,
        },
      }}
    >
      <Tab.Screen
        name="SearchStack"
        component={SearchStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate({
              name: 'SearchStack',
              params: {
                screen: 'SearchRides',
                params: { _tabResetToken: Date.now() },
              },
              merge: false,
            });
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'SearchRides';
          const hideTabs =
            name === 'RideDetail' ||
            name === 'RideDetailScreen' ||
            name === 'LocationPicker' ||
            name === 'PublishedRideRouteMap' ||
            name === 'BookPassengerDetail' ||
            name === 'Chat' ||
            name === 'OwnerProfileModal' ||
            name === 'OwnerRatingsModal';
          return {
            headerShown: false,
            title: 'Find',
            tabBarLabel: 'Find',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <ScaledTabIcon focused={focused}>
                <Ionicons name={focused ? 'search' : 'search-outline'} size={size} color={color} />
              </ScaledTabIcon>
            ),
          };
        }}
      />
      <Tab.Screen
        name="PublishStack"
        component={PublishStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            e.preventDefault();
            (navigation as { navigate: (config: Record<string, unknown>) => void }).navigate({
              name: 'PublishStack',
              params: {
                screen: 'PublishRide',
                params: {},
              },
              merge: false,
            });
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'PublishRide';
          const hideTabs =
            name === 'RideDetail' ||
            name === 'Chat' ||
            name === 'LocationPicker' ||
            name === 'PublishRoutePreview' ||
            name === 'PublishPrice' ||
            name === 'PublishRecentEdit';
          return {
            headerShown: false,
            title: 'Publish a Ride',
            tabBarLabel: 'Publish',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <ScaledTabIcon focused={focused}>
                <Ionicons name={focused ? 'add-circle' : 'add-circle-outline'} size={size} color={color} />
              </ScaledTabIcon>
            ),
          };
        }}
      />
      <Tab.Screen
        name="YourRides"
        component={RidesStack}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            const currentRoute = getFocusedRouteNameFromRoute(route) ?? 'YourRidesList';
            if (currentRoute !== 'YourRidesList') {
              e.preventDefault();
              navigation.navigate({
                name: route.name,
                params: { screen: 'YourRidesList' as const },
                merge: false,
              });
            }
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'YourRidesList';
          const hideTabs =
            name === 'RideDetail' ||
            name === 'RideDetailScreen' ||
            name === 'BookPassengerDetail' ||
            name === 'PublishedRideRouteMap' ||
            name === 'Chat' ||
            name === 'OwnerProfileModal' ||
            name === 'OwnerRatingsModal';
          return {
            headerShown: false,
            title: 'Your Rides',
            tabBarLabel: 'Rides',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <ScaledTabIcon focused={focused}>
                <Ionicons name={focused ? 'car' : 'car-outline'} size={size} color={color} />
              </ScaledTabIcon>
            ),
          };
        }}
      />
      <Tab.Screen
        name="Inbox"
        component={InboxStack}
        listeners={({ navigation }) => ({
          /**
           * When switching from another tab (e.g. Search) back to Inbox, `route` can be stale:
           * `getFocusedRouteNameFromRoute(route)` may wrongly default to InboxList while Chat is still
           * on the nested stack — so we read the **live** Inbox stack via `navigation.getState()`.
           */
          focus: () => {
            if (!sessionReady) return;
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) return;
            const focused = getInboxStackFocusedName(navigation);
            if (focused && focused !== 'InboxList') {
              resetInboxTabToInboxList(mainTabs);
            }
          },
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            const focused = getInboxStackFocusedName(navigation);
            if (focused === undefined || focused === 'InboxList') {
              return;
            }
            e.preventDefault();
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) {
              navigation.navigate({
                name: 'Inbox',
                params: { screen: 'InboxList' as const },
                merge: false,
              } as never);
              return;
            }
            resetInboxTabToInboxList(mainTabs);
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'InboxList';
          const hideTabs =
            name === 'RideDetail' ||
            name === 'RideDetailScreen' ||
            name === 'BookPassengerDetail' ||
            name === 'PublishedRideRouteMap' ||
            name === 'LocationPicker' ||
            name === 'EditRide' ||
            name === 'Chat' ||
            name === 'OwnerProfileModal' ||
            name === 'OwnerRatingsModal';
          return {
            headerShown: false,
            title: 'Chats',
            tabBarLabel: 'Chats',
            tabBarBadge: hasUnread ? 1 : undefined,
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <ScaledTabIcon focused={focused}>
                <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
              </ScaledTabIcon>
            ),
          };
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        listeners={({ navigation }) => ({
          /**
           * Match Find / Publish: tab bar tap replaces nested stack in one action (`merge: false`).
           * Avoid `focus` + `CommonActions.reset` — that ran after the first paint and briefly showed
           * stale screens (e.g. someone else’s Trips left on the Profile stack).
           */
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            e.preventDefault();
            const uid = user?.id?.trim();
            navigation.navigate({
              name: 'Profile',
              params: {
                screen: 'ProfileHome',
                params: uid
                  ? {
                      userId: uid,
                      displayName: user?.name,
                      ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
                    }
                  : undefined,
              },
              merge: false,
            } as never);
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'ProfileHome';
          // Show tabs on your main Profile screen, hide only for nested views.
          const hideTabs =
            name === 'ProfileEntry' ||
            name === 'EditProfile' ||
            name === 'Trips' ||
            name === 'Ratings' ||
            name === 'RatingsScreen';
          return {
            headerShown: false,
            title: 'Profile',
            tabBarLabel: 'Profile',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <ScaledTabIcon focused={focused}>
                <ProfileTabBarIcon
                  focused={focused}
                  color={color}
                  size={size}
                  avatarUrl={user?.avatarUrl}
                  displayName={user?.name ?? 'You'}
                />
              </ScaledTabIcon>
            ),
          };
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  profileTabIconRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderColor: COLORS.primary,
  },
  profileTabIconRingFocused: {
    borderWidth: 2,
  },
});
