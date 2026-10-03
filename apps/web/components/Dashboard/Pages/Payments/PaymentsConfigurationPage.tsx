'use client';
import React, { useMemo, useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useVBSession } from '@components/Contexts/VBSessionContext';
import {
  getPaymentConfigs,
  getPayoutOptions,
  getPayoutStatus,
  setupManagedPayouts,
  connectOwnPaystack,
  deletePaymentConfig,
} from '@services/payments/payments';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  FlaskConical,
  Info,
  KeyRound,
  Landmark,
  Loader2,
  Search,
  Smartphone,
  Store,
  Trash2,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';

// ---------------------------------------------------------------------------
// Page — how this school gets paid. Two ways:
//
//  * "managed" (default): no Paystack account needed. The admin picks M-PESA,
//    a till, a bank or Airtel Money; ValidBridge creates a Paystack subaccount
//    for it and Paystack pays the school directly after each sale.
//  * "byok": a school that already has Paystack pastes its own keys.
// ---------------------------------------------------------------------------

type Destination = { code: string; name: string; type: string; kind: 'bank' | 'mobile' | 'till' };
type PayoutOptions = {
  available: boolean;
  currency: string;
  platform_fee_percent: number;
  fee_bearer: string;
  learner_pays_fees?: boolean;
  learner_fee_percent?: Record<string, number>;
  test_mode?: boolean;
  banks: Destination[];
};
type View = 'choose' | 'managed' | 'own';
// A tile in the method picker: a specific wallet/till code, or "any bank".
type Method = { id: string; label: string; hint: string; kind: Destination['kind']; code?: string };

function detailOf(res: any, fallback: string): string {
  const detail = res?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  return fallback;
}

function formatAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Group a Kenyan phone for reading back: 0712 345 678.
function prettyNumber(kind: Destination['kind'], value: string): string {
  const digits = value.replace(/\D/g, '');
  if (kind === 'mobile') {
    let local = digits.startsWith('254') ? digits.slice(3) : digits;
    if (!local.startsWith('0')) local = '0' + local;
    if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return value.trim();
}

// Mirrors the server's check so mistakes show before submitting.
function numberProblem(kind: Destination['kind'], value: string, currency: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!value.trim()) return null;
  if (kind === 'mobile' && currency === 'KES') {
    let local = digits.startsWith('254') ? digits.slice(3) : digits;
    if (local.startsWith('0')) local = local.slice(1);
    if (local.length !== 9 || !'17'.includes(local[0])) return 'Enter a Kenyan number like 0712 345 678.';
    return null;
  }
  if (kind === 'till') {
    if (!/^\d{5,8}$/.test(value.replace(/\s/g, ''))) return 'Till numbers are 5–8 digits.';
    return null;
  }
  if (value.replace(/[^A-Za-z0-9]/g, '').length < 6) return 'That account number looks too short.';
  return null;
}

function feeSentence(o: PayoutOptions): string {
  const paystackPart = o.learner_pays_fees
    ? "Learners pay Paystack's processing fee on top, so you receive your full price"
    : o.fee_bearer === 'subaccount'
      ? "Paystack's processing fee is deducted from each payout"
      : "ValidBridge covers Paystack's processing fee";
  if (!o.platform_fee_percent) return `0% ValidBridge fee. ${paystackPart}.`;
  return `ValidBridge keeps ${o.platform_fee_percent}% per sale. ${paystackPart}.`;
}

function buildMethods(destinations: Destination[]): Method[] {
  const methods: Method[] = [];
  const mpesa = destinations.find((d) => d.code === 'MPESA');
  const till = destinations.find((d) => d.kind === 'till');
  if (mpesa) methods.push({ id: 'MPESA', code: 'MPESA', kind: 'mobile', label: 'M-PESA', hint: 'To a phone number' });
  if (till) methods.push({ id: till.code, code: till.code, kind: 'till', label: 'M-PESA Till', hint: 'Buy Goods till number' });
  if (destinations.some((d) => d.kind === 'bank')) {
    methods.push({ id: 'bank', kind: 'bank', label: 'Bank account', hint: 'Any Kenyan bank' });
  }
  destinations
    .filter((d) => d.kind === 'mobile' && d.code !== 'MPESA')
    .forEach((d) => methods.push({ id: d.code, code: d.code, kind: 'mobile', label: d.name, hint: 'To a phone number' }));
  return methods;
}

const PaymentsConfigurationPage: React.FC = () => {
  const org = useOrg() as any;
  const session = useVBSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient();
  const [view, setView] = useState<View | null>(null);

  const { data: paymentConfigs, error, isLoading } = useQuery({
    queryKey: queryKeys.payments.configs(org?.id),
    queryFn: () => getPaymentConfigs(org.id, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  });

  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: [...queryKeys.payments.configs(org?.id), 'payout-options'],
    queryFn: async () => {
      const res = await getPayoutOptions(org.id, access_token);
      if (!res.success) throw new Error(detailOf(res, 'Could not load payout options'));
      return res.data as PayoutOptions;
    },
    enabled: !!(org?.id && access_token),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  if (isLoading) return (
    <div className="ms-10 me-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4 animate-pulse">
      <div className="h-14 bg-gray-100 rounded-md mb-4" />
      <div className="grid md:grid-cols-2 gap-3">
        {[1, 2].map((i) => <div key={i} className="h-44 border border-gray-200 rounded-xl" />)}
      </div>
    </div>
  );
  if (error) return <div className="p-6 text-sm text-red-500">Error loading payment configuration</div>;

  const configs: any[] = Array.isArray(paymentConfigs) ? paymentConfigs : [];
  const config = configs.find((c: any) => c.provider === 'paystack');
  const managedAvailable = !!options?.available;
  const onChanged = () => {
    setView(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.payments.configs(org.id) });
  };

  // Which screen: an explicit choice wins; otherwise the connected summary,
  // otherwise the chooser.
  const current: View | 'connected' = view ?? (config ? 'connected' : 'choose');
  const testMode = current === 'connected' ? config?.test_mode : options?.test_mode;

  return (
    <div className="ms-10 me-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-4">
        <h1 className="font-bold text-xl text-gray-800">Getting paid</h1>
        <h2 className="text-gray-500 text-sm">
          Learners pay by M-PESA or card. Choose where the money goes.
        </h2>
      </div>

      {testMode && current !== 'own' && (
        <div className="flex items-start gap-2 text-sm text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 mb-4">
          <FlaskConical size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong>Test mode.</strong> Payments here use Paystack test keys — no real money moves.
          </span>
        </div>
      )}

      {current === 'connected' && (
        <ConnectedSummary
          config={config}
          options={options}
          managedAvailable={managedAvailable}
          orgId={org.id}
          accessToken={access_token}
          onEdit={setView}
          onChanged={onChanged}
        />
      )}

      {current === 'choose' && (
        <Chooser options={options} optionsLoading={optionsLoading} onPick={setView} />
      )}

      {current === 'managed' && (
        <ManagedForm
          options={options}
          optionsLoading={optionsLoading}
          existing={config?.mode === 'managed' ? config.payout : null}
          orgId={org.id}
          accessToken={access_token}
          onBack={() => setView(null)}
          onSaved={onChanged}
        />
      )}

      {current === 'own' && (
        <OwnKeysForm
          orgId={org.id}
          accessToken={access_token}
          onBack={() => setView(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Chooser
// ---------------------------------------------------------------------------
const Chooser: React.FC<{
  options: PayoutOptions | undefined;
  optionsLoading: boolean;
  onPick: (_view: View) => void;
}> = ({ options, optionsLoading, onPick }) => {
  const managedAvailable = !!options?.available;
  return (
    <div className={`grid gap-3 ${managedAvailable || optionsLoading ? 'md:grid-cols-2' : ''}`}>
      {(managedAvailable || optionsLoading) && (
        <button
          type="button"
          onClick={() => onPick('managed')}
          disabled={optionsLoading}
          className="text-start border-2 border-gray-900 rounded-xl p-5 hover:bg-gray-50 transition disabled:opacity-60"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center justify-center w-10 h-10 bg-gray-900 text-white rounded-lg">
              <Smartphone size={20} />
            </div>
            <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
              Recommended
            </span>
          </div>
          <p className="font-semibold text-gray-900">Get paid to M-PESA or your bank</p>
          <p className="text-sm text-gray-500 mt-1">
            No Paystack account needed. Takes about a minute.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
            <Bullet>M-PESA, Till, Airtel Money or any Kenyan bank</Bullet>
            <Bullet>Paystack sends each sale straight to you</Bullet>
            {options && <Bullet>{feeSentence(options)}</Bullet>}
          </ul>
          <span className="inline-flex items-center mt-4 text-sm font-semibold text-gray-900">
            {optionsLoading ? <Loader2 size={14} className="animate-spin" /> : 'Set up payouts →'}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => onPick('own')}
        className="text-start border border-gray-200 rounded-xl p-5 hover:bg-gray-50 transition"
      >
        <div className="flex items-center justify-center w-10 h-10 bg-gray-100 text-gray-700 rounded-lg mb-3">
          <KeyRound size={20} />
        </div>
        <p className="font-semibold text-gray-900">I already have a Paystack account</p>
        <p className="text-sm text-gray-500 mt-1">
          Connect it with your API keys and Paystack pays you directly.
        </p>
        <span className="inline-flex items-center mt-4 text-sm font-semibold text-gray-700">
          Connect my Paystack →
        </span>
      </button>
    </div>
  );
};

const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex items-start gap-2">
    <Check size={14} className="text-green-600 mt-0.5 shrink-0" />
    <span>{children}</span>
  </li>
);

// ---------------------------------------------------------------------------
// Managed: method → details → confirm
// ---------------------------------------------------------------------------
const ManagedForm: React.FC<{
  options: PayoutOptions | undefined;
  optionsLoading: boolean;
  existing: any | null;
  orgId: number;
  accessToken: string;
  onBack: () => void;
  onSaved: () => void;
}> = ({ options, optionsLoading, existing, orgId, accessToken, onBack, onSaved }) => {
  const destinations = useMemo(() => options?.banks ?? [], [options]);
  const methods = useMemo(() => buildMethods(destinations), [destinations]);
  const currency = options?.currency ?? 'KES';

  // An explicit pick wins; otherwise the current payout method, otherwise the
  // first offered (M-PESA). Derived, so it is right once options load.
  const [pickedMethod, setMethodId] = useState<string>('');
  const existingMethod = existing ? (existing.kind === 'bank' ? 'bank' : existing.bank_code) : '';
  const methodId = pickedMethod
    || (methods.some((m) => m.id === existingMethod) ? existingMethod : methods[0]?.id ?? '');
  const [bankCode, setBankCode] = useState<string>(existing?.kind === 'bank' ? existing.bank_code : '');
  const [businessName, setBusinessName] = useState<string>(existing?.business_name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const method = methods.find((m) => m.id === methodId);
  const kind = method?.kind ?? 'bank';
  const code = kind === 'bank' ? bankCode : method?.code ?? '';
  const destinationName = destinations.find((d) => d.code === code)?.name ?? method?.label ?? '';
  const problem = numberProblem(kind, accountNumber, currency);
  const canContinue = businessName.trim().length >= 2 && !!code && !!accountNumber.trim() && !problem;

  const field = {
    mobile: { label: 'Phone number', placeholder: '0712 345 678', inputMode: 'tel' as const },
    till: { label: 'Till number', placeholder: 'e.g. 5123456', inputMode: 'numeric' as const },
    bank: { label: 'Account number', placeholder: 'e.g. 0123456789', inputMode: 'numeric' as const },
  }[kind];

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const res = await setupManagedPayouts(
        orgId,
        { business_name: businessName.trim(), bank_code: code, account_number: accountNumber.trim() },
        accessToken,
      );
      if (!res.success) {
        setConfirming(false);
        setFormError(detailOf(res, 'Could not save your payout details. Please check them and try again.'));
        return;
      }
      toast.success("You're ready to sell. Payouts start once your details are verified.");
      onSaved();
    } catch {
      setFormError('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (optionsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 size={14} className="animate-spin" /> Loading payout options…
      </div>
    );
  }
  if (!options?.available) {
    return (
      <div className="max-w-xl">
        <BackLink onClick={onBack} />
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          Getting paid through ValidBridge isn&apos;t available right now. You can connect your own Paystack account instead.
        </p>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="max-w-xl">
        <BackLink onClick={() => setConfirming(false)} label="Edit details" />
        <h3 className="font-semibold text-gray-900 text-lg">Is this correct?</h3>
        <p className="text-sm text-gray-500 mb-4">Your earnings will be sent here.</p>
        <div className="border border-gray-200 rounded-xl p-4 space-y-2 text-sm">
          <Row label="Paid to" value={destinationName} />
          <Row label={field.label} value={prettyNumber(kind, accountNumber)} mono />
          <Row label="Name" value={businessName.trim()} />
          <Row label="Currency" value={currency} />
        </div>
        <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg p-3 mt-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Check the number carefully. In Kenya, Paystack cannot look up the account holder&apos;s name,
            so a wrong number sends your money to someone else.
          </span>
        </p>
        {formError && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3 mt-3">{formError}</p>}
        <div className="flex gap-2 mt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin me-1.5" /> Saving…</> : 'Yes, start accepting payments'}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>Edit</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <BackLink onClick={onBack} />
      <h3 className="font-semibold text-gray-900 text-lg">Where should we send your money?</h3>
      <p className="text-sm text-gray-500 mb-5">Pick how your school is paid. You can change this later.</p>

      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Payout method">
          {methods.map((m) => {
            const active = m.id === methodId;
            const Icon = m.kind === 'bank' ? Landmark : m.kind === 'till' ? Store : Smartphone;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => { setMethodId(m.id); setAccountNumber(''); setFormError(null); }}
                className={`text-start rounded-lg border p-3 transition ${active ? 'border-gray-900 ring-1 ring-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <Icon size={16} className="text-gray-700 mb-1.5" />
                <p className="text-sm font-semibold text-gray-900 leading-tight">{m.label}</p>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{m.hint}</p>
              </button>
            );
          })}
        </div>

        {kind === 'bank' && (
          <div className="space-y-1.5">
            <Label className="text-sm">Bank</Label>
            <BankPicker banks={destinations.filter((d) => d.kind === 'bank')} value={bankCode} onChange={setBankCode} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="payout-account" className="text-sm">{field.label}</Label>
          <Input
            id="payout-account"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={existing?.account_last4 && existing.bank_code === code ? `Current: ••••${existing.account_last4}` : field.placeholder}
            inputMode={field.inputMode}
            autoComplete="off"
            maxLength={40}
            aria-invalid={!!problem}
          />
          {problem && <p className="text-xs text-red-600">{problem}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payout-name" className="text-sm">
            {kind === 'bank' ? 'Name on the account' : kind === 'till' ? 'Business name on the till' : 'Name on the M-PESA line'}
          </Label>
          <Input
            id="payout-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Sunrise Academy Ltd"
            maxLength={100}
          />
        </div>

        <FeeExample options={options} />

        {formError && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{formError}</p>}

        <Button onClick={() => setConfirming(true)} disabled={!canContinue} className="w-full sm:w-auto">
          Continue
        </Button>
      </div>
    </div>
  );
};

const FeeExample: React.FC<{ options: PayoutOptions }> = ({ options }) => {
  const sale = 1000;
  const ours = (sale * (options.platform_fee_percent || 0)) / 100;
  const rates = options.learner_fee_percent ?? {};
  return (
    <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
      <Info size={13} className="mt-0.5 shrink-0" />
      {options.learner_pays_fees ? (
        <span>
          On a {formatAmount(sale, options.currency)} course you receive{' '}
          {formatAmount(sale - ours, options.currency)}
          {ours > 0 ? ` (after ValidBridge's ${options.platform_fee_percent}%)` : ''}. Learners pay Paystack&apos;s fee
          on top{rates.mobile_money != null ? ` (${rates.mobile_money}% by M-PESA, ${rates.card}% by card)` : ''}. Paid out
          to you usually within 1–2 business days.
        </span>
      ) : (
        <span>
          On a {formatAmount(sale, options.currency)} sale
          {ours > 0 ? <>, ValidBridge keeps {formatAmount(ours, options.currency)}</> : null}
          {options.fee_bearer === 'subaccount' ? <> and Paystack&apos;s processing fee is deducted</> : null}
          ; the rest is paid to you, usually within 1–2 business days.
        </span>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-gray-500">{label}</span>
    <span className={`text-gray-900 font-medium text-end ${mono ? 'font-mono tracking-wide' : ''}`}>{value}</span>
  </div>
);

const BankPicker: React.FC<{ banks: Destination[]; value: string; onChange: (_code: string) => void }> = ({ banks, value, onChange }) => {
  const [query, setQuery] = useState('');
  const selected = banks.find((b) => b.code === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks;
  }, [banks, query]);
// Paystack lists banks by registered name ("Kenya Commercial Bank (Kenya)
// Ltd"); people search by the name they use ("KCB"). Common short and former
// names, keyed by Paystack's bank code.
const BANK_ALIASES: Record<string, string> = {
  '01': 'kcb',
  '03': 'barclays',
  '07': 'cba nic',
  '11': 'coop co-op',
  '31': 'cfc stanbic',
  '63': 'dtb',
  '68': 'equity',
};

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9&]/g, '');
// "Kenya Commercial Bank (Kenya) Ltd" -> "kcbkl", so "KCB" or "DTB" match.
const initials = (name: string) =>
  name.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean).map((w) => w[0]).join('');

function bankMatches(bank: Destination, query: string): boolean {
  const q = squash(query);
  if (!q) return true;
  const alias = BANK_ALIASES[bank.code] ?? '';
  return (
    squash(bank.name).includes(q) ||
    initials(bank.name).startsWith(q) ||
    alias.split(' ').some((a) => squash(a).startsWith(q))
  );
}

const BankPicker: React.FC<{ banks: Destination[]; value: string; onChange: (_code: string) => void }> = ({ banks, value, onChange }) => {
  const [query, setQuery] = useState('');
  const selected = banks.find((b) => b.code === value);
  const filtered = useMemo(() => banks.filter((b) => bankMatches(b, query)), [banks, query]);

  if (selected && !query) {
    return (
      <div className="flex items-center justify-between border border-gray-200 rounded-md px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-gray-900">
          <Building2 size={14} className="text-gray-500" /> {selected.name}
        </span>
        <button type="button" onClick={() => onChange('')} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 border-b border-gray-100">
        <Search size={14} className="text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your bank"
          aria-label="Search your bank"
          className="w-full py-2 text-sm outline-none bg-transparent"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto" role="listbox">
        {filtered.length === 0 && (
          <li className="px-3 py-3 text-sm text-gray-400">No bank matches “{query}”.</li>
        )}
        {filtered.map((b) => (
          <li key={b.code}>
            <button
              type="button"
              role="option"
              aria-selected={b.code === value}
              onClick={() => { onChange(b.code); setQuery(''); }}
              className="w-full px-3 py-2 text-sm text-start hover:bg-gray-50"
            >
              {b.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------------------
// BYOK: own Paystack keys
// ---------------------------------------------------------------------------
const OwnKeysForm: React.FC<{
  orgId: number;
  accessToken: string;
  onBack: () => void;
  onSaved: () => void;
}> = ({ orgId, accessToken, onBack, onSaved }) => {
  const [secretKey, setSecretKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const res = await connectOwnPaystack(
        orgId,
        { secret_key: secretKey.trim(), public_key: publicKey.trim() || undefined },
        accessToken,
      );
      if (!res.success) {
        setFormError(detailOf(res, 'Could not connect Paystack. Please check your keys.'));
        return;
      }
      toast.success('Paystack connected');
      onSaved();
    } catch {
      setFormError('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <BackLink onClick={onBack} />
      <h3 className="font-semibold text-gray-900 text-lg">Connect your Paystack account</h3>
      <p className="text-sm text-gray-500 mb-5">
        In Paystack, open Settings → API Keys &amp; Webhooks and copy your keys. We check them with Paystack before saving.
      </p>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="paystack-secret" className="text-sm">Secret key</Label>
          <Input
            id="paystack-secret"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="sk_live_…"
            autoComplete="off"
          />
          {secretKey.trim().startsWith('sk_test_') && (
            <p className="text-xs text-violet-700">This is a test key — no real money will move until you switch to your live key.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paystack-public" className="text-sm">Public key (optional)</Label>
          <Input
            id="paystack-public"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="pk_live_…"
            autoComplete="off"
          />
        </div>
        <p className="flex items-start gap-2 text-xs text-gray-500">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            Also set your Paystack webhook URL to{' '}
            <code className="font-mono">/api/v1/payments/paystack/webhook</code> on your ValidBridge address.
          </span>
        </p>
        {formError && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{formError}</p>}
        <Button onClick={handleSave} disabled={!secretKey.trim() || saving}>
          {saving ? <><Loader2 size={14} className="animate-spin me-1.5" /> Checking with Paystack…</> : 'Connect'}
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Connected summary
// ---------------------------------------------------------------------------
const ConnectedSummary: React.FC<{
  config: any;
  options: PayoutOptions | undefined;
  managedAvailable: boolean;
  orgId: number;
  accessToken: string;
  onEdit: (_view: View) => void;
  onChanged: () => void;
}> = ({ config, options, managedAvailable, orgId, accessToken, onEdit, onChanged }) => {
  const isManaged = config.mode === 'managed';
  const payout = config.payout || {};

  // Paystack holds payouts until ValidBridge verifies the details; ask only
  // while unverified (the server remembers once verified).
  const { data: status } = useQuery({
    queryKey: [...queryKeys.payments.configs(orgId), 'payout-status'],
    queryFn: async () => {
      const res = await getPayoutStatus(orgId, accessToken);
      return res.success ? (res.data as { verified: boolean; active: boolean | null }) : null;
    },
    enabled: isManaged && !payout.verified && !!accessToken,
    staleTime: 60_000,
  });
  const verified = !!(payout.verified || status?.verified);

  const handleDelete = async () => {
    try {
      await deletePaymentConfig(orgId, config.id, accessToken);
      toast.success('Payments turned off');
      onChanged();
    } catch {
      toast.error('Could not turn off payments');
    }
  };

  const MethodIcon = !isManaged ? KeyRound : payout.kind === 'bank' ? Landmark : payout.kind === 'till' ? Store : Smartphone;

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg shrink-0">
            <MethodIcon size={20} className="text-gray-700" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">
                {isManaged ? `Paid to ${payout.bank_name ?? 'your account'}` : 'Your own Paystack account'}
              </span>
              {config.active ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  <CheckCircle2 size={10} /> Accepting payments
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <XCircle size={10} /> Paused
                </span>
              )}
            </div>
            {isManaged ? (
              <p className="text-sm text-gray-600 mt-1">
                ••••{payout.account_last4}
                {payout.account_name ? ` · ${payout.account_name}` : payout.business_name ? ` · ${payout.business_name}` : ''}
              </p>
            ) : (
              <p className="text-sm text-gray-600 mt-1">Paystack pays you directly into the account linked to your keys.</p>
            )}
            {isManaged && options && (
              <p className="text-xs text-gray-400 mt-1">{feeSentence(options)}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => onEdit(isManaged ? 'managed' : 'own')}>
            {isManaged ? 'Change payout details' : 'Update keys'}
          </Button>
          <ConfirmationModal
            confirmationButtonText="Turn off"
            confirmationMessage="Turn off payments? Learners won't be able to buy until you set this up again. Existing purchases keep their access."
            dialogTitle="Turn off payments"
            dialogTrigger={
              <Button variant="destructive" size="sm" className="text-xs">
                <Trash2 size={12} className="me-1" /> Turn off
              </Button>
            }
            functionToExecute={handleDelete}
            status="warning"
          />
        </div>
      </div>

      {isManaged && (
        verified ? (
          <p className="flex items-center gap-2 text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2 mt-4">
            <CheckCircle2 size={14} /> Payout details verified — sales are paid out automatically.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mt-4">
            <Clock size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong>Verifying your payout details.</strong> You can sell right away; your earnings are held
              safely and paid out once ValidBridge confirms the details.
            </span>
          </p>
        )
      )}

      <div className="border-t border-gray-100 mt-4 pt-3 text-xs text-gray-500">
        {isManaged ? (
          <button type="button" className="hover:text-gray-800 underline-offset-2 hover:underline" onClick={() => onEdit('own')}>
            Have your own Paystack account? Connect it instead
          </button>
        ) : managedAvailable ? (
          <button type="button" className="hover:text-gray-800 underline-offset-2 hover:underline" onClick={() => onEdit('managed')}>
            Prefer not to manage Paystack? Get paid to M-PESA or your bank instead
          </button>
        ) : null}
      </div>
    </div>
  );
};

const BackLink: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Back' }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 mb-3">
    <ArrowLeft size={14} /> {label}
  </button>
);

export default PaymentsConfigurationPage;
