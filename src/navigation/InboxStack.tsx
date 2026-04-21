import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { InboxStackParamList } from './types';
import { COLORS } from '../constants/colors';
import Inbox from '../screens/main/Inbox';
import ChatScreen from '../screens/main/ChatScreen';
import RideDetailScreen from '../screens/main/RideDetailScreen';
import PublishedRideRouteMapScreen from '../screens/main/PublishedRideRouteMapScreen';
import LocationPickerScreen from '../screens/main/LocationPickerScreen';
import EditRideScreen from '../screens/main/EditRideScreen';
import BookPassengerDetailScreen from '../screens/main/BookPassengerDetailScreen';
import OwnerProfileModal from '../screens/main/OwnerProfileModal';
import OwnerRatingsModal from '../screens/main/OwnerRatingsModal';

const Stack = createNativeStackNavigator<InboxStackParamList>();

export default function InboxStack(): React.JSX.Element {
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
      initialRouteName="InboxList"
    >
      <Stack.Screen name="InboxList" component={Inbox} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen
        name="RideDetail"
        component={RideDetailScreen}
        options={{ headerShown: false }}
        getId={({ params }) => {
          const id = (params as { ride?: { id?: string } } | undefined)?.ride?.id?.trim();
          return id ? `ride-${id}` : undefined;
        }}
      />
      <Stack.Screen
        name="PublishedRideRouteMap"
        component={PublishedRideRouteMapScreen}
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
      <Stack.Screen name="EditRide" component={EditRideScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="BookPassengerDetail"
        component={BookPassengerDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="OwnerProfileModal" component={OwnerProfileModal} options={{ headerShown: false }} />
      <Stack.Screen name="OwnerRatingsModal" component={OwnerRatingsModal} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
