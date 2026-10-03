'use server';
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

export async function getOffers(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function createOffer(orgId: number, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function updateOffer(orgId: number, offerId: string, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function archiveOffer(orgId: number, offerId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getPublicOffer(orgId: number, offerId: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}/public`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

export async function getPublicOffers(orgId: number) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/public-listing`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

export async function getOffersByResource(orgId: number, resourceUuid: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/by-resource?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

// Provider-agnostic: the backend selects the correct payment provider
// based on the org's active PaymentsConfig.
export async function getOfferCheckoutSession(
  orgId: number,
  offerUuid: string,
  redirect_uri: string,
  access_token: string,
  amount?: number,
  method?: 'mobile_money' | 'card'
) {
  const params = new URLSearchParams({ redirect_uri })
  if (amount != null) params.set('amount', String(amount))
  if (method) params.set('method', method)
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerUuid)}/checkout?${params.toString()}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

// Buyer is back from Paystack: confirm the payment now instead of waiting
// for the webhook. Returns {success, data: {status}}.
export async function verifyOfferCheckout(orgId: number, reference: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/checkout/verify?reference=${encodeURIComponent(reference)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getUserEnrollments(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/enrollments/mine`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const metadata = await getResponseMetadata(result);
  if (!metadata.success) throw new Error(metadata.HTTPmessage || 'Failed to fetch enrollments')
  return metadata;
}

export async function cancelSubscription(orgId: number, offerId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/enrollments/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getBillingOverview(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/billing/overview`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const metadata = await getResponseMetadata(result);
  if (!metadata.success) throw new Error(metadata.HTTPmessage || 'Failed to fetch billing overview')
  return metadata;
}

export async function getBillingInvoices(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/billing/invoices`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const metadata = await getResponseMetadata(result);
  if (!metadata.success) throw new Error(metadata.HTTPmessage || 'Failed to fetch billing invoices')
  return metadata;
}
