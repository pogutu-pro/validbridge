import type { HelpSection } from './types'
import { P, UI, ProseLink, Callout, Numbers, Defs, Def } from './prose'

export const troubleshooting: HelpSection = {
  id: 'troubleshooting',
  title: 'Troubleshooting & FAQ',
  icon: 'lifebuoy',
  tagline: 'Quick answers to the problems people hit most often.',
  subsections: [
    {
      id: 'sign-in',
      title: 'Signing in & accounts',
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="“You appear to be offline”">
              the app cannot reach the API. Check your connection, then reload. If it
              persists, the instance's API may be down.
            </Def>
            <Def term="Locked out after failed attempts">
              logins are rate-limited per IP and accounts lock briefly after repeated
              failures. Wait a few minutes and try again, or reset your password.
            </Def>
            <Def term="Google sign-in fails">
              Google OAuth must be enabled for the instance by an administrator. Use email
              and password, or ask your admin to enable it.
            </Def>
            <Def term="SSO loops or fails">
              SSO is configured per organization by an admin. Confirm you are signing in
              through the organization's own sign-in page and that your email domain is
              allowed.
            </Def>
          </Defs>
          <Callout kind="tip" title="Email not verified">
            On cloud deployments you must verify your email before you can sign in. Check
            your inbox (and spam) for the verification link.
          </Callout>
        </div>
      ),
    },
    {
      id: 'content',
      title: 'Courses, content & media',
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="A course is not visible">
              it may be a draft, or restricted to a user group you are not in. Ask its
              owner to publish it or add you to the group.
            </Def>
            <Def term="An image or video will not upload">
              check the format and size limits shown in the upload dialog — images are
              typically PNG/JPG/WebP up to 8 MB, and hosted video MP4/WebM.
            </Def>
            <Def term="Captions never finish">
              caption generation needs AI enabled for the organization, available AI
              credits, and Redis running on the server. Check the status in the captions
              panel.
            </Def>
            <Def term="A video embed is blank">
              external embeds can be blocked by the source. Confirm the video allows
              embedding and is not private.
            </Def>
          </Defs>
          <Callout kind="info" title="Changed your mind about a course?">
            Remove it from <UI>My learning</UI> to clear its progress, then re-enrol when
            you want to start again.
          </Callout>
        </div>
      ),
    },
    {
      id: 'realtime',
      title: 'Collaborative editing & boards',
      content: () => (
        <div className="space-y-4">
          <P>
            Real-time editing and boards rely on the collaboration server. If it is not
            running or cannot authenticate, live features stall.
          </P>
          <Defs>
            <Def term="Editor stuck on “connecting”">
              the collaboration server is unreachable. Wait and retry; if you are
              self-hosting, confirm it is running.
            </Def>
            <Def term="Boards stuck on “connecting”">
              the collaboration server cannot authenticate against the API. Its JWT secret
              must match the API's, and its API URL must point at the running API.
            </Def>
            <Def term="“Address already in use” on port 4000">
              a previous collaboration server is still bound to the port. Stop it before
              starting a new one.
            </Def>
          </Defs>
          <Callout kind="tip" title="You can keep working">
            When live sync is unavailable, normal saving still works — your content is not
            lost. Only simultaneous multi-user editing pauses.
          </Callout>
        </div>
      ),
    },
    {
      id: 'assignments',
      title: 'Assignments & grading',
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="Cannot submit">
              the deadline may have passed, or you may have used all allowed attempts.
              Contact your instructor.
            </Def>
            <Def term="Work not saving">
              if you are near the deadline you will be warned before saving stops. Submit
              before the cut-off.
            </Def>
            <Def term="No score on a formative assignment">
              that is by design — formative assignments are ungraded and unlock the model
              answer instead.
            </Def>
            <Def term="Grade looks wrong">
              ask your instructor to reopen the submission. Grades are recorded in your
              Trail once finalised.
            </Def>
          </Defs>
        </div>
      ),
    },
    {
      id: 'ai',
      title: 'AI & credits',
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="No Ask AI button">
              AI is disabled for the organization, or the instance has no AI provider
              configured. An admin can enable it.
            </Def>
            <Def term="“Out of credits”">
              the organization's AI credits are exhausted. Credits reset monthly, or the
              plan can be upgraded for a larger allowance.
            </Def>
            <Def term="Answers seem off-topic">
              make sure you opened Genie from the activity you are asking about, so
              it has the right context. Follow-ups within the same conversation also keep
              context.
            </Def>
          </Defs>
          <Callout kind="warn" title="Verify important facts">
            AI output can be wrong. Use it to learn, not as an authority.
          </Callout>
        </div>
      ),
    },
    {
      id: 'payments',
      title: 'Payments',
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="Checkout not available">
              payments may not be enabled for the organization, or Stripe may not be
              connected yet.
            </Def>
            <Def term="Paid but no access">
              enrollment is created on payment confirmation. If it is delayed, check the
              enrollment status in the dashboard; a pending payment grants access once it
              completes.
            </Def>
            <Def term="Manage a subscription">
              subscribers can update their payment method, view invoices and cancel from
              the Stripe billing portal.
            </Def>
          </Defs>
        </div>
      ),
    },
    {
      id: 'still-stuck',
      title: 'Still stuck?',
      content: () => (
        <div className="space-y-4">
          <P>If none of the above helps, here is how to get a real answer fast:</P>
          <Numbers>
            <li>
              Ask <strong>AI Genie</strong> — for anything about course content it is
              usually immediate.
            </li>
            <li>
              Search the <strong>documentation site</strong> at{' '}
              <ProseLink href="https://docs.validbridge.co.ke" external>
                docs.validbridge.co.ke
              </ProseLink>
              .
            </li>
            <li>
              Open <UI>Help</UI> → <UI>Report Issue or Feedback</UI> and describe the
              problem, attaching a screenshot.
            </li>
          </Numbers>
          <Callout kind="tip" title="Include the details">
            Page name, your role, what you expected, and what happened — plus the exact
            error text. That is usually enough for a quick fix.
          </Callout>
        </div>
      ),
    },
  ],
}