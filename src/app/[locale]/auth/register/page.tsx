import { getDictionary, type Locale } from "@/lib/i18n";
import { RegisterForm } from "./RegisterForm";

export default function RegisterPage({ params }: { params: { locale: Locale } }) {
  const t = getDictionary(params.locale);
  const hu = params.locale === "hu";
  return <RegisterForm locale={params.locale} labels={{
    title: hu ? "Szolgáltatói partnerfiók létrehozása" : "Create a provider partner account", name: t.auth.name, email: t.auth.email,
    password: t.auth.password, submit: hu ? "Partnerfiók létrehozása" : "Create partner account",
    sent: hu ? "Elküldtük a megerősítő emailt. A megerősítés és belépés után add meg céged adatait." : "We sent the confirmation email. After confirming and signing in, complete your company profile.", error: t.auth.sendFailed,
    rateLimited: t.auth.rateLimited, signIn: t.auth.signIn,
  }} />;
}
