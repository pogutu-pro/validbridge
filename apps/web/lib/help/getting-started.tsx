import type { HelpCategory } from './types'
import {
  P,
  H4,
  UI,
  Kbd,
  ProseLink,
  HelpLink,
  Callout,
  Steps,
  Step,
  Bullets,
  Numbers,
  Defs,
  Def,
  Table,
  Jump,
} from './prose'
import { appHref, helpHref } from './links'
import { COMPANY } from './brand'

export const gettingStarted: HelpCategory = {
  id: 'getting-started',
  title: 'Getting started',
  icon: 'rocket',
  description: 'What ValidBridge is, who can do what, and how to find your way around.',
  articles: [
    {
      id: 'welcome',
      title: 'Welcome to ValidBridge',
      summary:
        'ValidBridge is a learning platform for building, teaching and selling courses — including live classes. Start here for the key ideas.',
      audience: ['everyone'],
      keywords: ['introduction', 'overview', 'what is', 'basics', 'stratnovo'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            ValidBridge is a cloud learning platform for building courses, teaching them
            — on demand or live — and selling them. It is built and operated by{' '}
            <ProseLink href={COMPANY.url} external>
              {COMPANY.name}
            </ProseLink>
            . Everything you create lives inside an <strong>organization</strong>: a
            workspace with its own courses, people, branding and settings. You may belong
            to one organization or several.
          </P>
          <H4>Four ideas you will see everywhere</H4>
          <Defs>
            <Def term="Course">
              a program of study. Each course is made of <strong>chapters</strong>.
            </Def>
            <Def term="Chapter">
              a module or unit inside a course, containing <strong>activities</strong>.
            </Def>
            <Def term="Activity">
              a single piece of learning — a rich page, a video, a document, an
              assignment, or the recording of a live lesson.
            </Def>
            <Def term="Trail">
              your personal progress record across every course you have started.
            </Def>
          </Defs>
          <H4>Where to go next</H4>
          <Table
            head={['If you want to…', 'Start with']}
            rows={[
              [
                'Learn — take courses and join live classes',
                <HelpLink key="l" ctx={ctx} to="students/browse-and-enrol">
                  Finding & enrolling in courses
                </HelpLink>,
              ],
              [
                'Teach — build a course',
                <HelpLink key="t" ctx={ctx} to="courses/create-course">
                  Creating a course
                </HelpLink>,
              ],
              [
                'Teach live — run a class in LiveBridge',
                <HelpLink key="lb" ctx={ctx} to="livebridge/live-overview">
                  LiveBridge live classes
                </HelpLink>,
              ],
              [
                'Sell courses',
                <HelpLink key="p" ctx={ctx} to="payments/payments-overview">
                  How payments work
                </HelpLink>,
              ],
              [
                'Run the organization',
                <HelpLink key="o" ctx={ctx} to="organization/org-settings">
                  Organization settings
                </HelpLink>,
              ],
            ]}
          />
          <Callout kind="tip" title="Help is always one click away">
            Open this Help Center from <UI>Help</UI> in the top bar or the dashboard
            sidebar. Use the search box at the top of any help page to jump straight to
            an answer.
          </Callout>
        </div>
      ),
    },
    {
      id: 'accounts-and-roles',
      title: 'Accounts, roles & permissions',
      summary:
        'How you sign in, the four default roles (User, Instructor, Maintainer, Admin) and what each one can do.',
      audience: ['everyone'],
      keywords: ['role', 'permission', 'access', 'learner', 'instructor', 'admin', 'maintainer', 'student', 'lecturer'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            You sign in with your email and password, or with another method your
            organization has enabled (Google, an emailed sign-in link, or single sign-on).
            Once you are signed in, what you can see and do is decided by your{' '}
            <strong>role</strong>.
          </P>
          <H4>The four default roles</H4>
          <Table
            head={['Role', 'Best for', 'Can do']}
            rows={[
              [
                <strong key="a">User</strong>,
                'Learners',
                'Browse and enrol in courses, join live lessons, complete activities and assignments, view their Trail and certificates, and chat with the AI Copilot.',
              ],
              [
                <strong key="i">Instructor</strong>,
                'Teachers',
                'Everything a User can do, plus create and edit their own courses, run live lessons, grade assignments, and use the AI authoring tools.',
              ],
              [
                <strong key="m">Maintainer</strong>,
                'Team leads',
                'Manage courses, collections and published content, manage users, and moderate communities and boards.',
              ],
              [
                <strong key="ad">Admin</strong>,
                'Owners',
                'Full control of the organization: users and roles, branding, AI, payments, developer settings and every feature.',
              ],
            ]}
          />
          <P>
            A role is a bundle of per-resource permissions. Admins can create custom
            roles, so a title like &ldquo;Instructor&rdquo; may be set up differently in
            your organization. In a live classroom, instructors appear as{' '}
            <strong>Lecturer</strong> and learners as <strong>Student</strong>.
          </P>
          <H4>Finding your role</H4>
          <Numbers>
            <li>
              Open your account menu (your avatar) and choose <UI>Account settings</UI>.
            </li>
            <li>
              If you think you are missing access, ask an admin — they can change your
              role under <UI>Users</UI> in the dashboard.
            </li>
          </Numbers>
          <Callout kind="info" title="No Dashboard link?">
            The dashboard is gated by a <em>dashboard access</em> permission. If you do
            not see a <UI>Dashboard</UI> link, your role does not include it.
          </Callout>
          <Jump href={helpHref(ctx, 'organization/roles-and-permissions')} label="Admins: roles & custom permissions" />
        </div>
      ),
    },
    {
      id: 'finding-your-way',
      title: 'Finding your way around',
      summary:
        'The learning area, the dashboard, the command palette (Ctrl/⌘ + K) and the onboarding checklist.',
      audience: ['everyone'],
      keywords: ['navigation', 'sidebar', 'menu', 'dashboard', 'command palette', 'shortcut', 'ctrl k'],
      content: () => (
        <div className="space-y-5">
          <P>
            ValidBridge has two areas: the <strong>learning area</strong> that everyone
            uses, and the <strong>dashboard</strong> where instructors, maintainers and
            admins build and manage.
          </P>
          <H4>The learning area</H4>
          <Bullets>
            <li>
              <strong>Left sidebar</strong> — your main destinations: courses, your
              learning (Trail), live lessons, and any links your organization has added.
              The logo returns to the organization home.
            </li>
            <li>
              <strong>Top bar</strong> — search, help, notifications and your profile.
              On phones the sidebar folds into a menu.
            </li>
          </Bullets>
          <H4>The dashboard</H4>
          <P>
            Open it from the <UI>Dashboard</UI> link (if your role allows it). Its sidebar
            groups everything by purpose:
          </P>
          <Table
            head={['Group', 'What lives there']}
            rows={[
              ['Learning', 'Courses (including each course’s LiveBridge tab) and assignments'],
              ['Content', 'Library, communities, podcasts, boards, playgrounds'],
              ['People', 'Users, user groups, roles, signups, sign-in methods, two-factor policy, audit logs'],
              ['Monetization', 'Payments — overview, offers, payment groups, configuration'],
              ['Administration', 'Organization settings and developer tools'],
              ['Insights', 'Analytics'],
            ]}
          />
          <H4>The command palette</H4>
          <P>
            Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> (<Kbd>⌘</Kbd> <Kbd>K</Kbd> on a Mac) to
            jump to any page, course, assignment or setting by typing its name.
          </P>
          <Steps>
            <Step>Open the palette with <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>K</Kbd>.</Step>
            <Step>Type a few letters — results are grouped by type.</Step>
            <Step>Use the arrow keys and <Kbd>Enter</Kbd> to open a result, or <Kbd>Esc</Kbd> to close.</Step>
          </Steps>
          <H4>Onboarding checklist</H4>
          <P>
            New organizations see a short setup checklist in the dashboard (create a
            course, invite people, brand the workspace…). It disappears once you finish
            or dismiss it.
          </P>
        </div>
      ),
    },
    {
      id: 'search-learner',
      title: 'Searching your organization',
      summary: 'Find courses, collections and people across your organization.',
      audience: ['everyone'],
      keywords: ['find', 'lookup', 'search bar'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Search finds courses, collections and people in your organization. It only
            ever shows your own organization&apos;s content.
          </P>
          <Steps>
            <Step>
              Click the search box in the top bar, or open{' '}
              <ProseLink href={appHref(ctx, '/search')}>search</ProseLink>.
            </Step>
            <Step>Type a few words from the title or description.</Step>
            <Step>Results are grouped by type; open one to go straight to it.</Step>
          </Steps>
          <Callout kind="tip" title="Looking for help instead?">
            To search these help articles, use the search box at the top of the Help
            Center.
          </Callout>
        </div>
      ),
    },
  ],
}
