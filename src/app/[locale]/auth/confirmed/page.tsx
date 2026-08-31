import Link from "next/link";
import { type Locale } from "@/lib/i18n";

export default async function ConfirmedPage(
  props: {
    params: Promise<{ locale: Locale }>; searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const failed = Boolean(searchParams.error);
  return (
    <div className="container-page max-w-lg py-20 text-center">
      <div className="card p-8">
        <h1 className="text-3xl font-bold text-lagoon-950">{failed ? "Confirmation link invalid" : "Email confirmed"}</h1>
        <p className="mt-3 text-lagoon-700">{failed ? "This link is invalid or has expired. Please register again to receive a new link." : "Your Travendiq account is active. You can now sign in and start discovering experiences."}</p>
        <Link href={`/${params.locale}/${failed ? "auth/register" : "auth/login"}`} className="btn-primary mt-6 inline-flex">{failed ? "Register again" : "Sign in"}</Link>
      </div>
    </div>
  );
}
