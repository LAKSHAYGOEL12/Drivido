import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { PublishStackParamList } from './types';
import { COLORS } from '../constants/colors';
import { buildPublishWizardRootRoute } from './publishStackWizardRoot';
import LocationPickerScreen from '../screens/main/LocationPickerScreen';
import PublishRoutePreviewScreen from '../screens/main/PublishRoutePreviewScreen';
import PublishSelectDateScreen from '../screens/main/PublishSelectDateScreen';
import PublishSelectTimeScreen from '../screens/main/PublishSelectTimeScreen';
import PublishPriceScreen from '../screens/main/PublishPriceScreen';
import PublishSelectSeatsScreen from '../screens/main/PublishSelectSeatsScreen';
import PublishRecentEditScreen from '../screens/main/PublishRecentEditScreen';
import PublishReviewScreen from '../screens/main/PublishReviewScreen';
import PublishRecentsPickerScreen from '../screens/main/PublishRecentsPickerScreen';

const Stack = createNativeStackNavigator<PublishStackParamList>();

export default function PublishStack(): React.JSX.Element {
  const locationPickerInitialParams = useMemo(() => buildPublishWizardRootRoute().params, []);

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
      initialRouteName="LocationPicker"
    >
      <Stack.Screen
        name="LocationPicker"
        component={LocationPickerScreen}
        initialParams={locationPickerInitialParams}
      />
      <Stack.Screen name="PublishRecentsPicker" component={PublishRecentsPickerScreen} />
      <Stack.Screen name="PublishRecentEdit" component={PublishRecentEditScreen} />
      <Stack.Screen
        name="PublishRoutePreview"
        component={PublishRoutePreviewScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="PublishSelectDate"
        component={PublishSelectDateScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="PublishSelectTime"
        component={PublishSelectTimeScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="PublishPrice"
        component={PublishPriceScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="PublishSelectSeats"
        component={PublishSelectSeatsScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="PublishReview"
        component={PublishReviewScreen}
        options={{
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
    </Stack.Navigator>
  );
}
