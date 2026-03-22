import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { InboxStackParamList } from './types';
import { COLORS } from '../constants/colors';
import Inbox from '../screens/main/Inbox';
import ChatScreen from '../screens/main/ChatScreen';

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
      <Stack.Screen name="InboxList" component={Inbox} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
