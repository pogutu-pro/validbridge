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
} from './prose'
import { appHref } from './links'

export const students: HelpCategory = {
  id: 'students',
  title: 'Students & enrollment',
  icon: 'users',
  description: 'Finding and enrolling in courses, tracking progress and certificates, and managing who is in your organization.',
  articles: [
    {
      id: 'browse-and-enrol',
      title: 'Finding & enrolling in courses',
      summary: 'Where courses are listed, how to enrol in a free course, and what happens with paid courses.',
      audience: ['learners'],
      keywords: ['enroll', 'enrol', 'join course', 'catalogue', 'catalog', 'collections', 'marketplace', 'shop'],
      content: (ctx) => (
        <div className="space-y-4">
          <Defs>
            <Def term="Organization home">
              <ProseLink href={appHref(ctx, '/')}>the landing page</ProseLink> —
              the course catalogue, or a custom page your organization designed.
            </Def>
            <Def term="Courses">the full catalogue, from <UI>Courses</UI> in the sidebar.</Def>
            <Def term="Collections">named groups of courses, such as a learning path.</Def>
            <Def term="Marketplace">paid offers, with prices, when your organization sells courses.</Def>
          </Defs>
          <H4>Enrol in a course</H4>
          <Steps>
            <Step>Find the course in the catalogue, a collection, search or the marketplace.</Step>
            <Step>Open it to see its description, chapters and live lessons.</Step>
            <Step>
              Click <UI>Enrol</UI> (or <UI>Start learning</UI>). Free courses open instantly;
              paid courses take you to checkout — see{' '}
              <HelpLink ctx={ctx} to="payments/paying-for-a-course">
                Paying for a course
              </HelpLink>
              .
            </Step>
            <Step>The course is added to <UI>My learning</UI> and the first activity opens.</Step>
          </Steps>
          <Callout kind="info" title="Can’t find a course?">
            It may still be a draft, or restricted to a user group you are not in. Ask your
            instructor or an admin.
          </Callout>
        </div>
      ),
    },
    {
      id: 'trail-and-certificates',
      title: 'Your Trail, progress & certificates',
      summary: 'Track every course you have started, your results, and the certificates you have earned.',
      audience: ['learners'],
      keywords: ['trail', 'progress', 'certificate', 'my learning', 'completion', 'verify'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Your <strong>Trail</strong> is created the first time you start a course and
            updates as you work.
          </P>
          <Bullets>
            <li>Every course you have started, with a completion bar.</li>
            <li>Completed activities, and your assignment and quiz results.</li>
            <li>Your live lessons, and certificates you have earned.</li>
          </Bullets>
          <P>
            Open it from <UI>My learning</UI> in the sidebar or go to{' '}
            <ProseLink href={appHref(ctx, '/trail')}>your Trail</ProseLink>.
          </P>
          <H4>Certificates</H4>
          <P>
            If a course issues certificates, one is generated when you complete every
            required activity. Each has a unique identifier so others can verify it, and
            you can view or share it from your Trail.
          </P>
        </div>
      ),
    },
    {
      id: 'managing-users',
      title: 'Add and manage users',
      summary: 'Add people, change their role, review signups and deactivate accounts from the Users area.',
      audience: ['admins'],
      keywords: ['users', 'members', 'invite', 'add member', 'deactivate', 'students', 'staff'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>Add people</H4>
          <Steps>
            <Step>In the dashboard, go to <UI>Users</UI> → <UI>Add Member</UI>.</Step>
            <Step>Enter the person&apos;s email (and name if you have it).</Step>
            <Step>Choose their role.</Step>
          </Steps>
          <P>
            If signup is open, people can also join themselves — see{' '}
            <HelpLink ctx={ctx} to="students/signups">Signups &amp; user groups</HelpLink>.
          </P>
          <H4>The Users area</H4>
          <Table
            head={['Tab', 'What it does']}
            rows={[
              ['Users', 'Everyone in the organization. Search, open a profile, change roles, deactivate.'],
              ['User Groups', 'Groups used to give access to restricted courses and resources.'],
              ['Roles', 'The permission matrix.'],
              ['Signups', 'People waiting for approval to join.'],
              ['Add Member', 'Create an account directly.'],
              ['Sign-in Methods', 'Which sign-in options are allowed, including Google and SSO.'],
              ['Two-Factor Policy', 'Require two-factor authentication for members.'],
              ['Audit Logs', 'A record of security and admin actions.'],
            ]}
          />
          <H4>Deactivating a user</H4>
          <P>
            Open a user&apos;s profile to change their role or deactivate them. Deactivated
            users cannot sign in, but their submissions and progress are kept.
          </P>
          <H4>Good to know</H4>
          <Bullets>
            <li>To give a student access to a course, enrol them or add them to a user group the course is restricted to.</li>
            <li>To invite enrolled students to a live class, use the lesson&apos;s <UI>Invite</UI> button.</li>
          </Bullets>
        </div>
      ),
    },
    {
      id: 'signups',
      title: 'Signups & user groups',
      summary: 'Choose how people join (open or invite-only), add signup fields, and use user groups to control access.',
      audience: ['admins'],
      keywords: ['signup', 'register', 'invite only', 'approval', 'user group', 'cohort', 'class'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>How people join</H4>
          <Defs>
            <Def term="Open signup">anyone can create an account and join.</Def>
            <Def term="Invite-only">only people you invite can join.</Def>
          </Defs>
          <P>
            With open signup you can add custom signup fields and require approval of new
            accounts from the <UI>Signups</UI> tab.
          </P>
          <H4>User groups</H4>
          <P>
            A user group is a named set of people — a cohort, a class, a department.
            Restrict a course to a group and only its members can see it. When someone buys
            an offer linked to a payment group, they can be added to a matching user group
            automatically (see{' '}
            <HelpLink ctx={ctx} to="payments/payment-groups">Payment groups</HelpLink>).
          </P>
          <Steps>
            <Step>Go to <UI>Users</UI> → <UI>User Groups</UI> and create a group.</Step>
            <Step>Add members.</Step>
            <Step>On a course&apos;s <UI>Access &amp; Pricing</UI> tab, restrict it to the group.</Step>
          </Steps>
        </div>
      ),
    },
  ],
}
