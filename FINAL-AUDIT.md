# Travendiq final audit

## PASS (static review)
- Shared Supabase-backed rate limiter is used on login, claim, booking creation/payment/manage, voucher, newsletter, check-in, provider booking, Connect onboarding and admin payouts.
- Added shared rate limiting to admin CSV export and provider CSV export in this final pass.
- Stripe secret is referenced server-side; no `NEXT_PUBLIC_STRIPE_SECRET_KEY` or public service-role secret pattern was found.
- Stripe integration tests explicitly reject live `sk_live_` keys.
- Migrations 00024, 00025 and 00026 are present for exact manual reversal amount validation, shared rate limiting, and legal approval gating.

## NOT TESTED / ENVIRONMENT LIMITED
- A clean `npm ci` was attempted but dependency download did not finish within the execution environment timeout. Consequently typecheck/lint/test/build could not be truthfully certified here. The initial commands failed because the partial install lacked binaries/type packages, not because a source diagnostic was established.
- Full Supabase migration chain was not applied to a live/ephemeral Supabase database here.
- Real Stripe test-mode integration, Connect onboarding, webhooks, disputes, refunds, transfers and reversals require configured external test credentials/services.
- Browser E2E requires a successfully installed dependency set and running application.

## EXTERNAL REQUIREMENTS
Configure Vercel/Supabase/Stripe/Resend environment variables from `.env.example`; apply migrations in order; use Stripe test mode before production; configure webhook/cron secrets and approved legal documents.

## RELEASE GATE
Before production, CI must successfully run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`, plus the integration/E2E suites with test credentials. Do not treat this static audit as a substitute for those checks.
