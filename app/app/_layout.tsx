import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { BleProvider } from '@/components/ble-provider';
import { ConnectGate } from '@/components/connect-gate';
import { EventsProvider } from '@/components/events-provider';
import { ServerUrlProvider } from '@/components/server-url-provider';
import { A } from '@/constants/apple';

export const unstable_settings = {
  anchor: '(tabs)',
};

// App-wide light theme (Apple look). Dark mode intentionally not offered.
const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: A.bg,
    card: A.card,
    primary: A.blue,
  },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ServerUrlProvider>
      <BleProvider>
      <EventsProvider>
        <ThemeProvider value={LightTheme}>
          <ConnectGate>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="record" options={{ title: 'Record Raw Audio', headerBackTitle: 'Settings' }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
          </ConnectGate>
          <StatusBar style="dark" />
        </ThemeProvider>
      </EventsProvider>
      </BleProvider>
      </ServerUrlProvider>
    </SafeAreaProvider>
  );
}
