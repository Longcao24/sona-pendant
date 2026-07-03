// Background/foreground plumbing for detection sessions.
//
// - Foreground service (react-native-background-actions): keeps the app process
//   + BLE stream + classify timers alive while the screen is off or the user is
//   in another app. Android 14 type "connectedDevice" is set in the manifest.
// - Session summary notification (expo-notifications): fired when the user
//   stops detection, so the day's numbers land in the shade without opening
//   the app.
import { Platform, PermissionsAndroid } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function askNotifPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    } catch {}
  }
}

// The service task just sleeps forever — its only job is holding foreground
// priority so the JS runtime (timers, BLE callbacks) keeps running.
const forever = async () => {
  // eslint-disable-next-line no-constant-condition
  while (BackgroundService.isRunning()) {
    await new Promise((r) => setTimeout(r, 60_000));
  }
};

export async function startDetectionService() {
  if (BackgroundService.isRunning()) return;
  try {
    await BackgroundService.start(forever, {
      taskName: 'sona-detect',
      taskTitle: 'Sona is listening',
      taskDesc: 'Detecting food intake from your pendant',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#34C759',
      linkingURI: 'sona://',
    });
  } catch {} // service refusal (rare) just means screen-off detection may pause
}

export async function stopDetectionService() {
  try { await BackgroundService.stop(); } catch {}
}

export async function notifySessionSummary(eatMs: number, events: number) {
  if (eatMs <= 0 && events <= 0) return;
  const m = Math.round(eatMs / 60000);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Detection session ended',
        body: m > 0
          ? `Today so far: ~${m} min eating · ${events} logged ${events === 1 ? 'event' : 'events'}.`
          : `${events} logged ${events === 1 ? 'event' : 'events'} today.`,
      },
      trigger: null, // now
    });
  } catch {}
}
