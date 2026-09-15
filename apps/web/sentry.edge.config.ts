import * as Sentry from "@sentry/nextjs";

// Edge runtime can't use fs — use process.env with non-NEXT_PUBLIC fallback (available at runtime)
const SENTRY_DSN = process.env.NEXT_PUBLIC_VALIDBRIDGE_SENTRY_DSN || process.env.VALIDBRIDGE_SENTRY_DSN;
const VALIDBRIDGE_ENV = process.env.NEXT_PUBLIC_VALIDBRIDGE_ENV || process.env.VALIDBRIDGE_ENV || "dev";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: VALIDBRIDGE_ENV,
    sendDefaultPii: true,
    enableLogs: true,
    tracesSampleRate: VALIDBRIDGE_ENV === "dev" ? 1.0 : 0.1,
    beforeSend(event, hint) {
      const msg =
        (hint?.originalException as Error)?.message ??
        event?.exception?.values?.[0]?.value ??
        "";

      if (msg.includes("Failed to find Server Action")) return null;
      if (msg.includes("Organization not found")) return null;
      if (msg.includes("Organization has no config")) return null;

      return event;
    },
  });
}
