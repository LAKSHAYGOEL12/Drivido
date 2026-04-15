import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { PublishStackParamList } from './types';
import { COLORS } from '../constants/colors';
import PublishRide from '../screens/main/PublishRide';
import LocationPickerScreen from '../screens/main/LocationPickerScreen';
import PublishRoutePreviewScreen from '../screens/main/PublishRoutePreviewScreen';
import PublishSelectDateScreen from '../screens/main/PublishSelectDateScreen';
import PublishSelectTimeScreen from '../screens/main/PublishSelectTimeScreen';
import PublishPriceScreen from '../screens/main/PublishPriceScreen';
import PublishSelectSeatsScreen from '../screens/main/PublishSelectSeatsScreen';
import PublishRecentEditScreen from '../screens/main/PublishRecentEditScreen';

const Stack = createNativeStackNavigator<PublishStackParamList>();

export default function PublishStack(): React.JSX.Element {
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
      initialRouteName="PublishRide"
    >
      <Stack.Screen name="PublishRide" component={PublishRide} />
      <Stack.Screen name="PublishRecentEdit" component={PublishRecentEditScreen} />
      <Stack.Screen name="LocationPicker" component={LocationPickerScreen} />
      <Stack.Screen name="PublishRoutePreview" component={PublishRoutePreviewScreen} />
      <Stack.Screen name="PublishSelectDate" component={PublishSelectDateScreen} />
      <Stack.Screen name="PublishSelectTime" component={PublishSelectTimeScreen} />
      <Stack.Screen name="PublishPrice" component={PublishPriceScreen} />
      <Stack.Screen name="PublishSelectSeats" component={PublishSelectSeatsScreen} />
    </Stack.Navigator>
  );
}
