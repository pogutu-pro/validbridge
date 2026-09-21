import type { HelpSection } from './types'
import {
  P,
  H4,
  UI,
  Kbd,
  ProseLink,
  Callout,
  Bullets,
  Numbers,
  Defs,
  Def,
  Table,
  Jump,
} from './prose'
import { getUriWithOrg } from '@services/config/config'

export const gettingStarted: HelpSection = {
  id: 'getting-started',
  title: 'Getting started',
  icon: 'rocket',
  tagline: 'What ValidBridge is, who can do what, and how to find your way around.',
  subsections: [
    {
      id: 'welcome',
      title: 'Welcome to ValidBridge',
      content: () => (
        <div className="space-y-4">
          <P>
            ValidBridge is a learning platform for building and delivering courses.
            Everything you create lives inside an <strong>organization</strong> — a
            self-contained workspace with its own courses, people, branding and
            settings. You may belong to one organization or several.
          </P>
          <P>
            The platform is organized around four ideas that you will see everywhere:
          </P>
          <Defs>
            <Def term="Course">
              a program of study. Each course is made of <strong>chapters</strong>.
            </Def>
            <Def term="Chapter">
              a module or unit inside a course, containing <strong>activities</strong>.
            </Def>
            <Def term="Activity">
              a single piece of learning content — a rich page, a video, a document, or
              a gradable assignment.
            </Def>
            <Def term="Trail">
              your personal progress record across every course you have started.
            </Def>
          </Defs>
          <H4>What you can do here</H4>
          <Bullets>
            <li>
              <strong>Learn</strong> — browse and enrol in courses, work through
              activities, submit assignments, and ask the AI Copilot for help.
            </li>
            <li>
              <strong>Teach</strong> — build courses in a block-based editor, create
              gradable assignments, collaborate on content in real time, and generate
              material with AI.
            </li>
            <li>
              <strong>Run an organization</strong> — manage people and roles, brand the
              workspace, sell courses, and connect the platform to your own systems.
            </li>
          </Bullets>
          <Callout kind="tip" title="Where am I?">
            The sidebar on the left and the bar along the top are your two maps of the
            platform. This Help Center is always one click away from the{' '}
            <UI>Help</UI> button in the top bar and the sidebar.
          </Callout>
        </div>
      ),
    },
    {
      id: 'accounts-and-roles',
      title: 'Accounts, roles & permissions',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            You sign in with an email and password, or with Google if your organization
            has enabled it. Enterprise organizations can also use single sign-on (SSO).
            Once signed in, what you can see and do is decided by your <strong>role</strong>.
          </P>
          <H4>The four default roles</H4>
          <Table
            head={['Role', 'Best for', 'Can do']}
            rows={[
              [
                <strong key="a">User</strong>,
                'Learners',
                'Browse and enrol in courses, complete activities and assignments, view their Trail and certificates, and chat with the AI Copilot.',
              ],
              [
                <strong key="i">Instructor</strong>,
                'Teachers',
                'Everything a User can do, plus create and edit their own courses, chapters and activities, grade assignments, and use the AI authoring tools.',
              ],
              [
                <strong key="m">Maintainer</strong>,
                'Team leads',
                'Manage courses, collections and published content, manage users, and moderate communities and boards. Cannot change platform-level settings.',
              ],
              [
                <strong key="ad">Admin</strong>,
                'Owners',
                'Full control of the organization: users and roles, branding, AI, payments, developers settings, and every feature.',
              ],
            ]}
          />
          <P>
            A role is really a bundle of per-resource permissions. Admins can create
            custom roles and fine-tune each permission individually, so a title like
            &ldquo;Instructor&rdquo; may be configured differently in your organization.
          </P>
          <H4>Finding your role</H4>
          <Numbers>
            <li>
              Open your account menu (your avatar, top-right) or go to{' '}
              <UI>Account settings</UI>.
            </li>
            <li>
              Your roles are listed there. If you believe you are missing access, an
              admin can adjust your role under <UI>Users</UI> in the dashboard.
            </li>
          </Numbers>
          <Callout kind="info" title="Role-gated areas">
            The dashboard itself is gated by a <em>dashboard access</em> permission.
            If you do not see a <UI>Dashboard</UI> link, your role does not include it.
            Ask an admin to grant it.
          </Callout>
          <Jump href={`${getUriWithOrg(orgslug, '/help')}#roles-and-permissions`} label="Deep dive: roles & permissions" />
        </div>
      ),
    },
    {
      id: 'finding-your-way',
      title: 'Finding your way around',
      content: () => (
        <div className="space-y-5">
          <P>
            There are two shells in ValidBridge: the <strong>learning shell</strong> that
            everyone uses, and the <strong>dashboard shell</strong> that instructors,
            maintainers and admins use to build and manage.
          </P>
          <div className="space-y-3">
            <H4>The learning shell (left sidebar + top bar)</H4>
            <P>
              This is what you see on the organization home, courses, your Trail and the
              rest of the learner-facing pages.
            </P>
            <Bullets>
              <li>
                <strong>Left sidebar</strong> — your primary destinations: your courses,
                your learning (Trail), and anything the organization has added to its
                menu. The logo at the top returns to the organization home.
              </li>
              <li>
                <strong>Top bar</strong> — search, the help menu, notifications, and
                your profile. On mobile the sidebar collapses and the top bar menu takes
                over.
              </li>
              <li>
                <strong>Collapse handle</strong> — the icon at the sidebar's top-right
                shrinks it to an icon rail when you want more room.
              </li>
            </Bullets>
          </div>
          <div className="space-y-3">
            <H4>The dashboard shell</H4>
            <P>
              Reachable from the <UI>Dashboard</UI> link (if your role allows it), this
              is the management side of the platform. Its sidebar groups everything by
              intent:
            </P>
            <Table
              head={['Group', 'What lives there']}
              rows={[
                ['Learning', 'Courses, assignments'],
                ['Content', 'Library, communities, podcasts, boards, playgrounds (Labs)'],
                ['People', 'Users, groups, roles, signups, two-factor, audit logs'],
                ['Monetization', 'Payments — offers, groups, customers'],
                ['Administration', 'Organization settings and developers tools'],
                ['Insights', 'Analytics'],
              ]}
            />
          </div>
          <div className="space-y-3">
            <H4>The command palette</H4>
            <P>
              The fastest way to move around is the command palette. Press{' '}
              <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> (or <Kbd>⌘</Kbd> <Kbd>K</Kbd> on macOS), or
              click the search box at the top of the dashboard sidebar, then start typing
              the name of a page, course, assignment or setting.
            </P>
            <Numbers>
              <li>Open the palette with <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>K</Kbd>.</li>
              <li>Type a few letters — results are grouped by type (pages, courses, assignments).</li>
              <li>Use the arrow keys to highlight a result and <Kbd>Enter</Kbd> to open it.</li>
              <li>Press <Kbd>Esc</Kbd> to dismiss it.</li>
            </Numbers>
          </div>
          <div className="space-y-3">
            <H4>Onboarding checklist</H4>
            <P>
              New organizations get an onboarding checklist at the top of the dashboard
              sidebar. It tracks a few setup steps (create a course, invite people, brand
              the workspace, and so on) and disappears once you finish or dismiss it.
            </P>
          </div>
        </div>
      ),
    },
    {
      id: 'getting-help',
      title: 'Getting help & support',
      content: () => (
        <div className="space-y-4">
          <P>
            There are several ways to get help, depending on what you need. This page is
            the built-in guide and covers every feature; the links below take you further.
          </P>
          <Defs>
            <Def term="Help Center (this page)">
              a section-by-section guide to every feature, written for learners,
              instructors and admins. Open it any time from <UI>Help</UI> in the top bar
              or the dashboard sidebar.
            </Def>
            <Def term="Documentation site">
              the online reference at{' '}
              <ProseLink href="https://docs.validbridge.co.ke" external>
                docs.validbridge.co.ke
              </ProseLink>{' '}
              — longer-form guides, self-hosting and developer references.
            </Def>
            <Def term="AI Copilot">
              ask questions about a course or activity in plain language. See{' '}
              <a className="font-medium text-primary underline" href="#ai-copilot">
                Ask AI (the Copilot)
              </a>
              .
            </Def>
            <Def term="Discord">
              the community chat, for questions and discussion with other users.
            </Def>
            <Def term="Report feedback">
              the in-app form for bugs and feature requests. Open <UI>Help</UI> →{' '}
              <UI>Report Issue or Feedback</UI>, describe what happened (attach a
              screenshot if you can), and send.
            </Def>
          </Defs>
          <H4>How to write a good support request</H4>
          <Numbers>
            <li>Say what you were trying to do, and what you expected to happen.</li>
            <li>Say what actually happened — include the exact wording of any error.</li>
            <li>Mention where you were (page name) and your role.</li>
            <li>Attach a screenshot if the problem is visual.</li>
          </Numbers>
          <Callout kind="tip" title="Try the Copilot first">
            For questions about course content or how something works, the AI Copilot is
            usually the fastest answer — it can read the material you are looking at.
          </Callout>
        </div>
      ),
    },
  ],
}