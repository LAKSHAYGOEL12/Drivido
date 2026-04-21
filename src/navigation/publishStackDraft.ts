/**
 * Keyed drafts for the publish wizard (`LocationPicker` → …) after stack reset (location pick).
 * Drafts are removed after `DRAFT_TTL_MS` so Strict Mode remounts still see data,
 * but the window must cover route preview → date → time → price.
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
  /** Optional ride notes for passengers (POST /rides `description`). */
  rideDescription?: string;
  ladiesOnly: boolean;
  calendarMonthIso: string;
  clockHour24: number;
  clockMinute: number;
};

const draftByKey = new Map<string, PublishRideFormDraft>();

export function stashPublishRideDraft(key: string, d: PublishRideFormDraft): void {
  draftByKey.set(key, d);
}

export function getPublishRideDraft(key: string): PublishRideFormDraft | null {
  return draftByKey.get(key) ?? null;
}

/** Long enough for route preview → date → time → price; 3s was too short and left the draft empty. */
const DRAFT_TTL_MS = 120_000;

export function schedulePublishDraftCleanup(key: string): void {
  setTimeout(() => {
    draftByKey.delete(key);
  }, DRAFT_TTL_MS);
}
