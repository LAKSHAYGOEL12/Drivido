import { showToast } from './toast';

/** Pickup + destination + coords required before opening price or publishing. */
export function alertRouteRequiredBeforePrice(): void {
  showToast({
    variant: 'info',
    title: 'Finish your route first',
    message: 'Choose pickup and destination on the map. We need that distance to suggest a fair price range.',
  });
}

/** Same message when price screen is opened without valid route (edge case). */
export function alertRouteRequiredPriceScreen(): void {
  showToast({
    variant: 'info',
    title: 'Route incomplete',
    message: 'Go back and select both pickup and destination. Then you can set the price per seat.',
  });
}

export function alertDepartureTimeInPast(): void {
  showToast({
    variant: 'info',
    title: 'Check departure time',
    message: 'Choose a time at least 30 minutes from now.',
  });
}

export function alertMissingPickupDestination(): void {
  showToast({
    variant: 'info',
    title: 'Where are you going?',
    message: 'Add pickup and destination so we can show your ride to the right passengers.',
  });
}

export function alertNeedMapLocations(): void {
  showToast({
    variant: 'info',
    title: 'Pin both locations',
    message: 'Pick pickup and destination from the map (or use current location). We need coordinates to publish your ride.',
  });
}

export function alertFareRequiredBeforePublish(): void {
  showToast({
    variant: 'info',
    title: 'Set a price',
    message: 'Open Estimated fare and enter how much you charge per seat.',
  });
}

export function alertPublishFailed(message: string): void {
  showToast({
    variant: 'error',
    title: 'Couldn’t publish',
    message: message || 'Something went wrong. Please try again.',
    durationMs: 4200,
  });
}
