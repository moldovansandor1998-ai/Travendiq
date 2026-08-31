export const dynamic = "force-dynamic";
import { requireAdmin } from "@/lib/admin";
import { formatMoney } from "@/lib/utils";
import { getDictionary, type Locale } from "@/lib/i18n";
import { PayoutActions } from "./PayoutActions";
import { ReversalResolveForm } from "./ReversalResolveForm";

export default async function AdminPayouts(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const { locale } = params;
  const { svc } = await requireAdmin(locale);
  const t = await getDictionary(locale);
  const ap = t.adminPayouts as Record<string, string>;
  const statusLabel = (s: string) => ap[`st_${s}`] ?? s;
  const reversalLabel = (s: string) => ap[`rst_${s}`] ?? s;

  const { data: payouts } = await svc.from("payouts")
    .select("id, provider_id, booking_id, amount, currency, status, scheduled_for, hold_reason, paid_at, created_at, provider_payout_id, manual_reference, transfer_status, provider:providers(display_name, contact_email, stripe_onboarding_complete)")
    .order("created_at", { ascending: false }).limit(100);

  // rendezésre váró reversal-sorok: reconciliation_required + stripe_failed
  const { data: reversals } = await svc.from("payout_reversals")
    .select(`id, payout_id, refund_id, dispute_id, requested_amount, currency, status,
      failure, created_at, stripe_reversal_id,
      payout:payouts(amount, currency, status, provider:providers(display_name))`)
    .in("status", ["reconciliation_required", "stripe_failed"])
    .order("created_at", { ascending: false }).limit(100);

  return (
    <div className="container-page py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{ap.title}</h1>
      <p className="mt-1 text-sm text-lagoon-600">{ap.subtitle}</p>
      <div className="card mt-6 divide-y divide-lagoon-100">
        {(payouts ?? []).map((p) => {
          const prov = p.provider as unknown as { display_name: string; stripe_onboarding_complete: boolean } | null;
          const actionable = ["held", "pending", "scheduled"].includes(p.status);
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium text-lagoon-900">{prov?.display_name ?? p.provider_id}</p>
                <p className="text-xs text-lagoon-500">
                  {new Date(p.created_at).toLocaleDateString(locale)}
                  {p.scheduled_for && ` · ${ap.scheduled}: ${p.scheduled_for}`}
                  {p.hold_reason && ` · ${p.hold_reason}`}
                  {p.provider_payout_id && ` · ${p.provider_payout_id}`}
                  {p.manual_reference && ` · ${p.manual_reference}`}
                  {p.transfer_status && ` · transfer: ${p.transfer_status}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatMoney(p.amount, p.currency, locale)}</span>
                <span className={`badge ${p.status === "paid" ? "bg-emerald-100 text-emerald-800" : p.status === "failed" || p.status === "reconciliation_required" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                  {statusLabel(p.status)}
                </span>
                {actionable && (
                  <PayoutActions payoutId={p.id}
                    hasConnect={Boolean(prov?.stripe_onboarding_complete)}
                    showHold={p.status !== "held"}
                    labels={{
                      releaseStripe: ap.stripeTransfer,
                      releaseManual: ap.manualTransfer,
                      hold: ap.hold,
                      reference: ap.bankReference,
                      date: ap.transferDate,
                      note: ap.adminNote,
                      confirm: ap.record,
                      cancel: t.common.cancel,
                      error: ap.opFailed,
                    }} />
                )}
              </div>
            </div>
          );
        })}
        {(payouts ?? []).length === 0 && <p className="p-4 text-sm text-lagoon-500">–</p>}
      </div>

      {/* Rendezésre váró reversal-sorok (reconciliation_required / stripe_failed) */}
      <h2 className="mt-10 text-xl font-bold text-lagoon-950">{ap.reversalsTitle}</h2>
      <p className="mt-1 text-sm text-lagoon-600">{ap.reversalsSubtitle}</p>
      <div className="card mt-4 divide-y divide-lagoon-100">
        {(reversals ?? []).map((r) => {
          const po = r.payout as unknown as {
            amount: number; currency: string; status: string;
            provider: { display_name: string } | null;
          } | null;
          return (
            <div key={r.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-lagoon-900">
                    {po?.provider?.display_name ?? "–"}
                    <span className="ml-2 text-xs text-lagoon-500">
                      {ap.payout} {String(r.payout_id).slice(0, 8)}… · {po ? statusLabel(po.status) : ""}
                    </span>
                  </p>
                  <p className="text-xs text-lagoon-500">
                    {new Date(r.created_at).toLocaleString(locale)}
                    {r.refund_id && ` · ${ap.refundRef}: ${String(r.refund_id).slice(0, 8)}…`}
                    {r.dispute_id && ` · ${ap.disputeRef}: ${r.dispute_id}`}
                    {r.stripe_reversal_id && ` · ${r.stripe_reversal_id}`}
                  </p>
                  {r.failure && <p className="mt-1 text-xs text-red-700">{r.failure}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatMoney(r.requested_amount, r.currency, locale)}</span>
                  <span className="badge bg-red-100 text-red-800">
                    {reversalLabel(r.status)}
                  </span>
                </div>
              </div>
              <ReversalResolveForm
                reversalId={r.id}
                expectedAmount={r.requested_amount}
                currency={r.currency}
                labels={{
                  reference: ap.resolveReference,
                  date: ap.resolveDate,
                  amount: ap.resolveAmount,
                  note: ap.resolveNote,
                  confirm: ap.resolveConfirm,
                  success: ap.resolveSuccess,
                  error: ap.resolveError,
                }} />
            </div>
          );
        })}
        {(reversals ?? []).length === 0 && (
          <p className="p-4 text-sm text-lagoon-500">{ap.noReversals}</p>
        )}
      </div>
    </div>
  );
}
