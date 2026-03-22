/**
 * Keyed drafts so PublishRide can restore form after stack reset (location pick).
 * Key is kept in the map for a short window so React Strict Mode remounts still see data.
 */
export type PublishRideFormDraft = {
  pickup: string;
  destination: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  selectedDateIso: string;
  dateLabel: string;
  selectedTime: { hour: number; minute: number };
  timeLabel: string;
  seats: number;
  rate: string;
  instantBooking: boolean;
  ladiesOnly: boolean;
  calendarMonthIso: string;
  clockHour12: number;
  clockAM: boolean;
  clockMinute: number;
};

const draftByKey = new Map<string, PublishRideFormDraft>();

export function stashPublishRideDraft(key: string, d: PublishRideFormDraft): void {
  draftByKey.set(key, d);
}

export function getPublishRideDraft(key: string): PublishRideFormDraft | null {
  return draftByKey.get(key) ?? null;
}

export function schedulePublishDraftCleanup(key: string): void {
  setTimeout(() => {
    draftByKey.delete(key);
  }, 3000);
}
