/**
 * Chat UI only shows pending vs sent (no delivered/read receipts).
 * Maps API + legacy persisted values into two states.
 */
export type ChatDeliveryStatus = 'pending' | 'sent';

export function normalizeChatStatus(raw: string | undefined): ChatDeliveryStatus {
  const s = (raw ?? 'sent').toLowerCase().trim();
  if (s === 'sending' || s === 'pending') return 'pending';
  return 'sent';
}
