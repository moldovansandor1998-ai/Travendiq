import { getDictionary, type Locale } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default function LoginPage({ params }: { params: { locale: Locale } }) {
  const { locale } = params;
  const t = getDictionary(locale);
  return (
    <LoginForm
      locale={locale}
      labels={{
        title: t.auth.signIn,
        email: t.auth.email,
        submit: t.auth.magicLink,
        sent: t.auth.checkEmailLogin,
        rateLimited: t.auth.rateLimited,
        sendFailed: t.auth.sendFailed,
      }}
    />
  );
}
