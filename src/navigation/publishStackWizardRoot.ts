import { CommonActions } from '@react-navigation/native';
import { clearPublishRouteDirectionsMemoryCache } from '../utils/publishRouteDirectionsMemoryCache';
import type { MainTabName } from './mainTabOrder';
import { stashPublishRideDraft } from './publishStackDraft';
import { formatPublishStyleDateLabel } from '../utils/rideDisplay';

function getDefaultTimeOneHourAhead(): { hour: number; minute: number } {
  const now = new Date();
  let hour = now.getHours() + 1;
  let minute = now.getMinutes();
  minute = Math.ceil(minute / 5) * 5;
  if (minute >= 60) {
    minute = 0;
    hour += 1;
  }
  if (hour >= 24) hour = 23;
  return { hour, minute };
}

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function stashEmptyWizardDraft(publishRestoreKey: string): void {
  const today = new Date();
  const defaultTime = getDefaultTimeOneHourAhead();
  stashPublishRideDraft(publishRestoreKey, {
    pickup: '',
    destination: '',
    pickupLatitude: 0,
    pickupLongitude: 0,
    destinationLatitude: 0,
    destinationLongitude: 0,
    selectedDateIso: today.toISOString(),
    dateLabel: formatPublishStyleDateLabel(today),
    selectedTime: defaultTime,
    timeLabel: formatTimeLabel(defaultTime.hour, defaultTime.minute),
    seats: 1,
    rate: '',
    instantBooking: false,
    rideDescription: '',
    ladiesOnly: false,
    calendarMonthIso: today.toISOString(),
    clockHour24: defaultTime.hour,
    clockMinute: (Math.round(defaultTime.minute / 5) * 5) % 60,
  });
}

export type PublishWizardRootOptions = {
  publishFabExitTab?: MainTabName;
};

/**
 * Single stack route: pickup `LocationPicker` for the FAB wizard (no legacy Publish form).
 * Callers should `dispatch(CommonActions.reset({ routes: [buildPublishWizardRootRoute()], index: 0 }))` or navigate equivalent.
 */
export function buildPublishWizardRootRoute(options?: PublishWizardRootOptions): {
  name: 'LocationPicker';
  params: Record<string, unknown>;
} {
  const publishRestoreKey = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  stashEmptyWizardDraft(publishRestoreKey);
  return {
    name: 'LocationPicker',
    params: {
      field: 'from' as const,
      currentFrom: '',
      currentTo: '',
      currentPickupLatitude: 0,
      currentPickupLongitude: 0,
      currentDestinationLatitude: 0,
      currentDestinationLongitude: 0,
      returnScreen: 'PublishWizard' as const,
      publishRestoreKey,
      publishWizardReview: true,
      ...(options?.publishFabExitTab ? { publishFabExitTab: options.publishFabExitTab } : {}),
    },
  };
}

export function dispatchResetPublishStackToWizardRoot(
  navigation: unknown,
  options?: PublishWizardRootOptions
): void {
  const nav = navigation as { dispatch?: (a: unknown) => void };
  if (!nav.dispatch) return;
  clearPublishRouteDirectionsMemoryCache();
  nav.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [buildPublishWizardRootRoute(options)],
    }) as never
  );
}
