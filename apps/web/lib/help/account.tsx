import type { HelpCategory } from './types'
import { P, H4, UI, ProseLink, HelpLink, Callout, Steps, Step, Bullets, Defs, Def, Table } from './prose'
import { appHref } from './links'

export const account: HelpCategory = {
  id: 'account',
  title: 'Account & security',
  icon: 'shield',
  description: 'Your profile and account settings, sign-in options, passwords, two-factor authentication and account deletion.',
  articles: [
    {
      id: 'account-settings',
      title: 'Your account settings',
      summary: 'Where to change your details, profile, security settings, and see your purchases and billing.',
      audience: ['everyone'],
      keywords: ['profile', 'account', 'settings', 'name', 'avatar', 'photo', 'email', 'purchases', 'billing'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Open your avatar menu and choose <UI>Account settings</UI>, or go to{' '}
            <ProseLink href={appHref(ctx, '/account/general')}>your account</ProseLink>.
          </P>
          <Table
            head={['Tab', 'What you can do']}
            rows={[
              ['General', 'Your name, email and basic account details.'],
              ['Profile', 'Your public profile, such as your photo and bio.'],
              ['Security', 'Change your password, set up two-factor authentication, see your current session, or delete your account.'],
              ['Purchases', 'Courses and subscriptions you have bought.'],
              ['Billing', 'Active subscriptions, next payment dates and payment history.'],
            ]}
          />
          <P>
            Questions about a purchase? See{' '}
            <HelpLink ctx={ctx} to="payments/paying-for-a-course">Paying for a course</HelpLink>.
          </P>
        </div>
      ),
    },
    {
      id: 'sign-in-options',
      title: 'Signing in',
      summary: 'Email and password, Google, emailed sign-in links and single sign-on — plus resetting a forgotten password.',
      audience: ['everyone'],
      keywords: ['login', 'log in', 'sign in', 'forgot password', 'reset password', 'magic link', 'google', 'sso'],
      content: () => (
        <div className="space-y-4">
          <P>Depending on what your organization allows, the sign-in page offers:</P>
          <Defs>
            <Def term="Email and password">the default.</Def>
            <Def term="Google">sign in with your Google account.</Def>
            <Def term="Sign in with a link">we email you a secure one-time link. It expires shortly, so use it soon.</Def>
            <Def term="Single sign-on (SSO)">sign in through your organization&apos;s identity provider.</Def>
          </Defs>
          <H4>Forgot your password?</H4>
          <Steps>
            <Step>On the sign-in page, click <UI>Forgot password?</UI>.</Step>
            <Step>Enter your email and click <UI>Send Reset Link</UI>.</Step>
            <Step>Open the email and choose a new password.</Step>
          </Steps>
          <Callout kind="info" title="Verify your email">
            New accounts may need to confirm their email address before signing in. Check
            your inbox and spam folder for the verification message.
          </Callout>
        </div>
      ),
    },
    {
      id: 'two-factor',
      title: 'Two-factor authentication',
      summary: 'Protect your account with a one-time code from an authenticator app, and keep backup codes safe.',
      audience: ['everyone'],
      keywords: ['2fa', 'mfa', 'two factor', 'authenticator', 'otp', 'backup codes', 'security'],
      content: () => (
        <div className="space-y-4">
          <H4>Turn it on</H4>
          <Steps>
            <Step>Go to <UI>Account settings</UI> → <UI>Security</UI> and click <UI>Enable</UI> under Two-factor authentication.</Step>
            <Step>Confirm your password (skipped if you sign in only with Google or SSO).</Step>
            <Step>
              Scan the QR code with an authenticator app (1Password, Google Authenticator,
              Authy…), or enter the setup key by hand.
            </Step>
            <Step>Enter the 6-digit code from the app and click <UI>Verify and enable</UI>.</Step>
            <Step>
              Save your <strong>backup codes</strong> — copy or download them. They are
              shown only once, and each works once if you lose your phone.
            </Step>
          </Steps>
          <H4>Running low on backup codes?</H4>
          <P>Generate a new set from the Security tab so you do not get locked out.</P>
          <Callout kind="info" title="Required by your organization?">
            Admins can require two-factor for everyone (<UI>Users</UI> →{' '}
            <UI>Two-Factor Policy</UI>). If so, you will be asked to set it up before
            continuing.
          </Callout>
        </div>
      ),
    },
    {
      id: 'password-and-account',
      title: 'Change your password or delete your account',
      summary: 'Update your password, sign out of your session, or permanently delete your account.',
      audience: ['everyone'],
      keywords: ['change password', 'sign out', 'log out', 'delete account', 'close account', 'remove account'],
      content: () => (
        <div className="space-y-4">
          <H4>Change your password</H4>
          <P>
            In <UI>Account settings</UI> → <UI>Security</UI>, enter your current password
            and a new one of at least 8 characters.
          </P>
          <H4>Sign out</H4>
          <Bullets>
            <li>Use <UI>Sign out</UI> in your avatar menu, or next to <em>This device</em> in the Security tab.</li>
          </Bullets>
          <H4>Delete your account</H4>
          <P>
            At the bottom of the Security tab, click <UI>Delete account</UI> and type your
            username to confirm.
          </P>
          <Callout kind="warn" title="This cannot be undone">
            Deleting your account removes it permanently. Cancel any active subscriptions
            first.
          </Callout>
        </div>
      ),
    },
  ],
}
