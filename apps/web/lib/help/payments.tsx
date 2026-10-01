import type { HelpCategory } from './types'
import {
  P,
  H4,
  UI,
  ProseLink,
  HelpLink,
  Callout,
  Steps,
  Step,
  Bullets,
  Defs,
  Def,
  Table,
  Faq,
} from './prose'
import { appHref } from './links'
import { PAYMENT_PROVIDER } from './brand'

const PROVIDER = PAYMENT_PROVIDER.name

export const payments: HelpCategory = {
  id: 'payments',
  title: `Payments (${PROVIDER})`,
  icon: 'card',
  description: `Sell courses with your own ${PROVIDER} account: connect your keys, create offers and bundles, and see who has paid.`,
  articles: [
    {
      id: 'payments-overview',
      title: 'How payments work',
      summary: `ValidBridge uses ${PROVIDER} with bring-your-own keys: your organization connects its own ${PROVIDER} account and learners' payments go straight to it.`,
      audience: ['admins'],
      keywords: ['payments', 'sell', 'monetize', 'byok', 'bring your own key', 'merchant', 'paystack', 'mpesa', 'm-pesa'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Payments in ValidBridge run on <strong>{PROVIDER}</strong> using a{' '}
            <strong>bring-your-own-key</strong> model. Each organization connects its{' '}
            <em>own</em> {PROVIDER} merchant account by pasting its API keys. Learners pay on{' '}
            {PROVIDER}&apos;s secure checkout page and the money settles directly into your{' '}
            {PROVIDER} account — ValidBridge never holds your funds.
          </P>
          <H4>The flow at a glance</H4>
          <Steps>
            <Step>
              An admin{' '}
              <HelpLink ctx={ctx} to="payments/connect-paystack">
                connects {PROVIDER}
              </HelpLink>{' '}
              under <UI>Payments</UI> → <UI>Configuration</UI>.
            </Step>
            <Step>
              You{' '}
              <HelpLink ctx={ctx} to="payments/create-offer">
                create offers
              </HelpLink>{' '}
              — a price (one-time or subscription) linked to courses or a{' '}
              <HelpLink ctx={ctx} to="payments/payment-groups">payment group</HelpLink>.
            </Step>
            <Step>
              A learner clicks <UI>Get access</UI> or <UI>Subscribe</UI> and pays on{' '}
              {PROVIDER}.
            </Step>
            <Step>
              {PROVIDER} notifies ValidBridge, which unlocks the courses for that learner
              immediately.
            </Step>
          </Steps>
          <H4>What learners can pay with</H4>
          <P>
            Whatever your {PROVIDER} account accepts — typically cards, bank payments and
            mobile money such as M-Pesa, depending on your country and {PROVIDER} settings.
          </P>
          <Table
            head={['Payments tab', 'What it is for']}
            rows={[
              ['Overview', 'Every customer, the offer they bought, amount, status and since when.'],
              ['Offers', 'The things you sell: price, type and the courses they unlock.'],
              ['Payment Groups', 'Bundles of courses sold together, optionally mirrored into a user group.'],
              ['Configuration', `Connect, update or remove your ${PROVIDER} keys.`],
            ]}
          />
          <Callout kind="info" title="Turn the feature on first">
            Payments must be enabled for your organization. If you do not see{' '}
            <UI>Payments</UI> in the dashboard, check the features in{' '}
            <UI>Organization</UI> settings or contact support.
          </Callout>
        </div>
      ),
    },
    {
      id: 'connect-paystack',
      title: `Connect your ${PROVIDER} account`,
      summary: `Paste your ${PROVIDER} secret key (and optional public key), activate it, and point ${PROVIDER}'s webhook at ValidBridge.`,
      audience: ['admins'],
      keywords: ['connect', 'api key', 'secret key', 'public key', 'webhook', 'configuration', 'setup', 'test mode', 'live mode'],
      content: () => (
        <div className="space-y-4">
          <H4>Before you start</H4>
          <Bullets>
            <li>
              A {PROVIDER} business account (create one at{' '}
              <ProseLink href={PAYMENT_PROVIDER.dashboardUrl} external>
                dashboard.paystack.com
              </ProseLink>
              ), activated for live payments when you are ready to charge real money.
            </li>
            <li>The Admin role in your ValidBridge organization.</li>
          </Bullets>
          <H4>1. Copy your keys from {PROVIDER}</H4>
          <P>
            In the {PROVIDER} Dashboard, open <UI>{PAYMENT_PROVIDER.keysLocation}</UI>. Copy
            the <strong>secret key</strong> (starts with <code>sk_live_</code> or{' '}
            <code>sk_test_</code>) and, optionally, the <strong>public key</strong> (
            <code>pk_live_</code> / <code>pk_test_</code>).
          </P>
          <H4>2. Paste them into ValidBridge</H4>
          <Steps>
            <Step>In the dashboard, go to <UI>Payments</UI> → <UI>Configuration</UI>.</Step>
            <Step>On the {PROVIDER} card, click <UI>Connect</UI>.</Step>
            <Step>Paste the <UI>Secret key</UI> and, if you like, the <UI>Public key</UI>.</Step>
            <Step>Click <UI>Save &amp; Activate</UI>. The card shows <UI>Connected</UI>.</Step>
          </Steps>
          <H4>3. Set the webhook URL in {PROVIDER}</H4>
          <P>
            This step is essential: ValidBridge unlocks a course when {PROVIDER} tells it a
            payment succeeded. In the same {PROVIDER} settings page, set the{' '}
            <strong>Webhook URL</strong> to your ValidBridge API address followed by{' '}
            <code>{PAYMENT_PROVIDER.webhookPath}</code> — the Configuration page shows the
            path. {PROVIDER} signs each notification with your secret key and ValidBridge
            rejects anything it cannot verify.
          </P>
          <Callout kind="warn" title="No webhook, no access">
            If the webhook is missing or wrong, learners are charged but their course stays
            locked. If you are not sure of your API address, contact support before going
            live.
          </Callout>
          <H4>Test first</H4>
          <P>
            Use your <code>sk_test_</code> key to try the whole flow with {PROVIDER}&apos;s
            test cards, then click <UI>Update keys</UI> and switch to your live key (and
            the live webhook URL) when you are ready.
          </P>
          <H4>Updating or removing keys</H4>
          <Bullets>
            <li><UI>Update keys</UI> replaces the stored keys, for example after rotating them in {PROVIDER}.</li>
            <li><UI>Remove</UI> disconnects {PROVIDER} and disables payments for the organization.</li>
          </Bullets>
          <Callout kind="info" title="Your keys are protected">
            The secret key is encrypted before it is stored, is only used by the ValidBridge
            server to talk to {PROVIDER}, and is never shown to learners.
          </Callout>
        </div>
      ),
    },
    {
      id: 'create-offer',
      title: 'Create an offer',
      summary: 'Set a one-time or subscription price (fixed or pay-what-you-want), choose the currency, and link the courses it unlocks.',
      audience: ['admins'],
      keywords: ['offer', 'price', 'pricing', 'product', 'subscription', 'one-time', 'currency', 'kes', 'pay what you want', 'storefront'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>An <strong>offer</strong> is something learners can buy.</P>
          <Steps>
            <Step>Open <UI>Payments</UI> → <UI>Offers</UI> and create a new offer.</Step>
            <Step>Enter an <UI>Offer Name</UI>, description and optional benefits (comma-separated).</Step>
            <Step>
              Choose the <UI>Offer Type</UI>: <strong>one-time</strong> or{' '}
              <strong>subscription</strong>. For subscriptions, pick a{' '}
              <UI>Billing Interval</UI> — monthly or yearly.
            </Step>
            <Step>
              Choose the <UI>Price Type</UI>: a <strong>fixed price</strong>, or{' '}
              <strong>customer&apos;s choice</strong> (pay what you want, with your amount as
              the minimum).
            </Step>
            <Step>
              Set the amount and <UI>Currency</UI> (KES by default). Use a currency your{' '}
              {PROVIDER} account supports.
            </Step>
            <Step>
              Under <UI>Access</UI>, add courses directly and/or link a{' '}
              <HelpLink ctx={ctx} to="payments/payment-groups">payment group</HelpLink>.
            </Step>
            <Step>Save. Public offers appear in your marketplace.</Step>
          </Steps>
          <Callout kind="info" title={`Subscriptions create a ${PROVIDER} plan`}>
            When you save a subscription offer, ValidBridge creates (or updates) the
            matching plan in your {PROVIDER} account automatically. Connect {PROVIDER}{' '}
            before creating subscription offers.
          </Callout>
          <P>
            Use <UI>Preview Shop</UI> at the top of the Payments pages to see your{' '}
            <ProseLink href={appHref(ctx, '/marketplace')}>marketplace</ProseLink>{' '}
            as learners do.
          </P>
        </div>
      ),
    },
    {
      id: 'payment-groups',
      title: 'Payment groups (bundles)',
      summary: 'Sell several courses together, and mirror buyers into a user group so they get access everywhere.',
      audience: ['admins'],
      keywords: ['bundle', 'group', 'package', 'program', 'sync', 'user group'],
      content: () => (
        <div className="space-y-4">
          <P>
            A <strong>payment group</strong> is a bundle of courses. Link an offer to a
            group and buying the offer unlocks every course in it — add a course to the
            group later and existing buyers get it too.
          </P>
          <Steps>
            <Step>Open <UI>Payments</UI> → <UI>Payment Groups</UI> and create a group with a name and description.</Step>
            <Step>Add the courses it contains.</Step>
            <Step>Link one or more offers to the group (in each offer&apos;s <UI>Access</UI> section).</Step>
            <Step>
              Optionally click <UI>Sync</UI> to mirror the group into a{' '}
              <strong>user group</strong>: buyers become members while their purchase is
              active and are removed if it is cancelled or refunded.
            </Step>
          </Steps>
          <Callout kind="tip" title="Why sync?">
            A synced user group lets paying learners reach everything the user group
            unlocks — course listings, communities and certificates — not just the
            paywalled pages.
          </Callout>
        </div>
      ),
    },
    {
      id: 'paying-for-a-course',
      title: 'Paying for a course (learners)',
      summary: `Buy a course or subscribe on ${PROVIDER}'s secure checkout, then find your purchases and payment history in your account.`,
      audience: ['learners'],
      keywords: ['buy', 'purchase', 'checkout', 'pay', 'card', 'mpesa', 'm-pesa', 'receipt', 'invoice', 'price'],
      content: (ctx) => (
        <div className="space-y-4">
          <Steps>
            <Step>
              Open the course, or the offer in the{' '}
              <ProseLink href={appHref(ctx, '/marketplace')}>marketplace</ProseLink>.
            </Step>
            <Step>
              Click <UI>Get access</UI> (one-time) or <UI>Subscribe</UI>. For
              pay-what-you-want offers, enter an amount at or above the minimum. Sign in if
              asked.
            </Step>
            <Step>
              You are taken to {PROVIDER}&apos;s secure checkout. Pay with any method it
              offers you.
            </Step>
            <Step>
              You return to ValidBridge and the course unlocks as soon as {PROVIDER}{' '}
              confirms the payment — usually within seconds.
            </Step>
          </Steps>
          <H4>Your purchases and receipts</H4>
          <Defs>
            <Def term="Account → Purchases">the courses and subscriptions you have bought.</Def>
            <Def term="Account → Billing">
              active subscriptions with the next payment date, and your payment history.
            </Def>
          </Defs>
          <Callout kind="info" title="Who you are paying">
            You pay the organization that runs the course, through its own {PROVIDER}{' '}
            account. For refunds or questions about a charge, contact that organization.
          </Callout>
        </div>
      ),
    },
    {
      id: 'subscriptions-and-refunds',
      title: 'Subscriptions, cancellations & refunds',
      summary: 'How subscriptions renew, what happens when a learner cancels or a payment fails, and how refunds work.',
      audience: ['admins', 'learners'],
      keywords: ['cancel', 'refund', 'renewal', 'failed payment', 'unsubscribe', 'chargeback', 'payout', 'settlement'],
      content: () => (
        <div className="space-y-4">
          <H4>Renewals</H4>
          <P>
            Subscriptions are billed by {PROVIDER} every month or year. Each successful
            renewal keeps access active; a failed renewal suspends access until a later
            payment succeeds.
          </P>
          <H4>Cancelling</H4>
          <P>
            Learners cancel from <UI>Account</UI> → <UI>Billing</UI> (click{' '}
            <UI>Cancel</UI> next to the subscription). Billing stops in {PROVIDER} and
            access ends <strong>immediately</strong> — there is no grace period.
          </P>
          <H4>Refunds</H4>
          <P>
            Refunds are issued from your {PROVIDER} Dashboard (use the{' '}
            <UI>{PROVIDER} Dashboard</UI> button on the Payments pages). When {PROVIDER}{' '}
            reports the refund, ValidBridge marks the purchase <strong>refunded</strong> and
            removes the access it granted.
          </P>
          <H4>Payouts</H4>
          <P>
            Money is settled by {PROVIDER} to the bank or mobile-money account set up in
            your {PROVIDER} account, on {PROVIDER}&apos;s schedule and fees. ValidBridge does
            not take a cut of or hold these payments.
          </P>
          <H4>Purchase statuses</H4>
          <Table
            head={['Status', 'Meaning']}
            rows={[
              ['Pending', 'Checkout started but not yet paid.'],
              ['Completed', 'One-time purchase paid — access granted.'],
              ['Active', 'Subscription paid and current — access granted.'],
              ['Cancelled', 'Subscription cancelled — access ended.'],
              ['Failed', 'A subscription payment failed — access suspended.'],
              ['Refunded', 'Payment refunded — access removed.'],
            ]}
          />
        </div>
      ),
    },
    {
      id: 'payments-faq',
      title: 'Payments troubleshooting',
      summary: 'Checkout unavailable, paid but still locked, subscription offer errors and other payment questions.',
      audience: ['admins', 'learners'],
      keywords: ['not working', 'locked', 'error', 'checkout', 'webhook', 'problem'],
      content: (ctx) => (
        <div className="space-y-3">
          <Faq q="Learners see no checkout button">
            Payments may be switched off for the organization, {PROVIDER} may not be
            connected, or the offer is not public. Check <UI>Payments</UI> →{' '}
            <UI>Configuration</UI> and the offer settings.
          </Faq>
          <Faq q="A learner paid but the course is still locked">
            ValidBridge unlocks the course when {PROVIDER}&apos;s webhook arrives. Check the
            webhook URL in your {PROVIDER} settings (see{' '}
            <HelpLink ctx={ctx} to="payments/connect-paystack">Connect {PROVIDER}</HelpLink>
            ) and that the key mode (test or live) matches. The purchase shows as{' '}
            <em>Pending</em> in <UI>Payments</UI> → <UI>Overview</UI> until it is confirmed.
          </Faq>
          <Faq q="“Cannot create a subscription without credentials configured”">
            Subscription offers need a {PROVIDER} plan, so connect {PROVIDER} before saving
            the offer.
          </Faq>
          <Faq q="“Amount must be at least …”">
            On a pay-what-you-want offer the amount entered is below the minimum price.
          </Faq>
        </div>
      ),
    },
  ],
}
