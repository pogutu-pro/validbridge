import type { HelpCategory } from './types'
import { P, H4, UI, ProseLink, HelpLink, Callout, Numbers, Defs, Def, Faq } from './prose'
import { COMPANY, SUPPORT_EMAIL } from './brand'

export const troubleshooting: HelpCategory = {
  id: 'troubleshooting',
  title: 'Troubleshooting & FAQ',
  icon: 'lifebuoy',
  description: 'Quick answers to common problems, and how to reach support.',
  articles: [
    {
      id: 'sign-in',
      title: 'Signing in & accounts',
      summary: '“You appear to be offline”, locked out after failed attempts, Google or SSO sign-in problems, unverified email.',
      audience: ['everyone'],
      keywords: ['cannot log in', 'locked out', 'offline', 'password wrong', 'sso error', 'verification'],
      content: (ctx) => (
        <div className="space-y-3">
          <Faq q="“You appear to be offline”">
            The app cannot reach ValidBridge. Check your connection and reload. If it keeps
            happening, contact support.
          </Faq>
          <Faq q="Locked out after several attempts">
            Sign-in is rate-limited after repeated failures. Wait a few minutes, or reset
            your password with <UI>Forgot password?</UI>.
          </Faq>
          <Faq q="Google sign-in or sign-in links are missing">
            Your organization has not enabled that method. Use email and password, or ask
            an admin (<UI>Users</UI> → <UI>Sign-in Methods</UI>).
          </Faq>
          <Faq q="SSO fails or loops">
            Sign in from your organization&apos;s own sign-in page and check that your email
            domain is allowed. Your admin manages SSO settings.
          </Faq>
          <Faq q="I never got the verification email">
            Check spam and promotions folders, then try again. See{' '}
            <HelpLink ctx={ctx} to="account/sign-in-options">Signing in</HelpLink>.
          </Faq>
        </div>
      ),
    },
    {
      id: 'content',
      title: 'Courses, content & media',
      summary: 'A course is not visible, uploads fail, captions never finish, or an embed is blank.',
      audience: ['everyone'],
      keywords: ['course missing', 'upload failed', 'file too large', 'captions stuck', 'embed blank', 'video not playing'],
      content: () => (
        <div className="space-y-3">
          <Faq q="A course is not visible">
            It may be a draft, or restricted to a user group you are not in. Ask its owner to
            publish it or add you to the group.
          </Faq>
          <Faq q="An image or video will not upload">
            Check the format and size limits shown in the upload dialog — images are usually
            PNG, JPG or WebP; hosted video is MP4 or WebM.
          </Faq>
          <Faq q="Captions never finish">
            Caption generation needs AI enabled and AI credits available. Check the status
            in the captions panel; if it stays stuck, contact support.
          </Faq>
          <Faq q="A video embed is blank">
            The source may block embedding, or the video may be private.
          </Faq>
          <Faq q="Co-editing or a board is stuck on “connecting”">
            Live sync is temporarily unavailable. Your normal saves still work — only
            simultaneous editing pauses. Reload in a moment.
          </Faq>
        </div>
      ),
    },
    {
      id: 'assignments',
      title: 'Assignments & grading',
      summary: 'Cannot submit, work not saving near a deadline, no score on a formative assignment, a grade looks wrong.',
      audience: ['learners'],
      keywords: ['cannot submit', 'deadline passed', 'no grade', 'wrong grade'],
      content: () => (
        <div className="space-y-3">
          <Faq q="I can’t submit">
            The deadline may have passed or you may have used all attempts. Contact your
            instructor.
          </Faq>
          <Faq q="My work stopped saving">
            Near the deadline you are warned before saving stops. Submit before the cut-off.
          </Faq>
          <Faq q="No score on my assignment">
            Formative assignments are ungraded by design — they unlock a model answer instead.
          </Faq>
          <Faq q="My grade looks wrong">
            Ask your instructor to review the submission.
          </Faq>
        </div>
      ),
    },
    {
      id: 'ai',
      title: 'AI & credits',
      summary: 'No Ask AI button, “out of credits”, or answers that seem off-topic.',
      audience: ['everyone'],
      keywords: ['ai not working', 'credits', 'copilot missing'],
      content: () => (
        <div className="space-y-3">
          <Faq q="There is no Ask AI button">
            AI is switched off for your organization. An admin can turn it on under{' '}
            <UI>Organization</UI> → <UI>AI</UI>.
          </Faq>
          <Faq q="“Out of credits”">
            Your organization&apos;s AI credits are used up. They renew with your plan, or an
            admin can add more.
          </Faq>
          <Faq q="Answers seem off-topic">
            Open the Copilot from the activity you are asking about so it has the right
            context.
          </Faq>
        </div>
      ),
    },
    {
      id: 'getting-help',
      title: 'Contact support',
      summary: 'Who to ask, how to report a problem, and how to write a support request that gets a fast answer.',
      audience: ['everyone'],
      keywords: ['support', 'contact', 'help desk', 'email', 'bug', 'report', 'feedback', 'ticket', 'stratnovo'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>Who to ask</H4>
          <Defs>
            <Def term="Your organization">
              for access to a course, grades, roles or a payment you made — your instructor
              or your organization&apos;s admins can fix these directly.
            </Def>
            <Def term="ValidBridge support">
              for bugs, outages, account problems and anything about how the platform works.
              Email{' '}
              <ProseLink href={`mailto:${SUPPORT_EMAIL}`} external>
                {SUPPORT_EMAIL}
              </ProseLink>{' '}
              or use <UI>Help</UI> → <UI>Report Issue or Feedback</UI> in the app.
            </Def>
            <Def term="AI Copilot">
              questions about course content — see{' '}
              <HelpLink ctx={ctx} to="ai/ai-copilot">Ask AI</HelpLink>.
            </Def>
          </Defs>
          <H4>Write a request that gets solved quickly</H4>
          <Numbers>
            <li>What you were trying to do, and what you expected.</li>
            <li>What happened instead — include the exact error text.</li>
            <li>The page you were on, your role, and your organization.</li>
            <li>A screenshot if the problem is visual.</li>
          </Numbers>
          <P>
            ValidBridge is built and supported by{' '}
            <ProseLink href={COMPANY.url} external>
              {COMPANY.name}
            </ProseLink>
            .
          </P>
          <Callout kind="tip" title="Try search first">
            The search box at the top of the Help Center searches every article, including
            these FAQs.
          </Callout>
        </div>
      ),
    },
  ],
}
