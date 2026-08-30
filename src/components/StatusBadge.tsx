import type { BookingStatus } from "@/lib/booking/status";

const COLORS: Record<BookingStatus, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  modification_requested: "bg-blue-100 text-blue-800",
  cancelled: "bg-red-100 text-red-800",
  refunded: "bg-lagoon-100 text-lagoon-800",
  partially_refunded: "bg-lagoon-100 text-lagoon-800",
  attended: "bg-emerald-100 text-emerald-800",
  no_show: "bg-red-100 text-red-800",
  completed: "bg-lagoon-700 text-white",
  disputed: "bg-orange-100 text-orange-800",
};

export function StatusBadge({ status, label }: { status: BookingStatus; label: string }) {
  return <span className={`badge ${COLORS[status]}`}>{label}</span>;
}
