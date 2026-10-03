// hooks/usePaymentsEnabled.ts
import { useOrg } from '@components/Contexts/OrgContext';
import { useVBSession } from '@components/Contexts/VBSessionContext';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getPaymentConfigs } from '@services/payments/payments';

export function usePaymentsEnabled() {
  const org = useOrg() as any;
  const session = useVBSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  const { data: paymentConfigs, error, isLoading } = useQuery({
    queryKey: queryKeys.payments.configs(org?.id),
    queryFn: () => getPaymentConfigs(org.id, access_token),
    enabled: !!org && !!access_token,
    staleTime: 60_000,
  });

  // True if any payment provider is active — not tied to a specific provider
  const isAnyProviderActive = paymentConfigs?.some((config: any) => config.active);

  // 'managed' = paid to a bank via a ValidBridge subaccount (no Paystack login)
  const activeConfig = paymentConfigs?.find?.((config: any) => config.active);
  const mode: 'managed' | 'byok' | null = activeConfig ? (activeConfig.mode ?? 'byok') : null;

  return {
    isEnabled: !!isAnyProviderActive,
    mode,
    isLoading,
    error
  };
}