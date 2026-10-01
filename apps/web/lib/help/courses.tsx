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

export const courses: HelpCategory = {
  id: 'courses',
  title: 'Courses & lessons',
  icon: 'book',
  description: 'Build courses, write lessons in the editor, add video, and publish — plus how learners move through a course.',
  articles: [
    {
      id: 'create-course',
      title: 'Create a course',
      summary: 'Create a course from the dashboard, add chapters and activities, and publish it when it is ready.',
      audience: ['instructors'],
      keywords: ['new course', 'build', 'author', 'contributors', 'migrate', 'import'],
      content: (ctx) => (
        <div className="space-y-4">
          <Steps>
            <Step>
              Open the dashboard and go to{' '}
              <ProseLink href={appHref(ctx, '/dash/courses')}>Courses</ProseLink>.
            </Step>
            <Step>
              Click <UI>New Course</UI>. Give it a name, and optionally a description,
              thumbnail and tags.
            </Step>
            <Step>
              The course opens on its <UI>General</UI> tab. Use{' '}
              <UI>Content Structure</UI> to add chapters and activities.
            </Step>
            <Step>
              When it is ready, publish it from <UI>Access &amp; Pricing</UI> so learners
              can see it, and optionally set up SEO and certificates.
            </Step>
          </Steps>
          <Callout kind="tip" title="Nothing is public by accident">
            A new course is a draft. Only you and its contributors can see it until you
            publish it.
          </Callout>
          <H4>Working with others</H4>
          <P>
            Add co-authors from the <UI>Contributors</UI> tab. The editor is real-time, so
            you can work on the same page at once. To bring in material from another
            platform, use <UI>Course Migration</UI> under Courses in the dashboard.
          </P>
          <P>
            Want to teach it live as well? See{' '}
            <HelpLink ctx={ctx} to="livebridge/schedule-live-lesson">
              Schedule a live lesson
            </HelpLink>
            .
          </P>
        </div>
      ),
    },
    {
      id: 'course-settings',
      title: 'Course settings tabs',
      summary: 'What each tab of a course controls: general details, structure, access and pricing, contributors, SEO, certificates, LiveBridge and analytics.',
      audience: ['instructors'],
      keywords: ['settings', 'tabs', 'access', 'publish', 'private', 'draft', 'seo', 'certificate'],
      content: (ctx) => (
        <div className="space-y-4">
          <Table
            head={['Tab', 'What it controls']}
            rows={[
              [<strong key="g">General</strong>, 'Name, description, thumbnail, tags and other basics.'],
              [<strong key="c">Content Structure</strong>, 'Chapters and their activities — where you build the course.'],
              [<strong key="a">Access &amp; Pricing</strong>, 'Whether the course is published, and who can open it (everyone, or specific user groups).'],
              [<strong key="co">Contributors</strong>, 'Other people who can edit the course.'],
              [<strong key="s">SEO</strong>, 'Title, description and social preview for search engines and shared links.'],
              [<strong key="ce">Certificates</strong>, 'Whether completing the course issues a certificate, and its design.'],
              [<strong key="l">LiveBridge</strong>, 'Live lessons for this course, their recordings and attendance reports.'],
              [<strong key="an">Analytics</strong>, 'Engagement and completion data for this course.'],
            ]}
          />
          <H4>Visibility</H4>
          <Defs>
            <Def term="Public">listed in the catalogue for everyone in the organization.</Def>
            <Def term="Restricted to user groups">
              visible only to members of chosen groups — for cohorts, internal training or
              paid bundles.
            </Def>
            <Def term="Draft">not listed; only authors can open it.</Def>
          </Defs>
          <P>
            To charge for a course, create an offer for it — see{' '}
            <HelpLink ctx={ctx} to="payments/create-offer">
              Create an offer
            </HelpLink>
            .
          </P>
          <Callout kind="info" title="Missing a tab?">
            Tabs only appear if your role has the matching permission. Ask the course
            owner or an admin.
          </Callout>
        </div>
      ),
    },
    {
      id: 'chapters-and-activities',
      title: 'Chapters & activities',
      summary: 'Structure a course into chapters, add activities of different types, and reorder them by dragging.',
      audience: ['instructors'],
      keywords: ['chapter', 'module', 'activity', 'lesson', 'reorder', 'drag', 'scorm', 'pdf'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Courses are organized as <strong>course → chapters → activities</strong>.
          </P>
          <Steps>
            <Step>Open the course&apos;s <UI>Content Structure</UI> tab.</Step>
            <Step>Click <UI>Add chapter</UI>, name it and add an optional description.</Step>
            <Step>Inside a chapter, click <UI>Add activity</UI> and choose its type.</Step>
            <Step>Drag chapters and activities by their handles to reorder them.</Step>
            <Step>Click an activity to open it and add content.</Step>
          </Steps>
          <H4>Choosing an activity type</H4>
          <Bullets>
            <li><strong>Dynamic page</strong> — written, interactive content built in the block editor.</li>
            <li><strong>Video</strong> — upload a file or embed from YouTube.</li>
            <li><strong>Document</strong> — a PDF in the built-in viewer.</li>
            <li>
              <strong>Assignment</strong> — gradable work. See{' '}
              <HelpLink ctx={ctx} to="assessments/assignments-teaching">
                Create and grade assignments
              </HelpLink>
              .
            </li>
            <li><strong>SCORM</strong> — an uploaded SCORM package, where enabled for your organization.</li>
          </Bullets>
          <Callout kind="tip" title="Live lesson recordings land here too">
            Recordings of LiveBridge lessons are added to the course as video activities
            automatically.
          </Callout>
        </div>
      ),
    },
    {
      id: 'editor',
      title: 'The content editor',
      summary: 'Build pages from blocks: type “/” to insert text, media, quizzes, code playgrounds, callouts and more.',
      audience: ['instructors'],
      keywords: ['editor', 'block', 'slash command', 'format', 'collaboration', 'real-time', 'notion'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Dynamic pages are written in a block editor: each piece of content is a block
            you can move, duplicate or delete.
          </P>
          <H4>Insert a block</H4>
          <Steps>
            <Step>Click an empty line, or press <UI>Enter</UI> for a new one.</Step>
            <Step>Type <UI>/</UI> to open the block menu.</Step>
            <Step>Keep typing to filter, then choose a block and press <UI>Enter</UI>.</Step>
          </Steps>
          <H4>Block families</H4>
          <Defs>
            <Def term="Text">paragraph, headings, bulleted and numbered lists, code block.</Def>
            <Def term="Media">image, video, audio, PDF, web embed, link preview.</Def>
            <Def term="Interactive">
              quiz, code playground, magic (AI) block, math equation, flip card, scenarios,
              H5P.
            </Def>
            <Def term="Layout">info and warning callouts, badge, table, divider.</Def>
          </Defs>
          <H4>Arrange and format</H4>
          <Bullets>
            <li>Hover a block to reveal its handle; drag the handle to move it.</li>
            <li>The block menu offers duplicate, delete and block-specific options.</li>
            <li>Select text for bold, italic, links and inline code.</li>
          </Bullets>
          <H4>Write together in real time</H4>
          <P>
            When co-authors open the same page you see each other&apos;s cursors, and
            changes merge automatically.
          </P>
          <P>
            The editor also has an AI panel for drafting and improving content — see{' '}
            <HelpLink ctx={ctx} to="ai/ai-teaching-tools">
              AI tools for teaching
            </HelpLink>
            .
          </P>
          <Callout kind="warn" title="Wait for the save indicator">
            Content saves as you edit. Wait for the save indicator before closing the tab.
          </Callout>
        </div>
      ),
    },
    {
      id: 'video-and-captions',
      title: 'Video & AI captions',
      summary: 'Upload or embed video, and generate captions — and translations — for hosted videos with AI.',
      audience: ['instructors'],
      keywords: ['video', 'captions', 'subtitles', 'transcription', 'translate', 'accessibility', 'youtube'],
      content: () => (
        <div className="space-y-4">
          <P>
            Video activities host a file you upload or embed a YouTube video. For{' '}
            <strong>hosted videos</strong>, ValidBridge can generate captions with AI and
            translate them.
          </P>
          <Steps>
            <Step>
              In the new-video dialog, or when editing a hosted video, find{' '}
              <UI>AI Closed Captions</UI>.
            </Step>
            <Step>Turn on <UI>Generate with AI</UI>.</Step>
            <Step>Pick the spoken language, or leave it on <UI>Auto-detect</UI>.</Step>
            <Step>Choose the caption languages (including custom codes such as <UI>sw</UI> for Swahili).</Step>
            <Step>
              Click <UI>Generate captions</UI>. Each language moves through queued →
              processing → ready, then appears in the player&apos;s CC menu.
            </Step>
          </Steps>
          <P>
            Generation runs in the background, and long videos work just like short ones.
          </P>
          <Callout kind="info" title="Uses AI credits">
            Cost scales with video length and number of languages. If AI is off or credits
            have run out, you are told before anything is charged.
          </Callout>
          <Callout kind="warn" title="Review important captions">
            AI transcription can get names and technical terms wrong.
          </Callout>
        </div>
      ),
    },
    {
      id: 'course-player',
      title: 'Working through a course',
      summary: 'The activity view, marking activities complete, resuming where you left off, and leaving a course.',
      audience: ['learners'],
      keywords: ['learn', 'progress', 'complete', 'next', 'resume', 'continue', 'quit'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            A course shows its chapters and activities alongside the activity you are on.
            Follow the order or jump around.
          </P>
          <Bullets>
            <li><strong>Chapter list</strong> — completed activities are marked so you can see what is left.</li>
            <li><strong>Content area</strong> — the page, video, PDF or assignment itself.</li>
            <li><strong>Next / Previous</strong> — move through the course in order.</li>
            <li>
              <strong>Ask AI</strong> — opens the Copilot with this activity in context (see{' '}
              <HelpLink ctx={ctx} to="ai/ai-copilot">Ask AI</HelpLink>).
            </li>
            <li>
              <strong>Live lessons</strong> — upcoming and live classes for this course, and
              recordings of past ones.
            </li>
          </Bullets>
          <H4>Completing activities</H4>
          <P>
            Most activities complete when you finish them and use the completion control.
            Assignments complete when you submit them. A course is complete when every
            required activity is done.
          </P>
          <Callout kind="tip" title="Pick up where you left off">
            Open the course from <UI>My learning</UI> to jump back to where you were.
          </Callout>
          <H4>Leaving a course</H4>
          <P>
            From <UI>My learning</UI> you can remove a course from your Trail. This clears
            your progress for it.
          </P>
        </div>
      ),
    },
    {
      id: 'activity-types',
      title: 'Activity types explained',
      summary: 'Dynamic pages, video, documents, assignments and SCORM — what each looks like and how it completes.',
      audience: ['learners', 'instructors'],
      keywords: ['activity', 'page', 'video', 'pdf', 'document', 'scorm', 'flip card', 'scenario'],
      content: (ctx) => (
        <div className="space-y-4">
          <Table
            head={['Type', 'What you see', 'How it completes']}
            rows={[
              [<strong key="d">Dynamic page</strong>, 'Rich content: text, images, code, quizzes, callouts and embeds.', 'Read to the end and confirm.'],
              [<strong key="v">Video</strong>, 'A hosted or YouTube video, sometimes with AI captions. Live lesson recordings are videos too.', 'Watch and confirm.'],
              [<strong key="doc">Document</strong>, 'A PDF in a built-in viewer.', 'Read and confirm.'],
              [<strong key="a">Assignment</strong>, 'Gradable tasks — file upload, quiz, short answer, number, code, form or custom.', 'Submit your work.'],
              [<strong key="s">SCORM</strong>, 'An embedded SCORM 1.2 / 2004 package.', 'Tracked by the package.'],
            ]}
          />
          <H4>Interactive pages</H4>
          <Bullets>
            <li>Quizzes and flip cards give instant feedback.</li>
            <li>
              A <strong>Code Playground</strong> lets you write and run code — see{' '}
              <HelpLink ctx={ctx} to="assessments/code-exercises">Code exercises</HelpLink>.
            </li>
            <li><strong>Scenarios</strong> let you choose a path and see the outcome.</li>
          </Bullets>
        </div>
      ),
    },
  ],
}
