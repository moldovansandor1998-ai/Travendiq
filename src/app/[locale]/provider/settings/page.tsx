export const dynamic = "force-dynamic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { ConnectButton } from "./ConnectButton";

export default async function ProviderSettings({ params, searchParams }: {
  params: { locale: Locale };
  searchParams: { connect?: string };
}) {
  const { locale } = params;
  const t = getDictionary(locale);
  const ps = t.providerSettings as Record<string, string>;
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/${locale}/auth/login`);
  const { data: provider } = await sb.from("providers")
    .select(`id, display_name, contact_email, contact_phone, stripe_account_id,
      stripe_onboarding_complete, payout_iban,
      stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
      stripe_requirements, stripe_capabilities`)
    .eq("owner_id", user.id).maybeSingle();
  if (!provider) redirect(`/${locale}/provider/register`);

  const req = (provider.stripe_requirements ?? {}) as {
    currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null;
  };
  const caps = (provider.stripe_capabilities ?? {}) as Record<string, string>;
  const dueItems = [...(req.currently_due ?? []), ...(req.past_due ?? [])];

  async function saveProfile(formData: FormData) {
    "use server";
    const sb2 = createClient();
    const { data: { user: u } } = await sb2.auth.getUser();
    if (!u) redirect(`/${locale}/auth/login`);
    const name = String(formData.get("display_name") ?? "").trim();
    const email = String(formData.get("contact_email") ?? "").trim();
    const phone = String(formData.get("contact_phone") ?? "").trim();
    if (!name || !email) throw new Error("invalid input");
    const svc = createServiceClient();
    // a mentés hibája NEM csendes: a felhasználó exceptiont kap, nem hamis sikert
    const { error } = await svc.from("providers")
      .update({ display_name: name, contact_email: email, contact_phone: phone || null })
      .eq("owner_id", u.id);
    if (error) {
      console.error("[provider/settings] save failed:", error.message);
      throw new Error("save failed");
    }
    revalidatePath(`/${locale}/provider/settings`);
  }



  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{ps.title}</h1>

      {searchParams.connect === "done" && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {ps.connectDone}
        </div>
      )}
      {searchParams.connect === "incomplete" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {ps.connectIncomplete}
        </div>
      )}
      {searchParams.connect === "error" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {ps.connectError}
        </div>
      )}

      <form action={saveProfile} className="card mt-6 grid gap-3 p-5 sm:grid-cols-3">
        <label className="text-sm">{ps.displayName}
          <input name="display_name" required defaultValue={provider.display_name} className="input mt-1" />
        </label>
        <label className="text-sm">E-mail
          <input name="contact_email" type="email" required defaultValue={provider.contact_email} className="input mt-1" />
        </label>
        <label className="text-sm">{ps.phone}
          <input name="contact_phone" defaultValue={provider.contact_phone ?? ""} className="input mt-1" />
        </label>
        <div className="sm:col-span-3">
          <button className="btn-primary" type="submit">{t.common.save}</button>
        </div>
      </form>

      <div className="card mt-6 p-5">
        <h2 className="font-semibold text-lagoon-900">Stripe Connect</h2>
        <p className="mt-1 text-sm text-lagoon-600">
          {provider.stripe_onboarding_complete ? ps.stripeActive : ps.stripeSetup}
        </p>
        <p className="mt-2 text-sm">
          <span className={`badge ${provider.stripe_onboarding_complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {provider.stripe_onboarding_complete
              ? ps.connected
              : provider.stripe_account_id
                ? ps.verifying
                : ps.notConnected}
          </span>
        </p>

        {/* Részletes Connect-állapot: capability-k + hiányzó requirements */}
        {provider.stripe_account_id && (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg bg-lagoon-50 px-3 py-2">
              <dt className="text-lagoon-700">{ps.cardPayments}</dt>
              <dd className="font-semibold">{caps.card_payments ?? (provider.stripe_charges_enabled ? "active" : "–")}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-lagoon-50 px-3 py-2">
              <dt className="text-lagoon-700">{ps.transfers}</dt>
              <dd className="font-semibold">{caps.transfers ?? (provider.stripe_payouts_enabled ? "active" : "–")}</dd>
            </div>
          </dl>
        )}
        {req.disabled_reason && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {ps.disabledByStripe}: <b>{req.disabled_reason}</b>
          </p>
        )}
        {(req.past_due?.length ?? 0) > 0 && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {ps.pastDue}: <b>{req.past_due!.length}</b> {ps.items}
          </p>
        )}
        {dueItems.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-lagoon-900">{ps.missingInfo}</p>
            <ul className="mt-1 list-inside list-disc text-sm text-lagoon-700">
              {dueItems.slice(0, 8).map((d) => <li key={d}><code className="text-xs">{d}</code></li>)}
            </ul>
          </div>
        )}
        {!provider.stripe_onboarding_complete && (
          <ConnectButton hasAccount={!!provider.stripe_account_id}
            labels={{
              create: ps.createAccount,
              continue: ps.continueVerification,
              error: ps.connectStartError,
            }} />
        )}
      </div>
    </div>
  );
}
