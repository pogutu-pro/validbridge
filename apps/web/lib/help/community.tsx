import type { HelpCategory } from './types'
import { P, H4, UI, ProseLink, Callout, Steps, Step, Bullets, Defs, Def } from './prose'
import { appHref } from './links'

export const community: HelpCategory = {
  id: 'community',
  title: 'Communities & content',
  icon: 'chats',
  description: 'Discussions, collaborative boards, podcasts, playgrounds and the shared library.',
  articles: [
    {
      id: 'discussions',
      title: 'Discussions & communities',
      summary: 'Post, reply, upvote and react in your organization’s communities; pin, lock and moderate threads.',
      audience: ['everyone'],
      keywords: ['forum', 'discussion', 'community', 'thread', 'comment', 'moderate', 'pin', 'lock', 'labels'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            <strong>Communities</strong> are spaces for conversation, questions and
            announcements, separate from course content.
          </P>
          <Steps>
            <Step>
              Open <UI>Communities</UI> in the sidebar (or{' '}
              <ProseLink href={appHref(ctx, '/connect')}>the communities page</ProseLink>).
            </Step>
            <Step>Pick a community, then open a discussion or start one.</Step>
            <Step>Reply, <strong>upvote</strong> helpful posts, or add an emoji reaction.</Step>
          </Steps>
          <Bullets>
            <li><strong>Labels</strong> categorise discussions so you can filter them.</li>
            <li><strong>Pinned</strong> discussions stay at the top.</li>
            <li><strong>Locked</strong> discussions are read-only.</li>
          </Bullets>
          <H4>Moderating</H4>
          <P>
            Instructors and admins can pin, lock and delete threads, and manage labels, from
            the Communities area of the dashboard.
          </P>
        </div>
      ),
    },
    {
      id: 'boards',
      title: 'Boards',
      summary: 'Infinite collaborative whiteboards for group work and workshops, with Owner, Editor and Viewer access.',
      audience: ['everyone'],
      keywords: ['whiteboard', 'canvas', 'sticky notes', 'brainstorm', 'miro', 'collaborate'],
      content: () => (
        <div className="space-y-4">
          <P>
            A <strong>board</strong> is an infinite canvas several people can edit at once.
            Changes appear live for everyone.
          </P>
          <Bullets>
            <li>Draw freehand and add shapes, sticky notes and to-do cards.</li>
            <li>Group content in frames.</li>
            <li>Drop in cards for web pages, YouTube videos, podcasts, course activities and playgrounds.</li>
          </Bullets>
          <H4>Create a board (instructors)</H4>
          <Steps>
            <Step>Go to <UI>Boards</UI> in the dashboard and create a board.</Step>
            <Step>Name it, set a thumbnail, and build the canvas.</Step>
            <Step>Add members as <strong>Owner</strong>, <strong>Editor</strong> or <strong>Viewer</strong>.</Step>
          </Steps>
          <Callout kind="info" title="Stuck on “connecting”?">
            Live sync is briefly unavailable. Wait a moment and reload.
          </Callout>
        </div>
      ),
    },
    {
      id: 'podcasts',
      title: 'Podcasts',
      summary: 'Publish audio series with episodes; learners listen with a mini-player or any podcast app via RSS.',
      audience: ['everyone'],
      keywords: ['audio', 'episode', 'rss', 'listen', 'spotify', 'apple podcasts'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>Listening</H4>
          <P>
            Browse <ProseLink href={appHref(ctx, '/podcasts')}>Podcasts</ProseLink>,
            open one and press play. A mini-player keeps playing while you move around.
            Each podcast also has an RSS feed for your favourite podcast app.
          </P>
          <H4>Publishing (instructors)</H4>
          <Steps>
            <Step>Go to <UI>Podcasts</UI> in the dashboard and create a podcast with a name, description and cover.</Step>
            <Step>Add episodes and upload their audio.</Step>
            <Step>Reorder episodes to set the listening order.</Step>
          </Steps>
          <P>
            You can submit the RSS feed to directories such as Apple Podcasts or Spotify
            yourself; ValidBridge does not publish there for you.
          </P>
        </div>
      ),
    },
    {
      id: 'playgrounds',
      title: 'Playgrounds (Labs)',
      summary: 'Interactive AI-generated simulations and widgets that support a lesson.',
      audience: ['everyone'],
      keywords: ['labs', 'simulation', 'interactive', 'widget', 'html'],
      content: () => (
        <div className="space-y-4">
          <P>
            <strong>Playgrounds</strong> are interactive web experiences — simulations,
            visualisations and widgets — that instructors generate with AI. Find them under{' '}
            <UI>Playgrounds</UI> (or <UI>Labs</UI>) and react to give the author feedback.
          </P>
          <Callout kind="info" title="Not the Code Playground">
            The <strong>Code Playground</strong> is the code editor block inside a lesson.
          </Callout>
        </div>
      ),
    },
    {
      id: 'content-areas',
      title: 'The Library and other content areas',
      summary: 'Where reusable resources live, and how content areas are switched on per organization.',
      audience: ['instructors', 'admins'],
      keywords: ['library', 'files', 'resources', 'assets', 'folders'],
      content: () => (
        <div className="space-y-4">
          <Defs>
            <Def term="Library">folders of reusable files and resources you can reference from courses.</Def>
            <Def term="Communities">discussion spaces.</Def>
            <Def term="Podcasts">audio series.</Def>
            <Def term="Boards">collaborative canvases.</Def>
            <Def term="Playgrounds">AI-generated interactive experiences.</Def>
          </Defs>
          <P>
            Each area is enabled per organization in <UI>Organization</UI> settings and
            appears in the sidebar when on.
          </P>
          <Callout kind="tip" title="Reuse, don’t duplicate">
            Keep shared handouts and diagrams in the Library instead of uploading them to
            every course.
          </Callout>
        </div>
      ),
    },
  ],
}
