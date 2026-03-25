import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import SearchStack from './SearchStack';
import PublishStack from './PublishStack';
import RidesStack from './RidesStack';
import InboxStack from './InboxStack';
import ProfileStack from './ProfileStack';
import { useInbox } from '../contexts/InboxContext';
import { COLORS } from '../constants/colors';

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function BottomTabs(): React.JSX.Element {
  const { hasUnread } = useInbox();

  return (
    <Tab.Navigator
      /** Keep inactive tab views attached — less detach flicker when switching. */
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#64748b',
        tabBarIconStyle: { marginBottom: -2 },
        tabBarHideOnKeyboard: true,
        /** Render tab screens up front — avoids cold mount flash. */
        lazy: false,
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
            name === 'EditRide' ||
            name === 'BookPassengerDetail' ||
            name === 'Chat' ||
            name === 'LocationPicker';
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
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'PublishRide';
          const hideTabs =
            name === 'LocationPicker' || name === 'PublishRoutePreview' || name === 'PublishPrice';
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
            name === 'RideDetail' || name === 'EditRide' || name === 'BookPassengerDetail' || name === 'Chat';
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
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'InboxList';
          const hideTabs = name === 'Chat';
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
        options={({ route }) => {
          const name = getFocusedRouteNameFromRoute(route) ?? 'ProfileHome';
          const hideTabs = name === 'Ratings';
          return {
            headerShown: false,
            title: 'Profile',
            tabBarLabel: 'Profile',
            tabBarStyle: hideTabs ? { display: 'none' } : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
            ),
          };
        }}
      />
    </Tab.Navigator>
  );
}
