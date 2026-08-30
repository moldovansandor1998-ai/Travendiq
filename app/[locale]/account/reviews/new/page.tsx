import { redirect } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { reviewSchema } from "@/lib/validation";
import { getBookingWithAccess } from "@/lib/booking/access";

export const dynamic = "force-dynamic";

/** Értékelés küldése – kizárólag teljesített (completed/attended) foglalás után. */
export default async function NewReviewPage({
  params, searchParams,
}: { params: { locale: Locale }; searchParams: { booking?: string; token?: string; error?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  const bookingId = searchParams.booking;
  if (!bookingId) redirect(`/${locale}/account`);

  const access = await getBookingWithAccess({ id: bookingId }, searchParams.token ?? null);
  if (!access.ok || !["owner", "guest_token"].includes(access.via)) redirect(`/${locale}`);
  const b = access.booking as { id: string; status: string; user_id: string | null; listing_id: string; code: string };
  if (!["completed", "attended"].includes(b.status)) redirect(`/${locale}/account`);

  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();

  async function submit(formData: FormData) {
    "use server";
    const parsed = reviewSchema.safeParse({
      bookingId,
      rating: formData.get("rating"),
      ratingOrganization: formData.get("rating_organization") || undefined,
      ratingValue: formData.get("rating_value") || undefined,
      ratingGuide: formData.get("rating_guide") || undefined,
      comment: formData.get("comment") ?? "",
    });
    if (!parsed.success) redirect(`/${locale}/account/reviews/new?booking=${bookingId}&error=validation`);

    const service = createServiceClient();
    // guest token esetén: ha van user, a nevére; különben név nélkül (verified booking)
    const { error } = await service.from("reviews").insert({
      booking_id: bookingId,
      listing_id: b.listing_id,
      user_id: user?.id ?? null,
      rating: parsed.data.rating,
      rating_organization: parsed.data.ratingOrganization ?? null,
      rating_value: parsed.data.ratingValue ?? null,
      rating_guide: parsed.data.ratingGuide ?? null,
      comment: parsed.data.comment,
      status: "pending",
      is_verified_booking: true,
    });
    if (error) redirect(`/${locale}/account/reviews/new?booking=${bookingId}&error=exists`);
    redirect(`/${locale}/account?reviewed=1`);
  }

  return (
    <div className="container-page max-w-xl py-10">
      <h1 className="text-2xl font-bold text-lagoon-950">{t.listing.reviews}</h1>
      <p className="mt-1 text-sm text-lagoon-600">{b.code} · {t.listing.verifiedBooking}</p>
      {searchParams.error === "exists" && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t.reviews.alreadyReviewed}
        </p>
      )}
      <form action={submit} className="card mt-6 space-y-4 p-6">
        <Rating name="rating" label={t.reviews.overallRating} required />
        <Rating name="rating_organization" label={t.reviews.organization} />
        <Rating name="rating_value" label={t.reviews.valueForMoney} />
        <Rating name="rating_guide" label={t.reviews.guide} />
        <div>
          <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor="comment">
            {t.reviews.yourReview}
          </label>
          <textarea id="comment" name="comment" rows={4} maxLength={2000} className="input" />
        </div>
        <button className="btn-primary" type="submit">{t.common.save}</button>
      </form>
    </div>
  );
}

function Rating({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-lagoon-700" htmlFor={name}>{label}</label>
      <select id={name} name={name} required={required} className="input w-32">
        <option value="">–</option>
        {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
      </select>
    </div>
  );
}
