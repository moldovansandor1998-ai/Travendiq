/**
 * Foglalási státuszgép – engedélyezett átmenetek.
 * Az SQL booking_status enum tükre; a DB a státusznaplót triggerrel írja.
 */
export const BOOKING_STATUSES = [
  "pending_payment", "pending_confirmation", "confirmed", "modification_requested",
  "cancelled", "refunded", "partially_refunded", "attended", "no_show", "completed", "disputed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ["pending_confirmation", "cancelled"],
  pending_confirmation: ["confirmed", "cancelled", "disputed"],
  confirmed: ["modification_requested", "cancelled", "attended", "no_show", "disputed"],
  modification_requested: ["confirmed", "cancelled"],
  cancelled: ["refunded", "partially_refunded", "disputed"],
  refunded: ["disputed"],
  partially_refunded: ["refunded", "disputed"],
  attended: ["completed", "disputed"],
  no_show: ["completed", "disputed"],
  completed: [],
  disputed: ["confirmed", "cancelled", "refunded", "partially_refunded", "completed"],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Szerepkör szerinti engedélyezett átmenetek (üzleti szabály réteg). */
export function canActorTransition(
  actor: "customer" | "provider" | "staff",
  from: BookingStatus,
  to: BookingStatus
): boolean {
  if (!canTransition(from, to)) return false;
  if (actor === "staff") return true;
  if (actor === "customer") {
    return to === "cancelled" || to === "modification_requested" || to === "disputed";
  }
  // provider
  return ["confirmed", "cancelled", "attended", "no_show", "completed", "disputed"].includes(to);
}
