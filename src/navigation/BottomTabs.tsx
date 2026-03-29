import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
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

const Tab = createBottomTabNavigator<MainTabParamList>();

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

function findMainTabNavigator(navigation: any) {
  let current = navigation?.getParent?.() as any | undefined;
  for (let i = 0; i < 5 && current; i += 1) {
    const names: string[] | undefined = current?.getState?.()?.routeNames;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) return current;
    current = current.getParent?.();
  }
  return null;
}

export default function BottomTabs(): React.JSX.Element {
  const { hasUnread } = useInbox();
  const { user, isAuthenticated } = useAuth();

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
            name === 'BookPassengerDetail' ||
            name === 'Chat' ||
            name === 'OwnerProfileModal' ||
            name === 'OwnerRatingsModal';
          return {
            headerShown: false,
            title: 'Search',
            tabBarLabel: 'Search',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <Ionicons name={focused ? 'search' : 'search-outline'} size={size} color={color} />
            ),
          };
        }}
      />
      <Tab.Screen
        name="PublishStack"
        component={PublishStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!isAuthenticated) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
            }
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'PublishRide';
          const hideTabs =
            name === 'RideDetail' ||
            name === 'Chat' ||
            name === 'LocationPicker' ||
            name === 'PublishRoutePreview' ||
            name === 'PublishPrice';
          return {
            headerShown: false,
            title: 'Publish a Ride',
            tabBarLabel: 'Publish',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <Ionicons name={focused ? 'add-circle' : 'add-circle-outline'} size={size} color={color} />
            ),
          };
        }}
      />
      <Tab.Screen
        name="YourRides"
        component={RidesStack}
        listeners={({ navigation, route }) => ({
          tabPress: (e) => {
            if (!isAuthenticated) {
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
            name === 'Chat' ||
            name === 'OwnerProfileModal' ||
            name === 'OwnerRatingsModal';
          return {
            headerShown: false,
            title: 'Your Rides',
            tabBarLabel: 'Rides',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
              <Ionicons name={focused ? 'car' : 'car-outline'} size={size} color={color} />
            ),
          };
        }}
      />
      <Tab.Screen
        name="Inbox"
        component={InboxStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!isAuthenticated) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
            }
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'InboxList';
          const hideTabs = name === 'RideDetail' || name === 'Chat';
          return {
            headerShown: false,
            title: 'Inbox',
            tabBarLabel: 'Inbox',
            tabBarBadge: hasUnread ? 1 : undefined,
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
            ),
          };
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        listeners={({ navigation }) => ({
          focus: () => {
            // If the Profile tab becomes focused (even indirectly), always show *my* profile.
            // This prevents "other user profile" sticking in the tab history.
            const uid = user?.id?.trim();
            if (!uid) return;

            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) return;
            const tabState = mainTabs.getState();
            const routes = (tabState?.routes ?? []) as any[];
            const profileIndex = routes.findIndex((r) => r?.name === 'Profile');

            const nextProfileParams = {
              userId: uid,
              displayName: user?.name,
              ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
            };
            // Always overwrite the Profile tab nested stack to ProfileHome.
            const nextRoutes = routes.map((r) => {
              if (r?.name !== 'Profile') return r;
              return {
                ...r,
                state: {
                  routes: [{ name: 'ProfileHome', params: nextProfileParams }],
                  index: 0,
                },
              };
            });

            mainTabs.dispatch(
              CommonActions.reset({
                index: profileIndex >= 0 ? profileIndex : tabState?.index ?? 4,
                routes: nextRoutes,
              })
            );
          },
          tabPress: (e) => {
            if (!isAuthenticated) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            // Always return to *my* profile when the user taps Profile tab.
            e.preventDefault();
            const uid = user?.id?.trim();

            const mainTabs = findMainTabNavigator(navigation);
            if (mainTabs?.dispatch && mainTabs?.getState) {
              const tabState = mainTabs.getState?.();
              const routes = (tabState?.routes ?? []) as any[];
              const profileIndex = routes.findIndex((r) => r?.name === 'Profile');
              const nextProfileParams = uid
                ? {
                    userId: uid,
                    displayName: user?.name,
                    ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
                  }
                : undefined;

              const nextRoutes = routes.map((r) => {
                if (r?.name !== 'Profile') return r;
                return {
                  ...r,
                  state: {
                    routes: [
                      {
                        name: 'ProfileHome',
                        params: nextProfileParams,
                      },
                    ],
                    index: 0,
                  },
                };
              });

              mainTabs.dispatch(
                CommonActions.reset({
                  index: profileIndex >= 0 ? profileIndex : tabState?.index ?? 4,
                  routes: nextRoutes,
                })
              );
              return;
            }

            // Fallback: if we can’t find parent state, just navigate.
            navigation.navigate('Profile', {
              screen: 'ProfileHome',
              params: uid
                ? {
                    userId: uid,
                    displayName: user?.name,
                    ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
                  }
                : undefined,
            } as any);
          },
        })}
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'ProfileHome';
          // Show tabs on your main Profile screen, hide only for nested views.
          const hideTabs =
            name === 'ProfileEntry' ||
            name === 'Ratings' ||
            name === 'RatingsScreen';
          return {
            headerShown: false,
            title: 'Profile',
            tabBarLabel: 'Profile',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <ProfileTabBarIcon
                focused={focused}
                color={color}
                size={size}
                avatarUrl={user?.avatarUrl}
                displayName={user?.name ?? 'You'}
              />
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
