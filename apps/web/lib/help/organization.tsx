import type { HelpCategory } from './types'
import { P, H4, UI, HelpLink, ProseLink, Callout, Steps, Step, Table } from './prose'
import { helpHref } from './links'

export const organization: HelpCategory = {
  id: 'organization',
  title: 'Organization & branding',
  icon: 'buildings',
  description: 'Configure your workspace: settings and features, branding and landing page, and roles.',
  articles: [
    {
      id: 'org-settings',
      title: 'Organization settings',
      summary: 'Name, features, branding, menu, landing page, AI, usage and the danger zone — what each settings tab controls.',
      audience: ['admins'],
      keywords: ['settings', 'features', 'toggle', 'enable', 'disable', 'ai settings', 'delete organization'],
      content: () => (
        <div className="space-y-4">
          <P>Open <UI>Organization</UI> in the dashboard sidebar.</P>
          <Table
            head={['Tab', 'What it controls']}
            rows={[
              ['General', 'Name, slug, description, and which features are enabled.'],
              ['Branding', 'Logo, favicon, colours and font.'],
              ['Menu', 'Links in the learner sidebar and top navigation.'],
              ['Landing', 'A custom landing page for the organization home.'],
              ['AI', 'Turn AI on or off, cap requests per user, and toggle AI surfaces.'],
              ['Usage', 'Plan usage and limits.'],
              ['Other', 'Additional options such as signup and integrations.'],
              ['Danger zone', 'Irreversible actions such as deleting the organization.'],
            ]}
          />
          <H4>Feature toggles</H4>
          <P>
            Communities, podcasts, boards, playgrounds, payments, the library, analytics and
            other features are enabled per organization. A feature that is off disappears
            from the sidebar for everyone.
          </P>
          <Callout kind="warn" title="The danger zone is permanent">
            Deleting an organization removes its courses, users and data. Export what you
            need first.
          </Callout>
        </div>
      ),
    },
    {
      id: 'branding-and-landing',
      title: 'Branding & the landing page',
      summary: 'Make the workspace your own: logo, colour and font, the learner menu, and a custom landing page.',
      audience: ['admins'],
      keywords: ['brand', 'logo', 'colour', 'color', 'font', 'theme', 'white label', 'landing page', 'homepage', 'menu'],
      content: () => (
        <div className="space-y-4">
          <H4>Branding</H4>
          <P>
            Upload a logo and favicon, pick a primary colour and choose a font. The colour
            and font apply across your organization.
          </P>
          <H4>Menu</H4>
          <P>
            From <UI>Menu</UI>, reorder, rename or add links (including external URLs) in the
            learner sidebar and top navigation.
          </P>
          <H4>Landing page</H4>
          <P>
            By default the organization home is a course catalogue. From <UI>Landing</UI>{' '}
            you can build a custom page with sections and calls to action instead.
          </P>
          <Callout kind="tip" title="Start with three changes">
            A logo, a primary colour and a font make the platform feel like yours.
          </Callout>
        </div>
      ),
    },
    {
      id: 'roles-and-permissions',
      title: 'Roles & permissions',
      summary: 'The permission matrix behind each role, and how to create custom roles.',
      audience: ['admins'],
      keywords: ['roles', 'permissions', 'custom role', 'rbac', 'access control', 'least privilege'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            A role is a per-resource <strong>permission matrix</strong> covering courses,
            users, user groups, collections, the organization, chapters, activities, roles,
            the dashboard, communities, discussions, podcasts, boards and playgrounds. The
            four default roles are described in{' '}
            <HelpLink ctx={ctx} to="getting-started/accounts-and-roles">
              Accounts, roles &amp; permissions
            </HelpLink>
            .
          </P>
          <H4>Create a custom role</H4>
          <Steps>
            <Step>Go to <UI>Users</UI> → <UI>Roles</UI>.</Step>
            <Step>Create a role and name it.</Step>
            <Step>Toggle permissions per resource — e.g. allow editing course content but not managing access.</Step>
            <Step>Assign the role to people from the <UI>Users</UI> tab.</Step>
          </Steps>
          <Callout kind="tip" title="Least privilege">
            Give people the narrowest role that lets them do their job. A content writer
            does not need payments or user management.
          </Callout>
          <Callout kind="info" title="Course editors run live lessons">
            Anyone who can edit a course can schedule and run its LiveBridge lessons and see
            their reports.
          </Callout>
        </div>
      ),
    },
    {
      id: 'developers',
      title: 'The Developers area at a glance',
      summary: 'What each Developers page does — API access, automations, domains, SEO and SSO — which plan it needs, and where the full guides are.',
      audience: ['admins'],
      keywords: ['developers', 'developer tools', 'integrations'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            The <UI>Developers</UI> entry in the dashboard sidebar connects ValidBridge to
            your school&apos;s other systems. Each page has its own step-by-step guide:
          </P>
          <Table
            head={['Page', 'What it is for', 'Plan']}
            rows={[
              [<HelpLink key="a" ctx={ctx} to="integrations/api-access">API Access</HelpLink>, 'Tokens for your own software to sync students, enrolments and progress.', 'Pro and above'],
              [<HelpLink key="w" ctx={ctx} to="integrations/webhooks">Automations</HelpLink>, 'Send events to your systems, Zapier, Make or n8n.', 'Pro and above'],
              [<HelpLink key="d" ctx={ctx} to="integrations/custom-domains">Domains</HelpLink>, 'Serve your organization on your own address.', 'Pro and above'],
              [<HelpLink key="s" ctx={ctx} to="integrations/seo">SEO</HelpLink>, 'How you appear in search results and when shared.', 'Standard and above'],
              [<HelpLink key="o" ctx={ctx} to="integrations/single-sign-on">SSO</HelpLink>, 'Sign in with the school’s identity provider.', 'Enterprise'],
            ]}
          />
          <P>
            Everything is in the{' '}
            <ProseLink href={helpHref(ctx, 'integrations')}>Integrations &amp; developer tools</ProseLink>{' '}
            topic.
          </P>
        </div>
      ),
    },
  ],
}
