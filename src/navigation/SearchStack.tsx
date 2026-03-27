import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { SearchStackParamList } from './types';
import { COLORS } from '../constants/colors';
import SearchRides from '../screens/main/SearchRides';
import LocationPickerScreen from '../screens/main/LocationPickerScreen';
import SearchResultsScreen from '../screens/main/SearchResultsScreen';
import RideDetailScreen from '../screens/main/RideDetailScreen';
import EditRideScreen from '../screens/main/EditRideScreen';
import BookPassengerDetailScreen from '../screens/main/BookPassengerDetailScreen';
import ChatScreen from '../screens/main/ChatScreen';
import OwnerProfileModal from '../screens/main/OwnerProfileModal';
import OwnerRatingsModal from '../screens/main/OwnerRatingsModal';

const Stack = createNativeStackNavigator<SearchStackParamList>();

export default function SearchStack(): React.JSX.Element {
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
      initialRouteName="SearchRides"
    >
      <Stack.Screen name="SearchRides" component={SearchRides} />
      <Stack.Screen
        name="LocationPicker"
        component={LocationPickerScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          gestureDirection: 'vertical',
        }}
      />
      <Stack.Screen
        name="SearchResults"
        component={SearchResultsScreen}
        options={({ route }) => ({
          // We render our own "route pill" UI inside SearchResultsScreen.
          headerShown: false,
        })}
      />
      <Stack.Screen
        name="RideDetail"
        component={RideDetailScreen}
        options={{ headerShown: false }}
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
      <Stack.Screen
        name="OwnerProfileModal"
        component={OwnerProfileModal}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OwnerRatingsModal"
        component={OwnerRatingsModal}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
