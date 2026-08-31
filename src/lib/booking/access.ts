import { createClient, createServiceClient } from "@/lib/supabase/server";

export type BookingAccess =
  | { ok: true; via: "owner" | "guest_token" | "provider" | "staff"; booking: Record<string, unknown> }
  | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Foglalás-hozzáférés ellenőrzése. Szabályok:
 * - bejelentkezett ügyfél: csak saját foglalás
 * - vendég: csak érvényes guest_access_tokennel
 * - szolgáltató: csak saját provideréhez tartozó foglalás
 * - staff/admin: külön ellenőrzött szerepkörrel
 */
export async function getBookingWithAccess(
  selector: { id?: string; code?: string },
  guestToken?: string | null
): Promise<BookingAccess> {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();

  const service = createServiceClient();
  const q = service.from("bookings").select("*");
  const { data: b } = selector.id
    ? await q.eq("id", selector.id).maybeSingle()
    : await q.eq("code", (selector.code ?? "").toUpperCase()).maybeSingle();

  if (!b) return { ok: false, reason: "not_found" };

  if (user) {
    if (b.user_id === user.id) return { ok: true, via: "owner", booking: b };
    const [{ data: member }, { data: staff }] = await Promise.all([
      session.rpc("is_provider_member", { p: b.provider_id }),
      session.rpc("is_staff"),
    ]);
    if (member) return { ok: true, via: "provider", booking: b };
    if (staff) return { ok: true, via: "staff", booking: b };
  }

  if (guestToken && b.guest_access_token === guestToken) {
    return { ok: true, via: "guest_token", booking: b };
  }
  return { ok: false, reason: "forbidden" };
}

/** Szerepkör-lekérdezés a bejelentkezett felhasználóhoz. */
export async function getRoles(): Promise<{ user: { id: string; email?: string } | null; roles: string[] }> {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { user: null, roles: [] };
  const { data } = await session.from("user_roles").select("role").eq("user_id", user.id);
  return { user: { id: user.id, email: user.email }, roles: (data ?? []).map((r) => r.role) };
}
