import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import BottomTabs from './BottomTabs';
import PublishStack from './PublishStack';
import Login from '../screens/auth/Login';
import Register from '../screens/auth/Register';
import LegalAgreementScreen from '../screens/auth/LegalAgreementScreen';
import VerifyEmail from '../screens/auth/VerifyEmail';
import CompleteProfile from '../screens/auth/CompleteProfile';
import ForgotPassword from '../screens/auth/ForgotPassword';
import AccountDeactivated from '../screens/auth/AccountDeactivated';
import ReactivateAccount from '../screens/auth/ReactivateAccount';

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
        name="PublishStack"
        component={PublishStack}
        options={{
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      />
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
      <Stack.Screen
        name="LegalAgreement"
        component={LegalAgreementScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="VerifyEmail"
        component={VerifyEmail}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="CompleteProfile"
        component={CompleteProfile}
        options={{
          presentation: 'modal',
          animation: 'slide_from_right',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPassword}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="AccountDeactivated"
        component={AccountDeactivated}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="ReactivateAccount"
        component={ReactivateAccount}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}
