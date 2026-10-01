import type { HelpCategory } from './types'
import { P, H4, UI, HelpLink, Callout, Steps, Step, Bullets } from './prose'

export const analytics: HelpCategory = {
  id: 'analytics',
  title: 'Analytics',
  icon: 'chart',
  description: 'Understand how your organization, each course and each learner is doing — including live lesson attendance.',
  articles: [
    {
      id: 'analytics-admin',
      title: 'Organization analytics',
      summary: 'Engagement, course and growth metrics for the whole organization over 7, 30 or 90 days.',
      audience: ['admins'],
      keywords: ['analytics', 'reports', 'dashboard', 'metrics', 'usage', 'insights', 'kpi'],
      content: () => (
        <div className="space-y-4">
          <P>
            Open <UI>Analytics</UI> in the dashboard (under Insights) to see how the whole
            organization is used. Switch between 7, 30 and 90 day windows.
          </P>
          <Bullets>
            <li>User engagement — activity views, time spent and interaction patterns.</li>
            <li>Courses — the most popular courses and how learners progress through them.</li>
            <li>Organization — overall usage and growth.</li>
          </Bullets>
          <P>
            The <UI>Overview</UI> tab covers the essentials; <UI>Advanced</UI> adds deeper
            reporting.
          </P>
          <Callout kind="info" title="Recent activity can lag">
            Analytics data is cached for speed, so the last few minutes of activity may take
            a little while to appear.
          </Callout>
        </div>
      ),
    },
    {
      id: 'course-analytics',
      title: 'Course analytics',
      summary: 'Views, completion, drop-off points and assessment results for a single course.',
      audience: ['instructors'],
      keywords: ['course report', 'completion rate', 'drop off', 'engagement'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>Each course has an <UI>Analytics</UI> tab in the dashboard showing:</P>
          <Bullets>
            <li>Activity views and completion over time.</li>
            <li>Where learners stop or drop off.</li>
            <li>Assignment and quiz performance.</li>
          </Bullets>
          <P>
            Use it to find activities that need a clearer explanation. For live classes, the
            course&apos;s <UI>LiveBridge</UI> tab has attendance and participation — see{' '}
            <HelpLink ctx={ctx} to="livebridge/live-attendance-reports">
              Attendance and live lesson reports
            </HelpLink>
            .
          </P>
        </div>
      ),
    },
    {
      id: 'learner-analytics',
      title: 'Analytics for a single learner',
      summary: 'Open one student’s full record — courses, assignments, code, community, certificates, live lessons and behaviour — or compare and export several.',
      audience: ['admins', 'instructors'],
      keywords: ['student report', 'dossier', 'individual', 'export', 'compare students', 'progress report'],
      content: () => (
        <div className="space-y-4">
          <Steps>
            <Step>In the dashboard, go to <UI>Users</UI>.</Step>
            <Step>
              Click <UI>Analytics</UI> on a student&apos;s row to open their record, or open
              the full analytics page.
            </Step>
            <Step>
              Browse the tabs: connections, courses, assignments, code, community,
              certificates, <UI>LiveBridge</UI> (live lessons attended, attendance, live quiz
              scores and interactions) and behaviour.
            </Step>
          </Steps>
          <H4>Compare and export</H4>
          <P>
            Select several students in the list to <UI>Compare analytics</UI> side by side,
            or <UI>Export</UI> their analytics for reporting.
          </P>
        </div>
      ),
    },
  ],
}
