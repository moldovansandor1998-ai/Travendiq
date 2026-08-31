export const dynamic = "force-dynamic";
import { requireAdmin } from "@/lib/admin";
import type { Locale } from "@/lib/i18n";

export default async function AdminLogs(
  props: {
    params: Promise<{ locale: Locale }>;
    searchParams: Promise<{ tab?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { locale } = params;
  const hu = locale === "hu";
  const { svc } = await requireAdmin(locale);
  const tab = searchParams.tab ?? "emails";

  const [{ data: emails }, { data: audits }] = await Promise.all([
    tab === "emails"
      ? svc.from("email_log").select("id, to_email, template, locale, status, created_at").order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: null }),
    tab === "audit"
      ? svc.from("audit_log").select("id, actor_id, actor_role, action, entity, entity_id, diff, created_at").order("created_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{hu ? "Naplók" : "Logs"}</h1>
      <nav className="mt-4 flex gap-2 text-sm">
        <a href={`/${locale}/admin/logs?tab=emails`}
          className={`rounded-lg px-3 py-1.5 font-medium ${tab === "emails" ? "bg-lagoon-600 text-white" : "bg-white text-lagoon-800 border border-lagoon-200"}`}>
          {hu ? "Email napló" : "Email log"}
        </a>
        <a href={`/${locale}/admin/logs?tab=audit`}
          className={`rounded-lg px-3 py-1.5 font-medium ${tab === "audit" ? "bg-lagoon-600 text-white" : "bg-white text-lagoon-800 border border-lagoon-200"}`}>
          Audit log
        </a>
      </nav>

      {tab === "emails" && (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sand-50 text-xs uppercase text-lagoon-700">
              <tr>
                <th className="px-3 py-2 text-start">{hu ? "Dátum" : "Date"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Címzett" : "To"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Sablon" : "Template"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Státusz" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {(emails ?? []).map((e) => (
                <tr key={e.id} className="border-t border-sand-100">
                  <td className="px-3 py-2">{new Date(e.created_at).toLocaleString(locale)}</td>
                  <td className="px-3 py-2">{e.to_email}</td>
                  <td className="px-3 py-2">{e.template} [{e.locale}]</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${e.status === "sent" ? "bg-emerald-100 text-emerald-800" : e.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                      {e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sand-50 text-xs uppercase text-lagoon-700">
              <tr>
                <th className="px-3 py-2 text-start">{hu ? "Dátum" : "Date"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Aktor" : "Actor"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Művelet" : "Action"}</th>
                <th className="px-3 py-2 text-start">{hu ? "Entitás" : "Entity"}</th>
              </tr>
            </thead>
            <tbody>
              {(audits ?? []).map((a) => (
                <tr key={a.id} className="border-t border-sand-100">
                  <td className="px-3 py-2">{new Date(a.created_at).toLocaleString(locale)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.actor_role ?? ""} {String(a.actor_id ?? "").slice(0, 8)}</td>
                  <td className="px-3 py-2">{a.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.entity} {String(a.entity_id ?? "").slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
