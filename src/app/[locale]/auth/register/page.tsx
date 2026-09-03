import { getDictionary, type Locale } from "@/lib/i18n";
import { RegisterForm } from "./RegisterForm";

export default async function RegisterPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const t = getDictionary(params.locale);
  const hu = params.locale === "hu";
  return <RegisterForm locale={params.locale} labels={{
    title: hu ? "Szolgáltatói partnerfiók létrehozása" : "Create a provider partner account",
    name: t.auth.name, email: t.auth.email, password: t.auth.password,
    submit: hu ? "Partnerfiók létrehozása" : "Create partner account",
    sent: hu ? "A megerősítő emailt sikeresen elküldtük. Ellenőrizd a beérkező leveleket és a spam mappát is. A megerősítés és belépés után add meg céged adatait." : "The confirmation email was sent successfully. Check your inbox and spam folder. After confirming and signing in, complete your company profile.",
    error: hu ? "A regisztráció nem sikerült, ezért megerősítő emailt sem küldtünk. Kérjük, próbáld újra." : "Registration failed, so no confirmation email was sent. Please try again.",
    rateLimited: t.auth.rateLimited,
    signIn: t.auth.signIn,
    weakPassword: hu ? "Ez a jelszó túl könnyen kitalálható. Válassz erősebb, egyedi jelszót (legalább 8 karakter, kis- és nagybetű, szám ajánlott)." : "This password is too easy to guess. Please choose a stronger, unique password (at least 8 characters; upper/lowercase letters and numbers recommended).",
    accountExists: hu ? "Ehhez az email-címhez már tartozhat fiók. Próbálj meg bejelentkezni." : "An account may already exist for this email address. Please try signing in.",
    passwordHelp: hu ? "Legalább 8 karakter. Ne használj könnyen kitalálható jelszót (pl. Password123)." : "At least 8 characters. Avoid common or easily guessed passwords (for example Password123).",
  }} />;
}
