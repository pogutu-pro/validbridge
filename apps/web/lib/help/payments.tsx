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
  description: `Sell courses and get paid to your bank — no ${PROVIDER} account needed — or connect your own. Create offers and bundles, and see who has paid.`,
  articles: [
    {
      id: 'payments-overview',
      title: 'How payments work',
      summary: `Learners pay through ${PROVIDER}. Get paid straight to your bank with just your bank details, or connect your own ${PROVIDER} account.`,
      audience: ['admins'],
      keywords: ['payments', 'sell', 'monetize', 'byok', 'bring your own key', 'merchant', 'paystack', 'mpesa', 'm-pesa', 'bank', 'payout'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Payments in ValidBridge run on <strong>{PROVIDER}</strong>. Learners pay on{' '}
            {PROVIDER}&apos;s secure checkout page. You choose how you get paid:
          </P>
          <Bullets>
            <li>
              <strong>Get paid to M-PESA or your bank</strong> (recommended) — no {PROVIDER}{' '}
              account needed. Enter your M-PESA, till, Airtel Money or bank details once and{' '}
              {PROVIDER} pays each sale straight to you.
            </li>
            <li>
              <strong>Use your own {PROVIDER} account</strong> — if you already have one,
              connect it with your API keys and the money settles into it.
            </li>
          </Bullets>
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
              ['Configuration', `Choose how you get paid: your bank details, or your own ${PROVIDER} keys.`],
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
      title: 'Set up how you get paid',
      summary: `Get paid to M-PESA, a till, Airtel Money or a bank (no ${PROVIDER} account needed), or connect your own ${PROVIDER} account.`,
      audience: ['admins'],
      keywords: ['connect', 'bank', 'bank details', 'payout', 'account number', 'mpesa', 'm-pesa', 'till', 'airtel', 'verify', 'verification', 'api key', 'secret key', 'public key', 'webhook', 'configuration', 'setup', 'test mode', 'live mode'],
      content: () => (
        <div className="space-y-4">
          <P>
            Go to <UI>Payments</UI> → <UI>Configuration</UI> (you need the Admin role) and
            pick one of the two options.
          </P>
          <H4>Option A: Get paid to M-PESA or your bank</H4>
          <P>The quickest way. You do not need a {PROVIDER} account.</P>
          <Steps>
            <Step>Click <UI>Get paid to M-PESA or your bank</UI>.</Step>
            <Step>
              Choose how you are paid: <UI>M-PESA</UI> (a phone number), <UI>M-PESA Till</UI>{' '}
              (a Buy Goods till number), <UI>Bank account</UI> or <UI>Airtel Money</UI>.
            </Step>
            <Step>Enter the number and the name on the account, then click <UI>Continue</UI>.</Step>
            <Step>
              Check the summary carefully and click <UI>Yes, start accepting payments</UI>.
            </Step>
          </Steps>
          <Callout kind="warn" title="Double-check the number">
            In Kenya, {PROVIDER} cannot look up the account holder&apos;s name, so a mistyped number
            would send your money to someone else. The summary step is there to catch this.
          </Callout>
          <H4>Verification before the first payout</H4>
          <P>
            You can start selling as soon as you save. Before the first payout, ValidBridge confirms
            your payout details; until then the page shows <UI>Verifying your payout details</UI> and
            your earnings are held safely. Once verified, each sale is paid out automatically,
            usually within one or two business days. If you change your payout details, they are
            verified again.
          </P>
          <P>
            ValidBridge takes 0% of your sales. {PROVIDER}&apos;s processing fee is added on top
            for the learner — they choose <UI>Pay with M-PESA</UI> or <UI>Pay with card</UI> and
            see the exact total — so you receive your full price. Subscriptions are paid by card.
            M-PESA Paybill numbers are not supported yet — use a till, phone or bank account.
          </P>
          <H4>Option B: Use your own {PROVIDER} account</H4>
          <Steps>
            <Step>
              In the {PROVIDER} Dashboard (
              <ProseLink href={PAYMENT_PROVIDER.dashboardUrl} external>
                dashboard.paystack.com
              </ProseLink>
              ), open <UI>{PAYMENT_PROVIDER.keysLocation}</UI> and copy your{' '}
              <strong>secret key</strong> (<code>sk_live_</code> or <code>sk_test_</code>)
              and, optionally, your <strong>public key</strong>.
            </Step>
            <Step>
              In ValidBridge, click <UI>I already have a {PROVIDER} account</UI>, paste the
              keys and click <UI>Connect</UI>. ValidBridge checks them with {PROVIDER}{' '}
              before saving, and tells you if a key is wrong or if you mixed test and live
              keys.
            </Step>
            <Step>
              In the same {PROVIDER} settings page, set the <strong>Webhook URL</strong> to
              your ValidBridge API address followed by{' '}
              <code>{PAYMENT_PROVIDER.webhookPath}</code>. ValidBridge uses it to hear about
              renewals, cancellations and refunds.
            </Step>
          </Steps>
          <P>
            Test with your <code>sk_test_</code> key and {PROVIDER}&apos;s test cards first,
            then click <UI>Update keys</UI> and switch to your live key (and the live webhook
            URL).
          </P>
          <H4>Switching or turning off</H4>
          <Bullets>
            <li>You can switch between the two options at any time from the same page.</li>
            <li>
              <UI>Turn off</UI> stops new sales. Learners who already paid keep their access.
            </li>
          </Bullets>
          <Callout kind="info" title="Your details are protected">
            Secret keys are encrypted before they are stored and are only used by the
            ValidBridge server. Only the last four digits of your bank account are kept on
            ValidBridge.
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
              Click the button for how you want to pay — for example <UI>Pay with M-PESA</UI>{' '}
              or <UI>Pay with card</UI> (subscriptions are paid by card). Each button shows the
              exact total, including the small payment processing fee for that method. For
              pay-what-you-want offers, enter an amount at or above the minimum first. Sign in if
              asked.
            </Step>
            <Step>
              You are taken to {PROVIDER}&apos;s secure checkout to complete the payment.
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
            You pay the organization that runs the course, through {PROVIDER}. For refunds
            or questions about a charge, contact that organization.
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
            If you use your own {PROVIDER} account, issue refunds from your {PROVIDER}{' '}
            Dashboard (use the <UI>{PROVIDER} Dashboard</UI> button on the Payments pages). If
            you get paid through ValidBridge, contact ValidBridge support to refund a sale.
            When {PROVIDER} reports the refund, ValidBridge marks the purchase{' '}
            <strong>refunded</strong> and removes the access it granted.
          </P>
          <H4>Payouts</H4>
          <P>
            If you get paid through ValidBridge (M-PESA, till, Airtel Money or bank), {PROVIDER}{' '}
            pays each sale into the account you entered — your full price, because learners pay
            the processing fee on top — once your payout details are verified. If you use your own{' '}
            {PROVIDER} account, the money settles into it on {PROVIDER}&apos;s schedule and
            fees.
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
            ValidBridge checks the payment with {PROVIDER} as soon as the learner returns
            from checkout, and again when {PROVIDER}&apos;s webhook arrives. If the learner
            closed the page early and you use your own {PROVIDER} account, check the webhook
            URL in your {PROVIDER} settings (see{' '}
            <HelpLink ctx={ctx} to="payments/connect-paystack">Set up how you get paid</HelpLink>
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
