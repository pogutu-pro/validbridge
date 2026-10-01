'use client';
import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useVBSession } from '@components/Contexts/VBSessionContext';
import {
  getPaymentConfigs,
  initializePaymentConfig,
  deletePaymentConfig,
} from '@services/payments/payments';
import {
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Trash2,
  UnplugIcon,
  XCircle,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';

// ---------------------------------------------------------------------------
// Page — Paystack (bring-your-own-keys) configuration.
//
// Each organization connects its OWN Paystack merchant account. There is no
// OAuth/Connect flow: the org admin pastes their secret key here, it is stored
// on the org's PaymentsConfig row, and funds settle directly to the org.
// ---------------------------------------------------------------------------
const PROVIDER = {
  id: 'paystack',
  name: 'Paystack',
  tagline: 'Accept one-time payments (cards, bank, M-Pesa) via your own Paystack account.',
  docsUrl: 'https://paystack.com/docs',
};

const PaymentsConfigurationPage: React.FC = () => {
  const org = useOrg() as any;
  const session = useVBSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient();

  const { data: paymentConfigs, error, isLoading } = useQuery({
    queryKey: queryKeys.payments.configs(org?.id),
    queryFn: () => getPaymentConfigs(org.id, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="ms-10 me-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4 animate-pulse">
      <div className="h-14 bg-gray-100 rounded-md mb-4" />
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gray-200 rounded-lg" />
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-28" />
                <div className="h-3 bg-gray-100 rounded w-48" />
              </div>
            </div>
            <div className="h-8 bg-gray-200 rounded w-24" />
          </div>
        ))}
      </div>
    </div>
  );
  if (error) return <div className="p-6 text-sm text-red-500">Error loading payment configuration</div>;

  const configs: any[] = Array.isArray(paymentConfigs) ? paymentConfigs : [];
  const config = configs.find((c: any) => c.provider === PROVIDER.id);
  const isConnected = !!(config && config.active);

  return (
    <div className="ms-10 me-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-4">
        <h1 className="font-bold text-xl text-gray-800">Payments Configuration</h1>
        <h2 className="text-gray-500 text-sm">
          Connect your Paystack account to accept payments from your learners.
        </h2>
      </div>

      <div className="space-y-3">
        <ProviderCard
          config={config}
          isConnected={isConnected}
          orgId={org.id}
          accessToken={access_token}
          onChanged={() => queryClient.invalidateQueries({ queryKey: queryKeys.payments.configs(org.id) })}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Provider card + key form
// ---------------------------------------------------------------------------
const ProviderCard: React.FC<{
  config: any | undefined;
  isConnected: boolean;
  orgId: number;
  accessToken: string;
  onChanged: () => void;
}> = ({ config, isConnected, orgId, accessToken, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!secretKey.trim()) {
      toast.error('Secret key is required');
      return;
    }
    setSaving(true);
    try {
      await initializePaymentConfig(
        orgId,
        { secret_key: secretKey.trim(), public_key: publicKey.trim(), active: true },
        PROVIDER.id,
        accessToken,
      );
      toast.success('Paystack connected');
      setEditing(false);
      onChanged();
    } catch {
      toast.error('Failed to save Paystack keys');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deletePaymentConfig(orgId, config.id, accessToken);
      toast.success('Paystack connection removed');
      setSecretKey('');
      setPublicKey('');
      onChanged();
    } catch {
      toast.error('Failed to remove Paystack connection');
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-white">
        <div className="flex items-center space-x-4">
          <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg shrink-0">
            <Wallet size={22} className="text-gray-700" />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="font-semibold text-gray-900">{PROVIDER.name}</span>
              {isConnected ? (
                <span className="inline-flex items-center space-x-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <CheckCircle2 size={10} />
                  <span>Connected</span>
                </span>
              ) : config ? (
                <span className="inline-flex items-center space-x-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <XCircle size={10} />
                  <span>Not active</span>
                </span>
              ) : (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  Not configured
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{PROVIDER.tagline}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <a
            href={PROVIDER.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 transition p-1"
            title={`${PROVIDER.name} docs`}
          >
            <ExternalLink size={15} />
          </a>

          {isConnected ? (
            <>
              <Button onClick={() => setEditing((v) => !v)} variant="outline" size="sm" className="text-xs">
                {editing ? 'Cancel' : 'Update keys'}
              </Button>
              <ConfirmationModal
                confirmationButtonText="Remove"
                confirmationMessage="Remove the Paystack connection? This will disable payments for this organization."
                dialogTitle="Remove Paystack Connection"
                dialogTrigger={
                  <Button variant="destructive" size="sm" className="text-xs">
                    <Trash2 size={12} className="me-1" />
                    Remove
                  </Button>
                }
                functionToExecute={handleDelete}
                status="warning"
              />
            </>
          ) : (
            <Button onClick={() => setEditing(true)} size="sm" className="text-xs bg-gray-900 text-white hover:bg-gray-800">
              <UnplugIcon size={12} className="me-1" />
              Connect
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Paste your Paystack keys from the Paystack Dashboard (Settings → API Keys &amp; Webhooks).
            Your secret key is stored on your organization&apos;s configuration.
          </p>
          <div className="space-y-2">
            <Label htmlFor="paystack-secret" className="text-xs">Secret key</Label>
            <Input
              id="paystack-secret"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="sk_live_… / sk_test_…"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paystack-public" className="text-xs">Public key (optional)</Label>
            <Input
              id="paystack-public"
              type="text"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="pk_live_… / pk_test_…"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Info size={12} />
            <span>Set your webhook URL in Paystack to: <code className="font-mono">/api/v1/payments/paystack/webhook</code></span>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <><Loader2 size={12} className="animate-spin me-1" /> Saving…</> : 'Save & Activate'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentsConfigurationPage;
