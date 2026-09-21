import type { HelpSection } from './types'
import {
  P,
  H4,
  UI,
  ProseLink,
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
import { getUriWithOrg } from '@services/config/config'

export const teaching: HelpSection = {
  id: 'teaching',
  title: 'Teaching',
  icon: 'chalkboard',
  tagline: 'Build courses, author content, create assignments, and use the AI authoring tools.',
  subsections: [
    {
      id: 'create-course',
      title: 'Creating a course',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Creating a course takes a minute. You will then fill it with chapters and
            activities in the structure editor.
          </P>
          <Steps>
            <Step>
              Open the dashboard and go to{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/dash/courses')}>
                Courses
              </ProseLink>
              .
            </Step>
            <Step>
              Click <UI>New Course</UI>. Give it a name (and optionally a description,
              thumbnail and tags).
            </Step>
            <Step>
              The new course opens on its <UI>General</UI> tab. Use the{' '}
              <UI>Content</UI> tab to add chapters and activities.
            </Step>
            <Step>
              When it is ready, set its <UI>Access</UI> to published so learners can see
              it, and (optionally) configure SEO and certification.
            </Step>
          </Steps>
          <Callout kind="tip" title="Courses can be private while you build">
            A course starts as a draft. Only you and its contributors can see it until you
            publish it. Nothing is visible to learners by accident.
          </Callout>
          <H4>Contributors</H4>
          <P>
            You can add other people as contributors from the <UI>Contributors</UI> tab.
            Contributors can edit the course alongside you — and because the editor is
            real-time, you can both work in it at once. You can also import a course from
            another platform from the <UI>Migrate</UI> area.
          </P>
        </div>
      ),
    },
    {
      id: 'course-settings',
      title: 'Course settings tabs',
      content: () => (
        <div className="space-y-4">
          <P>
            Every course has a set of tabs along the top of its dashboard page. Each tab
            controls one aspect of the course.
          </P>
          <Table
            head={['Tab', 'What it controls']}
            rows={[
              [
                <strong key="g">General</strong>,
                'Name, description, thumbnail, tags, and other basics.',
              ],
              [
                <strong key="c">Content</strong>,
                'The structure: chapters and their activities. This is where you build the course.',
              ],
              [
                <strong key="a">Access</strong>,
                'Who can see and open the course — public, private to user groups, or restricted.',
              ],
              [
                <strong key="co">Contributors</strong>,
                'Other people who can edit the course, and their permissions.',
              ],
              [
                <strong key="s">SEO</strong>,
                'Title, description and social preview used by search engines and link previews.',
              ],
              [
                <strong key="ce">Certification</strong>,
                'Whether completing the course issues a certificate, and the certificate design.',
              ],
              [
                <strong key="an">Analytics</strong>,
                'Engagement and completion data for this course.',
              ],
            ]}
          />
          <H4>Access and publishing</H4>
          <Defs>
            <Def term="Public">
              listed in the catalogue and open to everyone in the organization.
            </Def>
            <Def term="Private / group-restricted">
              visible only to members of chosen user groups — useful for cohorts, paid
              bundles, or internal training.
            </Def>
            <Def term="Draft">
              not listed at all; only authors can open it.
            </Def>
          </Defs>
          <Callout kind="info" title="Permissions per tab">
            Tabs are shown only if your role has the matching permission (for example, a
            contributor may see <UI>Content</UI> but not <UI>Access</UI>). If a tab is
            missing, ask the course owner to grant it.
          </Callout>
        </div>
      ),
    },
    {
      id: 'chapters-and-activities',
      title: 'Chapters & activities',
      content: () => (
        <div className="space-y-4">
          <P>
            The <UI>Content</UI> tab shows the course outline. Courses are{' '}
            <strong>course → chapters → activities</strong>.
          </P>
          <H4>Adding and arranging</H4>
          <Steps>
            <Step>
              Click <UI>Add chapter</UI> to create a module. Name it and add an optional
              description.
            </Step>
            <Step>
              Inside a chapter, click <UI>Add activity</UI> and choose its type (dynamic
              page, video, document, assignment, SCORM or custom).
            </Step>
            <Step>
              Drag chapters and activities by their handles to reorder them. Learners see
              the order you set.
            </Step>
            <Step>
              Click an activity to open its editor and start adding content.
            </Step>
          </Steps>
          <H4>Choosing the right activity type</H4>
          <Bullets>
            <li>
              <strong>Dynamic page</strong> — for anything written and interactive. It
              uses the block editor and can contain quizzes, code blocks, media and
              embeds.
            </li>
            <li>
              <strong>Video</strong> — upload a file or embed from YouTube.
            </li>
            <li>
              <strong>Document</strong> — a PDF shown in the built-in viewer.
            </li>
            <li>
              <strong>Assignment</strong> — a gradable task. See{' '}
              <a className="font-medium text-primary underline" href="#assignments-teaching">
                Assignments
              </a>
              .
            </li>
            <li>
              <strong>SCORM</strong> — an uploaded SCORM package (Enterprise).
            </li>
          </Bullets>
          <Callout kind="tip" title="Mix and match">
            A single chapter can combine reading, video, practice and a graded assignment.
            That variety keeps learners engaged and covers different learning styles.
          </Callout>
        </div>
      ),
    },
    {
      id: 'editor',
      title: 'The content editor',
      content: () => (
        <div className="space-y-4">
          <P>
            Dynamic pages are built in a block editor — a Notion-style surface where each
            piece of content is an independent block you can move, duplicate or delete.
          </P>
          <H4>Inserting a block</H4>
          <Steps>
            <Step>Click an empty line, or press <UI>Enter</UI> for a new block.</Step>
            <Step>
              Type <UI>/</UI> (slash) to open the block menu.
            </Step>
            <Step>Keep typing to filter, then choose a block and press <UI>Enter</UI>.</Step>
          </Steps>
          <H4>Block families</H4>
          <Defs>
            <Def term="Text">
              paragraph, headings 1–6, bulleted and numbered lists, code block.
            </Def>
            <Def term="Media">
              image, video, audio, PDF, web embed, link preview.
            </Def>
            <Def term="Interactive">
              quiz, code playground, magic (AI) block, math equation, flip card,
              scenarios, H5P.
            </Def>
            <Def term="Layout / UI">
              info and warning callouts, badge, table, divider.
            </Def>
          </Defs>
          <H4>Editing and arranging blocks</H4>
          <Bullets>
            <li>
              Hover a block to reveal its <strong>handle</strong> on the left. Drag the
              handle to move the block.
            </li>
            <li>
              The block menu (the <UI>+</UI> / <UI>⋮⋮</UI> control) offers duplicate,
              delete, and block-specific options.
            </li>
            <li>
              Select text to apply bold, italic, links and inline code from the floating
              toolbar.
            </li>
            <li>
              Type <UI>---</UI> on its own line to insert a divider.
            </li>
          </Bullets>
          <H4>Real-time collaboration</H4>
          <P>
            If you and a co-author open the same page, you can both edit at once. You will
            see each other's cursors and selections, and changes merge without conflicts.
            This is powered by the collaboration server, so collaborative editing stays
            live only while that server is running.
          </P>
          <H4>The AI side panel</H4>
          <P>
            The editor has an AI panel for working on the page you are in. Ask it to
            improve clarity, expand a section, add examples, or generate a quiz — it reads
            your content and proposes changes you can accept. See{' '}
            <a className="font-medium text-primary underline" href="#ai-teaching-tools">
              AI tools for teaching
            </a>
            .
          </P>
          <Callout kind="warn" title="Save your work">
            Content saves as you edit, but wait for the save indicator before closing the
            tab. If collaborative editing is stuck on &ldquo;connecting&rdquo;, your
            changes still save locally through the normal save path.
          </Callout>
        </div>
      ),
    },
    {
      id: 'video-and-captions',
      title: 'Video & AI captions',
      content: () => (
        <div className="space-y-4">
          <P>
            Video activities can host a file you upload or embed a YouTube video. For{' '}
            <strong>hosted videos</strong>, ValidBridge can generate closed captions with
            AI and translate them into languages you choose.
          </P>
          <H4>Generating captions</H4>
          <Steps>
            <Step>
              In the new-video dialog (or by editing an existing hosted-video activity),
              find the <UI>AI Closed Captions</UI> panel.
            </Step>
            <Step>Turn on <UI>Generate with AI</UI>.</Step>
            <Step>
              Pick the <strong>spoken language</strong>, or leave it on{' '}
              <UI>Auto-detect</UI>.
            </Step>
            <Step>
              Choose the <strong>caption languages</strong> — any built-in language, plus
              custom codes such as <UI>sw</UI> for Swahili.
            </Step>
            <Step>
              Click <UI>Generate captions</UI>. Each language moves through{' '}
              <strong>queued → processing → ready</strong>, and appears in the player's
              CC menu when done.
            </Step>
          </Steps>
          <P>
            Generation runs in the background — you can close the editor and come back
            later. Long videos are transcribed in segments and stitched together, so a
            two-hour lecture works like a two-minute clip.
          </P>
          <Callout kind="info" title="Captions cost AI credits">
            Cost scales with video length and the number of languages requested. If AI is
            disabled or credits have run out, you will be told when you try — nothing is
            charged.
          </Callout>
          <Callout kind="warn" title="Review before relying on them">
            AI transcription and translation can contain mistakes, especially names and
            technical terms. Review accessibility-critical captions.
          </Callout>
        </div>
      ),
    },
    {
      id: 'assignments-teaching',
      title: 'Assignments & grading',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Assignments are gradable activities. You build them from tasks, set an
            optional deadline, and grade submissions from the dashboard.
          </P>
          <H4>Creating an assignment</H4>
          <Steps>
            <Step>
              Add an activity of type <strong>Assignment</strong> to a chapter, or open{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/dash/assignments')}>
                Assignments
              </ProseLink>{' '}
              in the dashboard.
            </Step>
            <Step>Give it a title, description and optional due date.</Step>
            <Step>
              Add one or more <strong>tasks</strong> and configure each. Tasks can have
              their own instructions and points.
            </Step>
            <Step>
              Set the grading scale, whether retries are allowed, and whether the
              assignment is graded or formative.
            </Step>
            <Step>Publish it with the rest of the course.</Step>
          </Steps>
          <H4>Task types</H4>
          <Table
            head={['Task', 'Learner does', 'Grading']}
            rows={[
              ['File upload', 'Attaches one or more files.', 'Manual'],
              ['Quiz', 'Answers multiple-choice questions.', 'Automatic'],
              ['Short answer', 'Types a text answer.', 'Automatic against an answer key, or manual'],
              ['Number answer', 'Enters a number.', 'Automatic against expected value and tolerance'],
              ['Code', 'Writes code run against test cases.', 'Automatic'],
              ['Form', 'Fills in a structured form you define.', 'Manual or automatic'],
              ['Custom', 'Anything your data object defines.', 'Depends on the implementation'],
            ]}
          />
          <H4>Grading scale</H4>
          <Defs>
            <Def term="Numeric">a raw score, e.g. 87 / 100.</Def>
            <Def term="Percentage">a score expressed as a percentage.</Def>
            <Def term="Alphabet">letter grades, A–F.</Def>
          </Defs>
          <H4>Reviewing submissions</H4>
          <Numbers>
            <li>
              Open the assignment and switch to <UI>Submissions</UI>.
            </li>
            <li>
              Filter by student or task. Each row shows its status (not submitted, pending,
              submitted, late, graded).
            </li>
            <li>
              Open a submission to see the learner's work. Automatic tasks are already
              scored; grade manual tasks per task.
            </li>
            <li>
              Finalise the grade. The aggregate is recorded in the learner's Trail.
            </li>
          </Numbers>
          <H4>Formative (ungraded) assignments</H4>
          <P>
            Turn on <UI>Formative — no grading</UI> in the assignment's edit dialog. The
            grading scale, auto-grading and passing threshold disappear. Instead you write
            a <strong>model answer</strong> (and can attach a document) and choose when it
            unlocks: <strong>Never</strong>, <strong>On hand-in</strong>, or{' '}
            <strong>After grading</strong>. The model answer is withheld server-side until
            the learner earns it, and the API refuses to grade a formative assignment.
          </P>
          <H4>Deadlines and retries</H4>
          <P>
            A deadline closes the assignment to submissions, edits and retries. Leave it
            empty for self-paced courses. Retries can be enabled so learners can resubmit
            before the deadline.
          </P>
          <Jump href={`${getUriWithOrg(orgslug, '/help')}#assignments-learner`} label="What learners see for assignments" />
        </div>
      ),
    },
    {
      id: 'ai-teaching-tools',
      title: 'AI tools for teaching',
      content: () => (
        <div className="space-y-4">
          <P>
            ValidBridge puts AI to work while you author. Everything below reads your
            course material, so output stays on-topic.
          </P>
          <H4>In the editor</H4>
          <Bullets>
            <li>
              <strong>Draft content</strong> — ask the AI panel to write or expand a
              section from a prompt or outline.
            </li>
            <li>
              <strong>Improve content</strong> — request clarity, tone, or completeness
              edits and accept the changes you like.
            </li>
            <li>
              <strong>Generate quizzes</strong> — create quiz questions from the material.
            </li>
            <li>
              <strong>Magic block</strong> — insert an AI-generated interactive element
              inline.
            </li>
          </Bullets>
          <H4>Images and audio</H4>
          <P>
            Generate images for activities, and turn text into audio from the{' '}
            <strong>Audio</strong> block's <UI>Generate</UI> tab. Three modes are
            available:
          </P>
          <Defs>
            <Def term="Text to speech">narrate text you write, in a voice of your choice.</Def>
            <Def term="Podcast (2 voices)">
              give a topic or source material and the AI writes a two-host discussion you
              can edit before generating.
            </Def>
            <Def term="Speak">
              give a subject and the AI writes and narrates a single-speaker talk.
            </Def>
          </Defs>
          <P>
            For the last two you can choose length, language and tone. The script is fully
            editable before you produce the audio, and the result is saved to the activity
            like any uploaded file.
          </P>
          <H4>Playgrounds</H4>
          <P>
            Generate interactive HTML experiences from a prompt — simulations,
            visualisations, widgets. Refine a playground up to 10 times, each version
            tracked. Set its access to public, authenticated, or restricted to specific
            user groups.
          </P>
          <Callout kind="info" title="AI credits">
            AI features are metered per organization. Free organizations start with{' '}
            <strong>20 credits</strong> to try things out; writing a script costs 1 credit
            and narrating it 3. When credits run low the app prompts an upgrade.
          </Callout>
          <Callout kind="warn" title="You are responsible for what you publish">
            Always review AI-generated content for accuracy, tone and appropriateness
            before learners see it.
          </Callout>
        </div>
      ),
    },
    {
      id: 'boards-teaching',
      title: 'Boards (authoring)',
      content: () => (
        <div className="space-y-4">
          <P>
            Create boards for group work, brainstorming and live workshops. A board is an
            infinite canvas that several people can edit at once.
          </P>
          <Steps>
            <Step>
              Go to <UI>Boards</UI> in the dashboard and click <UI>New board</UI>.
            </Step>
            <Step>Name it and set a thumbnail.</Step>
            <Step>
              Open it and build the canvas: draw, add sticky notes and to-do cards, and
              arrange items in frames.
            </Step>
            <Step>
              Add members and set each one's role — Owner, Editor or Viewer.
            </Step>
            <Step>
              Share the board with a group or attach it to a course as a resource.
            </Step>
          </Steps>
          <H4>Embedding resources</H4>
          <P>
            Drop cards onto the canvas for webpages, YouTube videos, podcasts, course
            activities, AI playgrounds and other ValidBridge content. These stay live — a
            linked activity or video can be opened straight from the board.
          </P>
          <Callout kind="tip" title="Frames keep it tidy">
            Use frames to group a topic or an exercise. They make a large canvas readable
            and help learners focus.
          </Callout>
        </div>
      ),
    },
    {
      id: 'podcasts-teaching',
      title: 'Podcasts (authoring)',
      content: () => (
        <div className="space-y-4">
          <P>
            Build audio series for lecture recordings, interviews, or audio-first courses.
          </P>
          <Steps>
            <Step>
              Go to <UI>Podcasts</UI> in the dashboard and create a podcast with a name,
              description and thumbnail.
            </Step>
            <Step>Add episodes and upload their audio.</Step>
            <Step>Reorder episodes to control the listening order.</Step>
            <Step>
              Share the podcast. Learners stream episodes with a persistent mini-player.
            </Step>
          </Steps>
          <P>
            Every podcast exposes a standard RSS feed at <UI>/podcast/&#123;shortUuid&#125;/feed</UI>{' '}
            that you can submit to Apple Podcasts, Spotify and other directories. Note
            that ValidBridge does not publish to those services for you.
          </P>
        </div>
      ),
    },
    {
      id: 'course-analytics',
      title: 'Course analytics',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Each course has an <UI>Analytics</UI> tab showing how learners engage with it.
          </P>
          <Bullets>
            <li>Activity views and completion over time.</li>
            <li>Where learners stop or drop off.</li>
            <li>Assignment and quiz performance.</li>
          </Bullets>
          <P>
            Use it to find activities that need clearer explanation and to see whether the
            course is being finished. Data is cached briefly, so very recent activity may
            take a short while to appear.
          </P>
          <Jump href={`${getUriWithOrg(orgslug, '/help')}#analytics-admin`} label="Organization-wide analytics" />
        </div>
      ),
    },
  ],
}