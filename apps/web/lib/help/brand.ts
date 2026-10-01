/**
 * Product facts shared by the Help Center pages and articles. Keep them here so
 * a change (a new support address, a different payment provider) is one edit.
 */

export const PRODUCT_NAME = 'ValidBridge'

/** The company that builds and operates ValidBridge. */
export const COMPANY = {
  name: 'Stratnovo Systems',
  url: 'https://stratnovo.co.ke',
  domain: 'stratnovo.co.ke',
} as const


/** Same fallback the in-app error screens use for "Contact support". */
export const SUPPORT_EMAIL = 'support@validbridge.co.ke'

/**
 * The payment provider organizations connect to sell courses. Each
 * organization brings its own merchant account (API keys) — see
 * components/Dashboard/Pages/Payments/PaymentsConfigurationPage.tsx.
 */
export const PAYMENT_PROVIDER = {
  name: 'Paystack',
  dashboardUrl: 'https://dashboard.paystack.com',
  docsUrl: 'https://paystack.com/docs',
  keysLocation: 'Settings → API Keys & Webhooks',
  webhookPath: '/api/v1/payments/paystack/webhook',
} as const
