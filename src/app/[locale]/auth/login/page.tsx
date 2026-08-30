import { getDictionary, type Locale } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default function LoginPage({ params, searchParams }: { params: { locale: Locale }; searchParams: { next?: string } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  return (
    <LoginForm
      locale={locale}
      next={typeof searchParams.next === "string" && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : undefined}
      labels={{
        title: t.auth.signIn,
        email: t.auth.email,
        password: t.auth.password,
        submit: t.auth.signIn,
        rateLimited: t.auth.rateLimited,
        invalidCredentials: locale === "hu" ? "Hibás email-cím vagy jelszó." : "Incorrect email or password.",
      }}
    />
  );
}
