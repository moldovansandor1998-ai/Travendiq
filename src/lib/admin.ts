import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Admin-hozzáférés ellenőrzése oldalakon és server actionökben. */
export async function requireAdmin(locale: string) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: isAdmin } = (await sb.rpc("is_admin")) as { data: boolean | null };
  if (!isAdmin) redirect(`/${locale}`);
  return { user, sb, svc: createServiceClient() };
}

export async function audit(svc: ReturnType<typeof createServiceClient>, entry: {
  actorId: string; action: string; entity: string; entityId?: string; diff?: Record<string, unknown>;
}) {
  await svc.from("audit_log").insert({
    actor_id: entry.actorId,
    actor_role: "admin",
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    diff: entry.diff ?? null,
  });
}
