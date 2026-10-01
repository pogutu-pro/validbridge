import type { HelpCategory, HelpContext } from './types'
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
  Code,
  CodeBlock,
} from './prose'
import { appHref } from './links'
import { SUPPORT_EMAIL } from './brand'

// Facts in these articles come from the Developers pages of the dashboard
// (components/Dashboard/Pages/Org/OrgEdit{APIAccess,Automations,Domains,SEO,SSO})
// and the API behind them. Keep them customer-facing: what to click, what to
// paste, what the school's IT team needs — never how the platform is hosted.

const devLink = (ctx: HelpContext, tab: string, label: string) => (
  <ProseLink href={appHref(ctx, `/dash/developers/${tab}`)}>{label}</ProseLink>
)

const WEBHOOK_VERIFY_PYTHON = `import hmac, hashlib

def is_from_validbridge(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")`

const WEBHOOK_VERIFY_NODE = `const crypto = require('crypto')

function isFromValidBridge(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}`

const WEBHOOK_EXAMPLE = `{
  "event": "course_enrolled",
  "delivery_id": "dlv_3f9c1a7e5b2d4c80",
  "timestamp": "2026-09-24T08:15:02Z",
  "org_id": 42,
  "data": {
    "user": { "user_uuid": "user_…", "email": "amina@school.ac.ke", "username": "amina" },
    "course": { "course_uuid": "course_…", "name": "Form 3 Chemistry" }
  }
}`

export const integrations: HelpCategory = {
  id: 'integrations',
  title: 'Integrations & developer tools',
  icon: 'plug',
  description: 'Connect ValidBridge to your school systems: API tokens, webhooks, your own domain, single sign-on and SEO.',
  articles: [
    {
      id: 'api-access',
      title: 'API access & tokens',
      summary: 'Create, scope and revoke API tokens, authenticate requests, and use the API to sync students, enrolments and progress with your own systems.',
      audience: ['admins'],
      keywords: ['api', 'token', 'api key', 'bearer', 'authorization', 'rest', 'integration', 'sis', 'student information system', 'provision', 'enrol', 'enroll', 'rate limit', 'revoke', 'regenerate', 'playground'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            API tokens let your own software — a student information system, an admissions
            portal, a reporting script — work with your ValidBridge organization without a
            person signing in. Each token belongs to one organization.
          </P>
          <Callout kind="info" title="Who can use it">
            API access is available on the Pro plan and above. Creating and managing tokens
            needs the Admin role.
          </Callout>

          <H4>Create a token</H4>
          <Steps>
            <Step>
              In the dashboard, open <UI>Developers</UI> → <UI>API Access</UI> (
              {devLink(ctx, 'api', 'open API Access')}).
            </Step>
            <Step>On the <UI>API Tokens</UI> tab, click <UI>Create Token</UI>.</Step>
            <Step>
              Give it a <UI>Token Name</UI> that says what uses it (for example
              &ldquo;SIS nightly sync&rdquo;) and, optionally, a description.
            </Step>
            <Step>
              Optionally set an <UI>Expiration Date</UI>. Leave it empty for a token that
              never expires.
            </Step>
            <Step>Choose its <UI>Permissions</UI> (see below) and create it.</Step>
            <Step>
              Copy the token straight away and store it in your password manager or secrets
              store. <strong>It is shown only once.</strong> Tokens start with{' '}
              <Code>vb_</Code>.
            </Step>
          </Steps>

          <H4>Permissions</H4>
          <Defs>
            <Def term="Read Only">the token can read but not change anything. The safe default.</Def>
            <Def term="Full Access">create, read, update and delete on every resource.</Def>
            <Def term="Custom">
              tick create, read, update or delete per resource: courses, activities,
              assignments, chapters, folders, media, certifications, user groups and
              payments, plus search.
            </Def>
          </Defs>
          <P>
            Give each integration its own token with the narrowest permissions it needs,
            so you can revoke one without breaking the others.
          </P>

          <H4>Authenticate requests</H4>
          <P>
            Send the token in the <Code>Authorization</Code> header of every request, as a
            bearer token:
          </P>
          <CodeBlock>{'Authorization: Bearer vb_your_token_here'}</CodeBlock>
          <P>
            Requests and responses are JSON. The <UI>Documentation &amp; Playground</UI> tab
            on the same page lists every endpoint with its full address, parameters and
            example responses, lets you try calls with your token, and gives you a
            ready-to-copy <Code>curl</Code> command.
          </P>

          <H4>What you can do with it</H4>
          <P>
            The school-administration part of the API is built for syncing with your own
            systems. All of it is scoped to your organization&apos;s slug (the name in your
            ValidBridge address). The most useful calls:
          </P>
          <Table
            head={['Task', 'Request']}
            rows={[
              ['Create (provision) a student or staff account', <Code key="a">POST /admin/{'{org_slug}'}/users</Code>],
              ['Find a user by email', <Code key="b">GET /admin/{'{org_slug}'}/users/by-email/{'{email}'}</Code>],
              ['Enrol a user in a course', <Code key="c">POST /admin/{'{org_slug}'}/enrollments/{'{user_id}'}/{'{course_uuid}'}</Code>],
              ['Enrol many users at once', <Code key="d">POST /admin/{'{org_slug}'}/enrollments/bulk</Code>],
              ['Read a user’s progress in all courses', <Code key="e">GET /admin/{'{org_slug}'}/progress/{'{user_id}'}</Code>],
              ['List a user’s certificates', <Code key="f">GET /admin/{'{org_slug}'}/certifications/{'{user_id}'}</Code>],
              ['Add a user to a user group (class, stream)', <Code key="g">POST /admin/{'{org_slug}'}/usergroups/{'{usergroup_uuid}'}/members/{'{user_id}'}</Code>],
              ['Send a user a one-click sign-in link from your portal', <Code key="h">POST /admin/{'{org_slug}'}/auth/magic-link</Code>],
            ]}
          />
          <P>
            Paths are relative to the API address shown in the playground. The playground
            is the reference: it is always up to date with what your plan allows.
          </P>
          <Callout kind="info" title="Admin and staff accounts are protected">
            A token cannot sign in as, or issue sign-in links for, an organization Admin or
            Maintainer.
          </Callout>

          <H4>Limits</H4>
          <Bullets>
            <li>Creating or regenerating tokens: 10 per hour.</li>
            <li>Provisioning users: 30 per minute per token.</li>
            <li>Looking users up by email: 60 per minute per token.</li>
          </Bullets>
          <P>
            Over a limit, the API answers <Code>429 Too Many Requests</Code>. Wait and retry,
            and spread large imports out or use the bulk enrolment call.
          </P>

          <H4>Revoke or regenerate a token</H4>
          <P>
            The token list shows each token&apos;s prefix, status, when it was last used and
            when it expires. From a token&apos;s actions:
          </P>
          <Bullets>
            <li>
              <UI>Regenerate</UI> issues a new secret for the same token and settings. The
              old secret stops working immediately, so update your integration at once.
            </li>
            <li>
              <UI>Revoke</UI> switches the token off for good. Use it when an integration is
              retired or a token may have leaked.
            </li>
          </Bullets>
          <Callout kind="warn" title="Treat tokens like passwords">
            Never put a token in a web page, a mobile app, a shared spreadsheet or an email.
            Keep it on a server you control. A token that never expires is convenient but
            riskier — set an expiry and rotate it on a schedule if you can.
          </Callout>
        </div>
      ),
    },
    {
      id: 'webhooks',
      title: 'Automations & webhooks',
      summary: 'Send events such as enrolments, completions and grades to your systems, Zapier, Make or n8n, and verify each delivery with its signing secret.',
      audience: ['admins'],
      keywords: ['webhook', 'webhooks', 'automation', 'automations', 'zapier', 'make', 'make.com', 'n8n', 'events', 'signature', 'hmac', 'signing secret', 'integration', 'notify', 'retry'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            A webhook sends a message to an address you choose the moment something happens
            in your organization — a learner enrols, completes a course, submits an
            assignment or earns a certificate. Use it to update your own records or to start
            a workflow in Zapier, Make or n8n.
          </P>
          <Callout kind="info" title="Who can use it">
            Automations are available on the Pro plan and above, for admins.
          </Callout>

          <H4>Add an endpoint</H4>
          <Steps>
            <Step>
              Go to <UI>Developers</UI> → <UI>Automations</UI> (
              {devLink(ctx, 'automations', 'open Automations')}) and add an endpoint.
            </Step>
            <Step>
              Paste the <UI>Endpoint URL</UI> that should receive events. It must be a public{' '}
              <Code>https://</Code> address.
            </Step>
            <Step>Add a description so others know what it is for.</Step>
            <Step>
              Tick the events you want. Each event shows an example of the data it sends.
            </Step>
            <Step>
              Click <UI>Create Endpoint</UI> and copy the <UI>Signing Secret</UI>.{' '}
              <strong>It is shown only once.</strong>
            </Step>
            <Step>
              Use <UI>Send test event</UI> to send a <Code>ping</Code> and check it arrives.
            </Step>
          </Steps>

          <H4>Connect Zapier, Make or n8n</H4>
          <P>
            In your automation tool, start a workflow with its &ldquo;catch webhook&rdquo;
            trigger (in Zapier: <UI>Webhooks by Zapier</UI> → <UI>Catch Hook</UI>). Copy the
            address it gives you into the <UI>Endpoint URL</UI> above, send a test event, and
            build the rest of the workflow from the sample data.
          </P>

          <H4>Events you can subscribe to</H4>
          <Table
            head={['Group', 'Events']}
            rows={[
              ['Learning progress', 'Course enrolled, activity completed, course completed, assignment submitted, assignment graded, certificate claimed, certificate revoked'],
              ['Users & access', 'User signed up, email verified, role changed, invited, removed from the organization'],
              ['Courses & content', 'Course created, published or unpublished, deleted, announcement posted; contributors added or removed; folders and podcast episodes'],
              ['Community & collaboration', 'Discussions and comments, pins, locks and votes; new boards and playgrounds'],
              ['Groups & subscriptions', 'User groups created or deleted, members or courses added; subscription packs activated or cancelled'],
              ['Organization', 'Sign-up method, AI settings or payment settings changed'],
            ]}
          />
          <P>The endpoint page shows the exact event names and sample data for each one.</P>

          <H4>What a delivery looks like</H4>
          <P>
            Each event is an HTTP <Code>POST</Code> with a JSON body:
          </P>
          <CodeBlock title="Example body">{WEBHOOK_EXAMPLE}</CodeBlock>
          <Defs>
            <Def term={<Code>X-Webhook-Event</Code>}>the event name.</Def>
            <Def term={<Code>X-Webhook-Delivery</Code>}>
              a unique delivery id. Store it and ignore repeats, so a retried delivery is
              only processed once.
            </Def>
            <Def term={<Code>X-Webhook-Signature</Code>}>
              <Code>sha256=</Code> followed by an HMAC-SHA256 of the raw request body, made
              with your signing secret.
            </Def>
          </Defs>

          <H4>Verify the signature</H4>
          <P>
            Before trusting a delivery, recompute the signature from the <em>raw</em> body
            (before any JSON parsing) and compare it with the header. Reject anything that
            does not match.
          </P>
          <CodeBlock title="Python">{WEBHOOK_VERIFY_PYTHON}</CodeBlock>
          <CodeBlock title="Node.js">{WEBHOOK_VERIFY_NODE}</CodeBlock>

          <H4>Retries and delivery logs</H4>
          <Bullets>
            <li>Answer with any <Code>2xx</Code> status within 10 seconds to confirm receipt.</li>
            <li>
              Otherwise the delivery is retried, up to 3 attempts in total, a few seconds
              apart. Redirects are not followed.
            </li>
            <li>
              <UI>View delivery logs</UI> shows each attempt with its status code and the
              start of your response — the first place to look when something is missing.
              The most recent 200 attempts per endpoint are kept.
            </li>
          </Bullets>

          <H4>Manage endpoints</H4>
          <Bullets>
            <li>Edit the URL, description or events at any time.</li>
            <li>Disable an endpoint to pause deliveries without losing its settings.</li>
            <li>
              Regenerate the secret if it may have leaked. The old secret stops working
              immediately; update your receiver first.
            </li>
            <li>Delete an endpoint you no longer need.</li>
          </Bullets>
        </div>
      ),
    },
    {
      id: 'custom-domains',
      title: 'Use your own domain',
      summary: 'Serve your school’s ValidBridge site on an address like learn.school.ac.ke: add the domain, create two DNS records, verify, and HTTPS is set up automatically.',
      audience: ['admins'],
      keywords: ['custom domain', 'domain', 'subdomain', 'dns', 'cname', 'txt', 'verify', 'verification', 'ssl', 'https', 'certificate', 'white label', 'registrar', 'kenic'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            By default your organization lives at its ValidBridge address. With a custom
            domain, learners visit your own address instead — for example{' '}
            <Code>learn.school.ac.ke</Code> — with a secure HTTPS certificate issued for you.
          </P>
          <Callout kind="info" title="Who can use it">
            Custom domains are available on the Pro plan and above. You need the Admin role
            in ValidBridge and access to your domain&apos;s DNS settings (often held by your
            IT team or web host).
          </Callout>

          <H4>Pick the right address</H4>
          <P>
            Use a <strong>subdomain</strong> such as <Code>learn.school.ac.ke</Code> or{' '}
            <Code>portal.academy.co.ke</Code>. Your main website (<Code>school.ac.ke</Code>)
            usually cannot take the CNAME record this needs, and pointing it at ValidBridge
            would replace your existing site.
          </P>

          <H4>1. Add the domain</H4>
          <Steps>
            <Step>
              Go to <UI>Developers</UI> → <UI>Domains</UI> (
              {devLink(ctx, 'domains', 'open Domains')}) and click <UI>Add Domain</UI>.
            </Step>
            <Step>Type the full address, e.g. <Code>learn.school.ac.ke</Code>, and add it.</Step>
            <Step>
              The domain appears as <UI>Pending</UI>, and ValidBridge shows the two DNS
              records to create.
            </Step>
          </Steps>

          <H4>2. Create the DNS records</H4>
          <P>
            At your domain registrar or DNS host (KENIC reseller, Cloudflare, GoDaddy,
            Namecheap…), create both records exactly as shown on the page:
          </P>
          <Table
            head={['Type', 'Name / host', 'Value', 'Purpose']}
            rows={[
              [
                'TXT',
                <Code key="t">_validbridge-verification.learn</Code>,
                <span key="tv"><Code>validbridge-verify=…</Code> (your code)</span>,
                'Proves you own the domain',
              ],
              [
                'CNAME',
                <Code key="c">learn</Code>,
                'The target shown on the page',
                'Sends visitors to ValidBridge',
              ],
            ]}
          />
          <P>
            The example is for <Code>learn.school.ac.ke</Code>. The TXT record must end up at{' '}
            <Code>_validbridge-verification.learn.school.ac.ke</Code>. Most DNS hosts add your
            domain to the name automatically, so you type only the part before it
            (<Code>_validbridge-verification.learn</Code> and <Code>learn</Code>). If the page
            shows a longer name than your DNS host expects, keep only the part before your
            own domain.
          </P>
          <Callout kind="tip" title="Copy, don’t retype">
            Use the copy buttons on the Domains page. A single wrong character in the code or
            the CNAME target stops verification.
          </Callout>

          <H4>3. Verify</H4>
          <Steps>
            <Step>Wait for the records to take effect — often minutes, occasionally up to 48 hours.</Step>
            <Step>Click <UI>Verify</UI> next to the domain, then <UI>Verify DNS</UI>.</Step>
            <Step>When the TXT record is found, the domain changes to <UI>Verified</UI>.</Step>
          </Steps>

          <H4>4. HTTPS is set up for you</H4>
          <P>
            Once the domain is verified and the CNAME is in place, a certificate is issued
            automatically, usually within a few minutes. The <UI>SSL</UI> column updates on
            its own; you can also open the domain and click <UI>Check</UI>.
          </P>
          <Table
            head={['SSL badge', 'Meaning']}
            rows={[
              [<UI key="a">SSL Active</UI>, 'The certificate is live. Learners can use the address.'],
              [<UI key="p">Provisioning</UI>, 'The certificate is being issued. Give it a few minutes.'],
              [<UI key="i">Invalid</UI>, 'The certificate could not be issued — almost always because the CNAME is missing or points somewhere else. Fix it, then verify again.'],
              [<UI key="u">Unknown</UI>, 'The status could not be read right now. Check again shortly.'],
            ]}
          />

          <H4>Removing a domain</H4>
          <P>
            Click the delete (bin) icon next to the domain and confirm. The address stops
            serving your organization and its certificate is released. Then delete the TXT
            and CNAME records at your DNS host. Your ValidBridge address keeps working
            throughout.
          </P>

          <H4>Troubleshooting</H4>
          <Faq q="“TXT record not found”">
            The record is missing, has not spread yet, or sits at the wrong name (often the
            domain was added twice, e.g. <Code>…learn.school.ac.ke.school.ac.ke</Code>). Check
            the name and wait a little before verifying again.
          </Faq>
          <Faq q="“TXT record found but value doesn’t match”">
            The value was mistyped or is from an earlier attempt. Copy it again from the
            Domains page.
          </Faq>
          <Faq q="Verified, but the certificate stays in Provisioning">
            Check that the CNAME exists and points to the exact target shown. If your DNS is
            on Cloudflare, set the record to <strong>DNS only</strong> (grey cloud) while
            the certificate is issued. Still stuck after an hour? Email{' '}
            <ProseLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ProseLink> with the
            domain name.
          </Faq>
        </div>
      ),
    },
    {
      id: 'single-sign-on',
      title: 'Single sign-on (SSO)',
      summary: 'Set up SSO so staff and students sign in with the school’s identity provider — Microsoft Entra ID, Google Workspace, Okta and others — through SAML or OpenID Connect.',
      audience: ['admins'],
      keywords: ['sso', 'single sign-on', 'saml', 'oidc', 'openid connect', 'workos', 'azure ad', 'entra', 'microsoft', 'google workspace', 'okta', 'keycloak', 'auth0', 'identity provider', 'idp', 'redirect uri', 'callback'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            With SSO, people sign in to ValidBridge with the account they already use at
            school, managed by your identity provider (IdP). There are two ways to connect:
          </P>
          <Defs>
            <Def term="SAML and managed connections (WorkOS)">
              the simplest route for Microsoft Entra ID (Azure AD), Google Workspace, Okta,
              Keycloak, Auth0 or any SAML provider. Your IT team completes a guided setup
              portal.
            </Def>
            <Def term="Custom OIDC">
              connect directly to any OpenID Connect provider using a client ID and secret
              from your IdP.
            </Def>
          </Defs>
          <Callout kind="info" title="Who can use it">
            SSO is an Enterprise plan feature and is set up by an organization admin under{' '}
            <UI>Developers</UI> → <UI>SSO</UI> ({devLink(ctx, 'sso', 'open SSO')}).
          </Callout>

          <H4>Option A — SAML via WorkOS</H4>
          <Steps>
            <Step>In <UI>SSO Provider</UI>, choose <UI>WorkOS</UI>.</Step>
            <Step>
              Enter your <UI>WorkOS Organization ID</UI> (it starts with <Code>org_</Code>).
              If you do not have one, email{' '}
              <ProseLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ProseLink> and we
              will set it up for your school.
            </Step>
            <Step>Click <UI>Save Configuration</UI>.</Step>
            <Step>
              Click <UI>Configure Identity Provider</UI>. The setup portal opens and walks
              your IT team through connecting your IdP step by step — it shows the values to
              paste into Entra ID, Google or Okta.
            </Step>
            <Step>Finish the options below and switch on <UI>Enable SSO</UI>.</Step>
          </Steps>

          <H4>Option B — Custom OIDC</H4>
          <P>First, register ValidBridge as an application (web app) in your IdP:</P>
          <Bullets>
            <li>
              Set the <strong>redirect URI</strong> (also called callback URL). It ends in{' '}
              <Code>/api/v1/auth/sso/callback</Code>; email{' '}
              <ProseLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</ProseLink> to
              confirm the exact address for your organization, especially if you use your
              own domain.
            </li>
            <li>Allow the <Code>openid</Code>, <Code>email</Code> and <Code>profile</Code> scopes.</li>
            <li>Copy the application&apos;s client ID and create a client secret.</li>
          </Bullets>
          <P>Then, in ValidBridge:</P>
          <Steps>
            <Step>In <UI>SSO Provider</UI>, choose <UI>Custom OIDC</UI>.</Step>
            <Step>
              <UI>Issuer URL</UI>: your IdP&apos;s issuer, e.g.{' '}
              <Code>https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</Code> or{' '}
              <Code>https://accounts.google.com</Code>. Sign-in endpoints are discovered from
              it automatically.
            </Step>
            <Step>Paste the <UI>Client ID</UI> and <UI>Client Secret</UI>.</Step>
            <Step>
              Leave <UI>Scopes</UI> as <Code>openid email profile</Code> unless your IdP
              needs more (space-separated).
            </Step>
            <Step>Finish the options below and click <UI>Save Configuration</UI>.</Step>
          </Steps>

          <H4>Options for both</H4>
          <Defs>
            <Def term="Allowed Email Domains">
              a comma-separated list such as <Code>school.ac.ke, students.school.ac.ke</Code>.
              Only these addresses can sign in with SSO. Leave it empty to allow any.
            </Def>
            <Def term="Auto-provision Users">
              create an account automatically the first time someone signs in with SSO.
              When it is off, only people who already have an account (matched by email) can
              use SSO.
            </Def>
            <Def term="Enable SSO">shows the SSO button on your sign-in page.</Def>
          </Defs>
          <P>
            SSO must also be allowed under <UI>Users</UI> → <UI>Sign-in Methods</UI> — see{' '}
            <HelpLink ctx={ctx} to="students/managing-users">Add and manage users</HelpLink>.
          </P>

          <H4>What people see</H4>
          <Steps>
            <Step>On your organization&apos;s sign-in page they click <UI>Sign in with SSO</UI>.</Step>
            <Step>They sign in at your identity provider as usual.</Step>
            <Step>
              They come back to ValidBridge, see <UI>Authenticating…</UI>, and land signed in.
              Existing accounts are matched by email address.
            </Step>
          </Steps>
          <P>
            If your organization requires two-factor authentication, it still applies after
            SSO.
          </P>

          <H4>Troubleshooting</H4>
          <Faq q="The SSO button does not appear">
            Check that <UI>Enable SSO</UI> is on, the configuration is saved, and SSO is
            allowed under <UI>Sign-in Methods</UI>.
          </Faq>
          <Faq q="“Your email domain is not allowed for this organization”">
            The person&apos;s address is not in <UI>Allowed Email Domains</UI>. Add the
            domain or have them use their school address.
          </Faq>
          <Faq q="Sign-in fails for someone new">
            <UI>Auto-provision Users</UI> is off and they have no account yet. Invite them
            first, or turn auto-provisioning on.
          </Faq>
          <Faq q="“Failed to authenticate with the identity provider”">
            Usually a wrong client secret, an expired secret, or a redirect URI that does not
            match. Check them in your IdP and in ValidBridge.
          </Faq>
          <Callout kind="warn" title="Keep a way back in">
            Before relying on SSO alone, make sure at least one admin can still sign in
            another way, in case the identity provider is unavailable. Treat the client
            secret like a password.
          </Callout>
        </div>
      ),
    },
    {
      id: 'seo',
      title: 'SEO for your school site',
      summary: 'Control how your organization appears in Google and when shared: page titles, descriptions, sharing image, Search Console verification and indexing.',
      audience: ['admins'],
      keywords: ['seo', 'search engine', 'google', 'search console', 'sitemap', 'robots', 'meta', 'description', 'open graph', 'og image', 'social sharing', 'twitter', 'index', 'noindex'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Go to <UI>Developers</UI> → <UI>SEO</UI> ({devLink(ctx, 'seo', 'open SEO')}).
            SEO settings are available on the Standard plan and above.
          </P>
          <Table
            head={['Setting', 'What it does']}
            rows={[
              ['Title Suffix', 'Added to every page title, e.g. “ | Riverside Academy”.'],
              ['Default Description', 'Used in search results for pages that have no description of their own.'],
              ['Default OG Image', 'The picture shown when a link is shared on WhatsApp, Facebook or X. Use 1200 × 630 pixels.'],
              ['Twitter Handle', 'Your account, shown on X (Twitter) link cards.'],
              ['Google Search Console', 'Paste the verification code from Search Console to prove you own the site.'],
              ['Hide Connect', 'Keep community pages out of search results.'],
            ]}
          />
          <P>
            Under <UI>Quick Links</UI> you will find your <strong>sitemap</strong> and{' '}
            <strong>robots.txt</strong> addresses. Submit the sitemap in Google Search
            Console so new courses are found faster.
          </P>
          <Callout kind="tip" title="Courses have their own SEO">
            Each course has an <UI>SEO</UI> tab for its own title, description and image —
            see{' '}
            <HelpLink ctx={ctx} to="courses/course-settings">Course settings</HelpLink>.
          </Callout>
          <P>
            Using your own address? Set it up first (
            <HelpLink ctx={ctx} to="integrations/custom-domains">Use your own domain</HelpLink>
            ) so search engines index the address you want people to remember.
          </P>
        </div>
      ),
    },
  ],
}
