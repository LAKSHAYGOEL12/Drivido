import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from './types';
import { COLORS } from '../constants/colors';
import Profile from '../screens/main/Profile';
import RatingsScreen from '../screens/main/RatingsScreen';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStack(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        freezeOnBlur: false,
        contentStyle: { backgroundColor: COLORS.backgroundSecondary },
        ...(Platform.OS === 'ios' ? { animationDuration: 320 } : {}),
      }}
      initialRouteName="ProfileHome"
    >
      <Stack.Screen name="ProfileHome" component={Profile} />
      <Stack.Screen name="Ratings" component={RatingsScreen} />
    </Stack.Navigator>
  );
}
