import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RidesStackParamList } from './types';
import { COLORS } from '../constants/colors';
import YourRides from '../screens/main/YourRides';
import RideDetailScreen from '../screens/main/RideDetailScreen';
import LocationPickerScreen from '../screens/main/LocationPickerScreen';
import EditRideScreen from '../screens/main/EditRideScreen';
import BookPassengerDetailScreen from '../screens/main/BookPassengerDetailScreen';
import ChatScreen from '../screens/main/ChatScreen';

const Stack = createNativeStackNavigator<RidesStackParamList>();

export default function RidesStack(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        /** Avoid freezing root when leaving tab — smoother return to Your Rides. */
        freezeOnBlur: false,
        contentStyle: { backgroundColor: COLORS.backgroundSecondary },
        ...(Platform.OS === 'ios' ? { animationDuration: 320 } : {}),
      }}
      initialRouteName="YourRidesList"
    >
      <Stack.Screen
        name="YourRidesList"
        component={YourRides}
        options={{ title: 'Your Rides' }}
      />
      <Stack.Screen
        name="RideDetail"
        component={RideDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LocationPicker"
        component={LocationPickerScreen}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          gestureDirection: 'vertical',
        }}
      />
      <Stack.Screen
        name="EditRide"
        component={EditRideScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BookPassengerDetail"
        component={BookPassengerDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
