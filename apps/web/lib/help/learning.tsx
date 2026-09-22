import type { HelpSection } from './types'
import {
  P,
  H4,
  UI,
  Kbd,
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

export const learning: HelpSection = {
  id: 'learning',
  title: 'Learning',
  icon: 'graduation',
  tagline: 'Everything a learner does: courses, activities, assignments, the Genie, and more.',
  subsections: [
    {
      id: 'browse-and-enrol',
      title: 'Browsing & enrolling in courses',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Courses are the heart of ValidBridge. Where you find them depends on how your
            organization has set things up, but the paths below cover every case.
          </P>
          <Defs>
            <Def term="Organization home">
              the landing page, at{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/')}>
                the organization root
              </ProseLink>
              . It shows the course catalogue, or a custom landing page if an admin has
              built one.
            </Def>
            <Def term="Courses page">
              the full catalogue, from <UI>Courses</UI> in the sidebar.
            </Def>
            <Def term="Collections">
              named groups of related courses — a learning path or curriculum. Open a
              collection to see its courses in order.
            </Def>
            <Def term="Marketplace">
              paid courses your organization sells, listed with prices. Available when
              payments are enabled.
            </Def>
          </Defs>
          <H4>To enrol in a course</H4>
          <Steps>
            <Step>
              Find the course from the organization home, the <UI>Courses</UI> page, a
              collection, search, or the marketplace.
            </Step>
            <Step>
              Open the course. You will see its description, chapters and activities.
            </Step>
            <Step>
              Click <UI>Enrol</UI> (or <UI>Start learning</UI>). For a free course this
              is instant. For a paid course, continue to checkout — see{' '}
              <a className="font-medium text-primary underline" href="#paid-courses">
                Paid courses
              </a>
              .
            </Step>
            <Step>
              The course is added to your <UI>My learning</UI> (Trail), and the first
              activity opens.
            </Step>
          </Steps>
          <Callout kind="info" title="Courses may be hidden">
            A course can be a <strong>draft</strong> (visible only to its authors) or{' '}
            <strong>private</strong> (restricted to specific user groups). If a course
            does not appear, it may simply not be published yet, or your account may not
            be in a group that can see it.
          </Callout>
          <div className="space-y-2" id="paid-courses">
            <H4>Paid courses</H4>
            <P>
              If the organization sells courses, an offer appears on the course page or
              in the marketplace. Selecting it takes you to a secure Stripe checkout.
              When payment succeeds, an <strong>enrollment</strong> is created
              automatically and the course unlocks immediately. Subscriptions keep
              access while they are active; you can manage your payment method and
              invoices from the Stripe billing portal.
            </P>
          </div>
        </div>
      ),
    },
    {
      id: 'course-player',
      title: 'Working through a course',
      content: () => (
        <div className="space-y-4">
          <P>
            Opening a course shows its structure: chapters on one side, the current
            activity in the main area. Work through activities in any order, or follow
            the sequence.
          </P>
          <H4>The activity view</H4>
          <Bullets>
            <li>
              <strong>Chapter list</strong> — every chapter and its activities. Completed
              activities are marked so you can see what is left.
            </li>
            <li>
              <strong>Content area</strong> — the activity itself. Depending on its type
              this is a rich page, a video player, a PDF viewer, or an assignment.
            </li>
            <li>
              <strong>Next / Previous</strong> — move linearly through the course without
              going back to the list.
            </li>
            <li>
              <strong>Ask AI</strong> — opens Genie with this activity already in
              context. See{' '}
              <a className="font-medium text-primary underline" href="#ai-copilot">
                Ask AI
              </a>
              .
            </li>
          </Bullets>
          <H4>Marking an activity complete</H4>
          <P>
            Most activities complete when you finish reading or interacting with them —
            scroll to the end and use the completion control. Assignments complete when
            you submit them. Completion is recorded in your Trail, and a course is
            complete when every required activity is done.
          </P>
          <Callout kind="tip" title="Resume where you left off">
            Your Trail remembers your position. From <UI>My learning</UI>, open a course
            to jump back to the activity you were on.
          </Callout>
          <H4>Leaving a course</H4>
          <P>
            From <UI>My learning</UI> you can remove a course from your Trail (there is
            also a &ldquo;quit all&rdquo; action). Removing a course clears your progress
            for it — re-enrol later to start fresh.
          </P>
        </div>
      ),
    },
    {
      id: 'activity-types',
      title: 'Activity types explained',
      content: () => (
        <div className="space-y-4">
          <P>
            An activity is one item inside a chapter. Each type presents content
            differently:
          </P>
          <Table
            head={['Type', 'What you see', 'How it completes']}
            rows={[
              [
                <strong key="d">Dynamic page</strong>,
                'Rich content built with the block editor: text, images, code, quizzes, callouts and embeds.',
                'Read to the end and confirm completion.',
              ],
              [
                <strong key="v">Video</strong>,
                'A hosted video player, or an embedded YouTube video. Hosted videos may offer AI-generated captions.',
                'Watch to the end / confirm completion.',
              ],
              [
                <strong key="doc">Document</strong>,
                'A PDF shown in a built-in viewer, no download required.',
                'Read to the end / confirm completion.',
              ],
              [
                <strong key="a">Assignment</strong>,
                'A gradable task — file upload, quiz, short answer, number, code, form, or a custom type.',
                'Submit your work (or receive the model answer in formative mode).',
              ],
              [
                <strong key="s">SCORM</strong>,
                'A SCORM 1.2 / 2004 package embedded from an uploaded package (Enterprise).',
                'Tracked by the SCORM package.',
              ],
            ]}
          />
          <Callout kind="info" title="Two kinds of quiz">
            A <strong>Quiz block</strong> inside a dynamic page is a lightweight,
            ungraded knowledge check. A <strong>Quiz task</strong> inside an assignment
            is gradable and stored as a submission. The activity view will tell you which
            one you are looking at.
          </Callout>
          <H4>Interacting with a dynamic page</H4>
          <Bullets>
            <li>Quizzes and flip cards respond to clicks and give instant feedback.</li>
            <li>
              A <strong>Code Playground</strong> block gives you an editor to write and
              run code — see{' '}
              <a className="font-medium text-primary underline" href="#code-exercises">
                Code exercises
              </a>
              .
            </li>
            <li>
              <strong>Scenarios</strong> let you choose a path and see the outcome of each
              choice.
            </li>
            <li>Math equations render properly, and embeds load in place.</li>
          </Bullets>
        </div>
      ),
    },
    {
      id: 'assignments-learner',
      title: 'Assignments (for learners)',
      content: () => (
        <div className="space-y-4">
          <P>
            An assignment is a gradable activity. It contains one or more{' '}
            <strong>tasks</strong>, and you may be able to retry it if your instructor
            allows.
          </P>
          <H4>The task types you may meet</H4>
          <Defs>
            <Def term="File upload">attach a file (document, image, archive).</Def>
            <Def term="Quiz">
              multiple-choice or multiple-answer questions, scored automatically.
            </Def>
            <Def term="Short answer">
              type a text answer; the instructor may auto-grade against an answer key.
            </Def>
            <Def term="Number answer">
              enter a numeric value, checked against an expected answer and tolerance.
            </Def>
            <Def term="Code">
              write code that is run against test cases, like a Code Playground.
            </Def>
            <Def term="Form">
              a structured form defined by your instructor.
            </Def>
            <Def term="Custom">
              a bespoke task type your organization has built.
            </Def>
          </Defs>
          <H4>Submitting an assignment</H4>
          <Steps>
            <Step>Open the assignment activity from the course.</Step>
            <Step>
              Complete each task. Your work <strong>autosaves</strong> as you go, so you
              can leave and come back.
            </Step>
            <Step>
              Click <UI>Submit</UI>. Before the deadline you can edit and resubmit if the
              instructor allows retries.
            </Step>
            <Step>
              Once graded, open the assignment to see your score per task and any
              feedback. Your grade appears in your Trail.
            </Step>
          </Steps>
          <H4>Deadlines and late work</H4>
          <P>
            A due date is optional. If one is set, the assignment closes when it passes —
            you will be warned before saving stops working. Late submissions are flagged
            to the instructor.
          </P>
          <H4>Formative assignments (no grade)</H4>
          <P>
            Some assignments are set to <strong>formative</strong> mode: there is no
            score. Instead, submitting your work unlocks the <strong>model answer</strong>{' '}
            (and sometimes a document) so you can compare your work and self-assess.
            Before you hand in, the model answer is locked and hidden.
          </P>
          <Callout kind="tip" title="Submission statuses">
            <strong>Not submitted</strong> → <strong>Pending</strong> (saved, not handed
            in) → <strong>Submitted</strong> → <strong>Late</strong> if past the deadline
            → <strong>Graded</strong>.
          </Callout>
        </div>
      ),
    },
    {
      id: 'code-exercises',
      title: 'Code exercises',
      content: () => (
        <div className="space-y-4">
          <P>
            When a dynamic page contains a <strong>Code Playground</strong> block, you
            get an in-browser code editor. Write your solution, then run it against the
            test cases your instructor defined.
          </P>
          <H4>Running your code</H4>
          <Steps>
            <Step>Choose the language from the block (the exercise usually preselects it).</Step>
            <Step>Write your solution in the editor.</Step>
            <Step>
              Click <UI>Run</UI> to execute it. Each test case reports pass/fail, plus
              execution time and memory usage.
            </Step>
            <Step>
              Fix and re-run until every test passes. Your submission is saved against the
              activity and block.
            </Step>
          </Steps>
          <P>
            Code runs in a sandboxed Judge0 environment, so it cannot affect the platform
            or other users. Thirty languages are supported, including Python,
            JavaScript, TypeScript, Java, C, C++, Rust, Go, C#, Ruby, PHP, SQL, Bash and
            more.
          </P>
          <Callout kind="info" title="Code Playground vs. assignment code task">
            A Code Playground block lives inside a dynamic page. A <strong>Code</strong>{' '}
            task lives inside an assignment and is part of that assignment's grade. Both
            use the same editor and runner.
          </Callout>
        </div>
      ),
    },
    {
      id: 'ai-copilot',
      title: 'Ask AI (the Genie)',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            The <strong>AI Genie</strong> is your on-demand tutor. It is powered by
            Google Gemini and, crucially, it reads the course material you are looking at
            — so its answers are grounded in your actual lessons rather than generic
            knowledge.
          </P>
          <H4>Opening Genie</H4>
          <Bullets>
            <li>
              From an activity, click <UI>Ask AI</UI> in the activity view. Genie
              opens in a drawer on the right with the activity in context.
            </li>
            <li>
              From anywhere in the organization, open the full-page Genie from the
              sidebar or go to <ProseLink href={getUriWithOrg(orgslug, '/copilot')}>the Genie page</ProseLink>.
              There it can reason over all of your courses.
            </li>
          </Bullets>
          <H4>Two context modes</H4>
          <Defs>
            <Def term="Activity mode">
              opened from an activity. The assistant knows that activity's content, so it
              can explain, summarise, quiz you, and answer follow-ups about it.
            </Def>
            <Def term="Course-only mode">
              opened from the full-page Genie. It searches across your enrolled courses
              to answer broader questions and build study plans.
            </Def>
          </Defs>
          <H4>What to ask</H4>
          <Bullets>
            <li>&ldquo;Explain this activity in simpler terms.&rdquo;</li>
            <li>&ldquo;Summarise this lesson as five bullet points.&rdquo;</li>
            <li>&ldquo;Create flashcards from this material.&rdquo;</li>
            <li>&ldquo;Quiz me on what I have learned so far.&rdquo;</li>
            <li>&ldquo;Build me a study plan for this course.&rdquo;</li>
          </Bullets>
          <H4>Sources and follow-ups</H4>
          <P>
            When Genie uses your course material, it shows the sources it drew on.
            Click a source to jump to that activity. After each answer it also suggests
            follow-up questions you can tap.
          </P>
          <Callout kind="info" title="If Genie is unavailable">
            AI features can be switched off for the whole organization, or the
            organization may have run out of AI credits. If you do not see{' '}
            <UI>Ask AI</UI>, that is why. An admin can enable it in organization
            settings.
          </Callout>
          <Callout kind="warn" title="Always check important answers">
            AI can be confidently wrong. Treat its output as a study aid, not a source of
            truth, especially for facts and figures.
          </Callout>
        </div>
      ),
    },
    {
      id: 'trail-and-certificates',
      title: 'Your Trail, progress & certificates',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            The <strong>Trail</strong> is your personal progress record. It is created
            automatically the first time you start a course and updated as you work.
          </P>
          <H4>What the Trail shows</H4>
          <Bullets>
            <li>Every course you have started, with a completion bar.</li>
            <li>Which activities you have completed.</li>
            <li>Your assignment and quiz results.</li>
            <li>Certificates you have earned.</li>
          </Bullets>
          <H4>Opening it</H4>
          <Numbers>
            <li>
              Click <UI>My learning</UI> in the left sidebar, or go to{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/trail')}>your Trail</ProseLink>.
            </li>
            <li>Pick a course to resume it, or scroll to see your certificates.</li>
          </Numbers>
          <H4>Certificates</H4>
          <P>
            When you complete every required activity in a course, a certificate is
            generated automatically and added to your Trail. Each certificate has a unique
            identifier for verification, and you can view or share it from your Trail.
          </P>
          <Callout kind="tip" title="Progress is per course">
            You can be partway through many courses at once; the Trail tracks each
            independently. Use <UI>quit all</UI> only when you want to clear everything.
          </Callout>
        </div>
      ),
    },
    {
      id: 'discussions',
      title: 'Discussions & communities',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            <strong>Communities</strong> are shared spaces for conversation, questions
            and announcements, separate from course content. Each community holds
            discussion threads.
          </P>
          <H4>Taking part</H4>
          <Steps>
            <Step>
              Open <UI>Communities</UI> in the sidebar (or{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/connect')}>the communities page</ProseLink>).
            </Step>
            <Step>Pick a community, then open a discussion or start a new one.</Step>
            <Step>
              Reply with a comment, <strong>upvote</strong> helpful posts and comments, or
              add an <strong>emoji reaction</strong>.
            </Step>
          </Steps>
          <H4>Finding things</H4>
          <Bullets>
            <li>
              <strong>Labels</strong> categorise discussions (for example question, idea,
              announcement) so you can filter the list.
            </li>
            <li>
              <strong>Pinned</strong> discussions stay at the top — usually
              announcements or important threads.
            </li>
            <li>
              <strong>Locked</strong> discussions are closed to new comments but remain
              readable.
            </li>
          </Bullets>
          <P>
            Teachers and admins can pin, lock and moderate threads. Be kind: comments are
            visible to your whole organization.
          </P>
        </div>
      ),
    },
    {
      id: 'boards-learner',
      title: 'Boards',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            A <strong>board</strong> is an infinite collaborative canvas — think
            whiteboard. Multiple people can pan, zoom, and edit at the same time, and
            changes appear live for everyone.
          </P>
          <H4>What you can do on a board</H4>
          <Bullets>
            <li>Draw freehand strokes and shapes.</li>
            <li>Add sticky notes and to-do cards.</li>
            <li>Arrange content inside frames.</li>
            <li>
              Drop in rich cards: webpages, YouTube videos, podcasts, course activities,
              AI playgrounds and other ValidBridge resources.
            </li>
          </Bullets>
          <H4>Access</H4>
          <P>
            Each board member has a role: <strong>Owner</strong>, <strong>Editor</strong>{' '}
            or <strong>Viewer</strong>. Viewers can follow along but not change anything.
            Owners invite members and set their access.
          </P>
          <Callout kind="warn" title="Live edits merge instantly">
            Boards sync over the collaboration server. If a board is stuck on
            &ldquo;connecting&rdquo;, that server may be down — try again in a moment.
          </Callout>
          <Jump href={`${getUriWithOrg(orgslug, '/help')}#boards-teaching`} label="For instructors: creating and sharing boards" />
        </div>
      ),
    },
    {
      id: 'podcasts-learner',
      title: 'Podcasts',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Podcasts are audio series your organization publishes. Each podcast contains
            episodes you can stream.
          </P>
          <Bullets>
            <li>
              Browse from <UI>Podcasts</UI> in the sidebar, or{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/podcasts')}>the podcasts page</ProseLink>.
            </li>
            <li>Open a podcast to see its episodes and descriptions.</li>
            <li>
              Press play on an episode. A mini-player follows you around the platform so
              you can keep listening while you browse.
            </li>
          </Bullets>
          <P>
            Playback supports seeking, and each podcast exposes an RSS feed you can add to
            a podcast app if you prefer to listen elsewhere.
          </P>
        </div>
      ),
    },
    {
      id: 'playgrounds-learner',
      title: 'Playgrounds (Labs)',
      content: () => (
        <div className="space-y-4">
          <P>
            <strong>Playgrounds</strong> are interactive, AI-generated web experiences —
            simulations, visualisations, and hands-on widgets that teachers publish to
            support a lesson.
          </P>
          <Bullets>
            <li>
              Find them under <UI>Playgrounds</UI> (also called <UI>Labs</UI>) in the
              sidebar.
            </li>
            <li>Open one to interact with it directly in your browser.</li>
            <li>You can react to a playground to give the author feedback.</li>
          </Bullets>
          <Callout kind="info" title="Not to be confused with Code Playground">
            A playground here is an AI-made interactive experience. A{' '}
            <strong>Code Playground</strong> is the code editor block inside a course page.
          </Callout>
        </div>
      ),
    },
    {
      id: 'search-learner',
      title: 'Search',
      content: (orgslug) => (
        <div className="space-y-4">
          <P>
            Search finds courses, collections and people across your organization. It is
            scoped to your organization — you never see another tenant's content.
          </P>
          <Steps>
            <Step>
              Click the search box (top bar or sidebar), or open{' '}
              <ProseLink href={getUriWithOrg(orgslug, '/search')}>search</ProseLink>.
            </Step>
            <Step>Type a few words from the title or description you are looking for.</Step>
            <Step>Results are grouped by type and paginated; open one to jump straight to it.</Step>
          </Steps>
          <Callout kind="tip" title="Faster than clicking">
            The command palette (<Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + <Kbd>K</Kbd>) also
            searches courses and pages, and is the quickest way to move around.
          </Callout>
        </div>
      ),
    },
  ],
}