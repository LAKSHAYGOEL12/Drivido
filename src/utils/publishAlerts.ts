import { showToast } from './toast';

/** Pickup + destination + coords required before opening price or publishing. */
export function alertRouteRequiredBeforePrice(): void {
  showToast({
    variant: 'info',
    title: 'Finish your route first',
    message: 'Add pickup and drop-off (search, then pin on the map). We need both points to suggest a fair fare.',
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
    message: 'Open fare per seat and enter how much you charge.',
  });
}

export function alertFareOutsideAllowedRange(minAllowed: number, maxAllowed: number): void {
  showToast({
    variant: 'info',
    title: 'Adjust your fare',
    message: `Per seat must be between ₹${minAllowed} and ₹${maxAllowed} (up to ₹20 below or ₹50 above the suggested range for this distance).`,
    durationMs: 4500,
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
