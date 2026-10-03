'use server';
// Generic payment configuration service.
// Provider-specific connection logic lives in services/payments/providers/<provider>.ts
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

export async function getPaymentConfigs(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

export async function initializePaymentConfig(
  orgId: number,
  data: any,
  provider: string,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config?provider=${encodeURIComponent(provider)}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

// Connect the org's OWN Paystack account. Returns {success, data} instead of
// throwing so the page can show Paystack's reason (bad key, test/live mix).
export async function connectOwnPaystack(
  orgId: number,
  data: { secret_key: string; public_key?: string },
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config?provider=paystack`,
    RequestBodyWithAuthHeader('POST', { ...data, active: true }, null, access_token)
  );
  return getResponseMetadata(result);
}

// "Get paid to your bank" — banks, payout currency and ValidBridge's fee.
export async function getPayoutOptions(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config/payout-options`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

// Has Paystack verified the payout account yet? {verified, active}
export async function getPayoutStatus(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config/payout-status`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function setupManagedPayouts(
  orgId: number,
  data: {
    business_name: string;
    bank_code: string;
    account_number: string;
    contact_email?: string;
    contact_phone?: string;
  },
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config/managed`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function deletePaymentConfig(orgId: number, id: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/config?id=${encodeURIComponent(id)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

export async function getOrgCustomers(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/customers`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}
