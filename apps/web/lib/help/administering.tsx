import type { HelpSection } from './types'
import {
  P,
  H4,
  UI,
  Callout,
  Steps,
  Step,
  Bullets,
  Defs,
  Def,
  Table,
} from './prose'

export const administering: HelpSection = {
  id: 'administering',
  title: 'Administering',
  icon: 'buildings',
  tagline: 'Manage people and roles, configure the organization, sell courses, and connect your systems.',
  subsections: [
    {
      id: 'managing-users',
      title: 'Managing users',
      content: () => (
        <div className="space-y-4">
          <P>
            The <UI>Users</UI> area is where you see everyone in the organization and
            control their access.
          </P>
          <H4>Adding people</H4>
          <Steps>
            <Step>
              Go to <UI>Users</UI> → <UI>Add</UI> in the dashboard.
            </Step>
            <Step>Enter the person's email (and name if you have it).</Step>
            <Step>Assign their role. They receive access according to the role you choose.</Step>
          </Steps>
          <P>
            If signup is open, people can also join themselves — see{' '}
            <a className="font-medium text-primary underline" href="#signups">
              Signups & user groups
            </a>
            . You can review and approve or reject pending signups from the{' '}
            <UI>Signups</UI> tab.
          </P>
          <H4>The Users tabs</H4>
          <Table
            head={['Tab', 'What it does']}
            rows={[
              ['Users', 'The full member list. Search, open a profile, change roles, or deactivate.'],
              ['Groups', 'User groups used to grant access to private courses and resources.'],
              ['Roles', 'The permission matrix — see the next section.'],
              ['Signups', 'People waiting to join, if signup requires approval.'],
              ['Add', 'Create an account directly.'],
              ['Sign-in', 'Authentication options, including Google OAuth and SSO.'],
              ['Two-factor', 'Require two-factor authentication for the organization.'],
              ['Audit logs', 'A record of security- and admin-relevant actions (Enterprise).'],
            ]}
          />
          <H4>Deactivating a user</H4>
          <P>
            Opening a user's profile lets you change their role or deactivate the account.
            Deactivated users cannot sign in but their data (submissions, progress) is
            kept.
          </P>
          <Callout kind="warn" title="Two-factor policy">
            Enforcing two-factor from the <UI>Two-factor</UI> tab applies to every member.
            Users who have not set it up see a prompt until they do.
          </Callout>
        </div>
      ),
    },
    {
      id: 'roles-and-permissions',
      title: 'Roles & permissions',
      content: () => (
        <div className="space-y-4">
          <P>
            Access in ValidBridge is role-based. A role is a per-resource{' '}
            <strong>permission matrix</strong> covering courses, users, user groups,
            collections, the organization, chapters, activities, roles, the dashboard,
            communities, discussions, podcasts, boards and playgrounds.
          </P>
          <H4>The four seeded roles</H4>
          <Table
            head={['Role', 'Summary']}
            rows={[
              [
                <strong key="u">User</strong>,
                'Learner. Browse and enrol, complete work, view their Trail and certificates, use the Copilot.',
              ],
              [
                <strong key="i">Instructor</strong>,
                'Create and edit their own courses, chapters and activities; grade; use AI authoring tools.',
              ],
              [
                <strong key="m">Maintainer</strong>,
                'Manage courses, collections, published content and users; moderate communities and boards.',
              ],
              [
                <strong key="a">Admin</strong>,
                'Full control, including organization settings, payments, developers tools and custom roles.',
              ],
            ]}
          />
          <H4>Custom roles</H4>
          <Steps>
            <Step>
              Go to <UI>Users</UI> → <UI>Roles</UI>.
            </Step>
            <Step>
              Create a role (global, or scoped to this organization) and name it.
            </Step>
            <Step>
              Toggle permissions per resource — for example, allow <em>update content</em>{' '}
              on courses but not <em>manage access</em>.
            </Step>
            <Step>Assign the role to users from the Users tab.</Step>
          </Steps>
          <Callout kind="tip" title="Least privilege">
            Give people the narrowest role that lets them do their job. A contributor who
            only writes content does not need access to payments or user management.
          </Callout>
          <Callout kind="info" title="Plan limits">
            Some role features depend on the plan. User groups need Standard, custom roles
            need Pro. The dashboard shows a badge next to gated tabs.
          </Callout>
        </div>
      ),
    },
    {
      id: 'signups',
      title: 'Signups & user groups',
      content: () => (
        <div className="space-y-4">
          <H4>Controlling how people join</H4>
          <P>
            Each organization decides its signup mechanism in{' '}
            <UI>Organization settings</UI>:
          </P>
          <Defs>
            <Def term="Open signup">
              anyone can create an account and join the organization.
            </Def>
            <Def term="Invite-only">
              only people who receive an invitation can join.
            </Def>
          </Defs>
          <P>
            For open signup you can also add custom signup fields (with labels and help
            text) shown on the public signup form, and choose whether new accounts need
            approval.
          </P>
          <H4>User groups</H4>
          <P>
            A user group is a named set of people. Groups are the main way to give access
            to <strong>private courses and resources</strong>: restrict a course to a
            group and only its members can see it. Groups are also used for bundles — when
            someone buys an offer linked to a payment group, they are added to the
            matching user group automatically.
          </P>
          <Steps>
            <Step>
              Go to <UI>Users</UI> → <UI>Groups</UI> and create a group.
            </Step>
            <Step>Add members (or sync the group with a payment group).</Step>
            <Step>On a course's <UI>Access</UI> tab, restrict it to the group.</Step>
          </Steps>
          <Callout kind="info" title="Groups need the Standard plan">
            If you do not see the Groups tab, your plan may not include it.
          </Callout>
        </div>
      ),
    },
    {
      id: 'org-settings',
      title: 'Organization settings',
      content: () => (
        <div className="space-y-4">
          <P>
            Organization settings control the workspace itself. Open them from{' '}
            <UI>Organization</UI> in the dashboard sidebar.
          </P>
          <Table
            head={['Tab', 'What it controls']}
            rows={[
              ['General', 'Organization name, slug, description and the features enabled for the org.'],
              ['Branding', 'Logo, favicon, colors and custom font.'],
              ['Menu', 'The links shown in the learner-facing sidebar and top navigation.'],
              ['Landing', 'The custom landing page shown at the organization home.'],
              ['AI', 'Turn AI on/off, set a per-user request limit, and toggle AI surfaces.'],
              ['Usage', 'Plan usage and limits.'],
              ['Other', 'Additional configuration such as signup and integrations.'],
              ['Danger zone', 'Irreversible actions such as deleting the organization.'],
            ]}
          />
          <H4>Feature toggles</H4>
          <P>
            Features such as communities, podcasts, boards, playgrounds, payments, the
            library and analytics are enabled per organization. If a feature is off, it
            disappears from the sidebar for everyone — including its dashboard entry.
          </P>
          <H4>AI settings</H4>
          <P>
            The AI tab lets you enable or disable AI for the organization, cap requests
            per user, and switch individual surfaces (such as the admin Copilot). The
            underlying Gemini API key is an instance-level setting configured once at
            deployment, not per organization.
          </P>
          <Callout kind="warn" title="The danger zone is permanent">
            Deleting an organization removes its courses, users and data. Export anything
            you need first.
          </Callout>
        </div>
      ),
    },
    {
      id: 'branding-and-landing',
      title: 'Branding & the landing page',
      content: () => (
        <div className="space-y-4">
          <H4>Branding</H4>
          <P>
            Upload a logo and favicon, pick a primary color, and choose a font. The color
            tints the workspace and the font applies to the whole organization. Preview as
            you go.
          </P>
          <H4>The organization menu</H4>
          <P>
            From <UI>Menu</UI> you control the links in the learner-facing sidebar and top
            navigation. Reorder them, rename them, or point them at external URLs. This is
            how you surface the destinations your learners actually use.
          </P>
          <H4>The landing page</H4>
          <P>
            By default the organization home is a classic catalogue of courses. From{' '}
            <UI>Landing</UI> you can instead build a custom landing page with sections and
            calls to action — useful for a branded front door before learners reach the
            course list.
          </P>
          <Callout kind="tip" title="Match your brand">
            A logo, a primary color and a font are the three changes that make the
            platform feel like your own. Start there.
          </Callout>
        </div>
      ),
    },
    {
      id: 'payments-admin',
      title: 'Payments',
      content: () => (
        <div className="space-y-4">
          <P>
            When payments are enabled, you can sell courses directly from the platform.
            ValidBridge integrates with Stripe.
          </P>
          <Callout kind="info" title="Availability">
            Payments is available on the Standard plan and above on the cloud, and
            requires the Enterprise Edition for self-hosted instances. It must also be
            enabled in organization settings.
          </Callout>
          <H4>Connecting Stripe</H4>
          <Defs>
            <Def term="Standard mode">
              connect your own existing Stripe account via OAuth.
            </Def>
            <Def term="Express mode">
              ValidBridge creates a Stripe Express account on your behalf, simplifying
              onboarding.
            </Def>
          </Defs>
          <H4>The Payments tabs</H4>
          <Table
            head={['Tab', 'What it does']}
            rows={[
              ['Overview / Customers', 'Charges, subscriptions and customers, without leaving ValidBridge.'],
              ['Offers', 'The products you sell, their price, type and linked resources.'],
              ['Payment groups', 'Bundles of courses sold together, optionally synced to user groups.'],
              ['Configuration', 'Connect and configure your Stripe account.'],
            ]}
          />
          <H4>Creating an offer</H4>
          <Steps>
            <Step>
              Open <UI>Payments</UI> → <UI>Offers</UI> and click <UI>New offer</UI>.
            </Step>
            <Step>
              Choose the type — <strong>subscription</strong> (recurring) or{' '}
              <strong>one-time</strong>.
            </Step>
            <Step>
              Set a fixed price, or let the customer choose what to pay.
            </Step>
            <Step>Link the courses (or a payment group) the offer grants access to.</Step>
            <Step>Mark it public to list it on your storefront.</Step>
          </Steps>
          <P>
            On purchase, Stripe handles checkout and an enrollment is created
            automatically. Enrollment statuses include pending, completed, active,
            cancelled, failed and refunded.
          </P>
        </div>
      ),
    },
    {
      id: 'content-areas',
      title: 'Content areas: library, communities & more',
      content: () => (
        <div className="space-y-4">
          <P>
            Beyond courses, the dashboard manages several content surfaces. Each is
            enabled per organization and appears in the sidebar when on.
          </P>
          <Defs>
            <Def term="Library">
              a store of reusable resources — folders of files and objects — that you can
              reference from courses and activities.
            </Def>
            <Def term="Communities">
              the discussion spaces learners see. Create communities, manage labels, and
              moderate threads.
            </Def>
            <Def term="Podcasts">
              audio series and their episodes, published to learners.
            </Def>
            <Def term="Boards">
              collaborative canvases for group work and workshops.
            </Def>
            <Def term="Playgrounds (Labs)">
              AI-generated interactive HTML experiences.
            </Def>
          </Defs>
          <H4>Moderation</H4>
          <P>
            In communities, teachers and admins can pin important threads, lock resolved
            ones, and delete content that breaks your guidelines. Labels let you organise
            discussions so learners can filter them.
          </P>
          <Callout kind="tip" title="The Library pays off">
            Anything you will reuse — a diagram, a handout, a shared form — belongs in the
            Library rather than duplicated in each course.
          </Callout>
        </div>
      ),
    },
    {
      id: 'analytics-admin',
      title: 'Analytics (organization-wide)',
      content: () => (
        <div className="space-y-4">
          <P>
            The <UI>Analytics</UI> area in the dashboard shows how the whole organization
            is being used.
          </P>
          <H4>Time ranges</H4>
          <P>Switch between 7, 30 and 90 day windows to see trends.</P>
          <H4>What is tracked</H4>
          <Bullets>
            <li>User engagement — activity views, time spent, interaction patterns.</li>
            <li>Course analytics — popular courses and how learners progress.</li>
            <li>Organization metrics — overall usage and growth.</li>
          </Bullets>
          <H4>Overview and Advanced</H4>
          <P>
            The <UI>Overview</UI> tab covers the essentials. <UI>Advanced</UI> analytics
            is an Enterprise feature with deeper reporting.
          </P>
          <P>
            You can also drill into a single learner from{' '}
            <UI>Users</UI> → <UI>Analytics</UI> to see their individual activity.
          </P>
          <Callout kind="info" title="Data is cached">
            Analytics uses event caching for performance, so the most recent activity may
            take a short while to appear.
          </Callout>
        </div>
      ),
    },
    {
      id: 'developers',
      title: 'Developers: API, automations, domains, SEO & SSO',
      content: () => (
        <div className="space-y-4">
          <P>
            The <UI>Developers</UI> area connects ValidBridge to your own systems and
            configures advanced infrastructure. Entries are gated by plan.
          </P>
          <H4>API access</H4>
          <P>
            Create API tokens to drive the platform from your own frontend or scripts.
            Tokens are scoped to the permissions you grant, and each one has a tag. See
            the developer docs for endpoints and authentication.
          </P>
          <H4>Automations</H4>
          <P>
            React to platform events with webhooks, and connect to 6,000+ tools through
            the official Zapier app. This is how you mirror enrolments, completions and
            other events into your CRM, email tool or data warehouse.
          </P>
          <H4>Custom domains</H4>
          <P>
            Serve your organization on your own domain instead of a ValidBridge subdomain.
            Add the domain, then point its DNS at your instance as instructed.
          </P>
          <H4>SEO</H4>
          <P>
            Set the metadata search engines and social previews use for your organization
            — titles, descriptions and Open Graph images.
          </P>
          <H4>Single sign-on (SSO)</H4>
          <P>
            Enterprise organizations can connect an identity provider. Two options are
            supported:
          </P>
          <Defs>
            <Def term="WorkOS (SAML)">
              configure through the WorkOS setup portal and paste the organization ID.
            </Def>
            <Def term="Custom OIDC">
              enter the issuer URL (endpoints auto-discover from{' '}
              <UI>/.well-known/openid-configuration</UI>), client ID and secret, scopes,
              and any allowed email domains.
            </Def>
          </Defs>
          <Callout kind="warn" title="Keep the client secret safe">
            The OIDC client secret authenticates your organization to the identity
            provider. Store it securely and rotate it if it is exposed.
          </Callout>
        </div>
      ),
    },
  ],
}