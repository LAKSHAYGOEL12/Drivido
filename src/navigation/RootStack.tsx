import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import BottomTabs from './BottomTabs';
import Login from '../screens/auth/Login';
import Register from '../screens/auth/Register';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Single root stack: main tabs for everyone (guest + authed); Login / Register as modals.
 */
export default function RootStack(): React.JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName="Main"
      screenOptions={{
        headerShown: false,
        headerBackTitle: 'Back',
        ...(Platform.OS === 'ios' ? { animationDuration: 320 } : {}),
      }}
    >
      <Stack.Screen name="Main" component={BottomTabs} options={{ animation: 'none' }} />
      <Stack.Screen
        name="Login"
        component={Login}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="Register"
        component={Register}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack.Navigator>
  );
}
