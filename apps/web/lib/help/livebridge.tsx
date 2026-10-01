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
  Faq,
} from './prose'
import { appHref } from './links'

export const livebridge: HelpCategory = {
  id: 'livebridge',
  title: 'LiveBridge live classes',
  icon: 'video',
  description:
    'Teach live inside ValidBridge: schedule a lesson, share your screen, run polls and quizzes, record, and track attendance.',
  articles: [
    {
      id: 'live-overview',
      title: 'What is LiveBridge?',
      summary:
        'LiveBridge is the live classroom built into every course. Lecturers and students meet in the browser — no separate meeting app or link-sharing needed.',
      audience: ['everyone'],
      keywords: ['live class', 'video call', 'webinar', 'virtual classroom', 'zoom', 'meet', 'online lesson'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            <strong>LiveBridge</strong> is ValidBridge&apos;s live classroom. A live lesson
            belongs to a course: the lecturer schedules it from the course, students join
            it from the same course, and everything that happens — attendance, questions,
            poll and quiz answers, the recording — stays with that course. Nobody has to
            leave ValidBridge or install anything; it runs in the browser on desktop,
            tablet and phone.
          </P>
          <H4>What you can do in a live lesson</H4>
          <Bullets>
            <li>Talk on camera and microphone, and share your screen (lecturers).</li>
            <li>Chat with the class, and ask the lecturer questions in a dedicated Q&amp;A.</li>
            <li>Run quick polls and live quizzes built from the course&apos;s own quizzes.</li>
            <li>Raise a hand and send reactions (students).</li>
            <li>Record the lesson — the recording is added to the course as a video lesson.</li>
            <li>Review attendance and participation for every student afterwards.</li>
          </Bullets>
          <H4>Who can do what</H4>
          <Table
            head={['In the classroom', 'Who', 'Can']}
            rows={[
              [
                <strong key="l">Lecturer</strong>,
                'Anyone who can edit the course (owner, contributors, instructors, admins)',
                'Schedule and start lessons, share screen, record, launch polls and quizzes, moderate participants, end the lesson, see attendance.',
              ],
              [
                <strong key="s">Student</strong>,
                'Learners with access to the course',
                'Join, chat, ask questions, vote, answer quizzes, raise a hand, react, and use mic and camera unless the lecturer turns them off.',
              ],
            ]}
          />
          <H4>Where to start</H4>
          <Bullets>
            <li>
              Lecturers:{' '}
              <HelpLink ctx={ctx} to="livebridge/schedule-live-lesson">
                Schedule a live lesson
              </HelpLink>
              , then{' '}
              <HelpLink ctx={ctx} to="livebridge/run-live-lesson">
                start and teach it
              </HelpLink>
              .
            </li>
            <li>
              Students:{' '}
              <HelpLink ctx={ctx} to="livebridge/join-live-lesson">
                Join a live lesson
              </HelpLink>
              .
            </li>
          </Bullets>
        </div>
      ),
    },
    {
      id: 'schedule-live-lesson',
      title: 'Schedule a live lesson',
      summary:
        'Create a live lesson from a course, choose its time, and decide whether it is recorded and whether recordings go straight to students.',
      audience: ['instructors'],
      keywords: ['schedule', 'plan', 'calendar', 'new live lesson', 'create session'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            Live lessons are scheduled per course. You need permission to edit the course.
          </P>
          <Steps>
            <Step>
              Open the course and find the <strong>Live lessons</strong> panel, then click{' '}
              <UI>Schedule</UI>. (Or in the dashboard, open the course, go to its{' '}
              <UI>LiveBridge</UI> tab and click <UI>Schedule a live lesson</UI>.)
            </Step>
            <Step>
              Enter a <UI>Lesson title</UI>, the <UI>Starts at</UI> date and time, and an
              optional description.
            </Step>
            <Step>
              Choose the recording options (see below), then click <UI>Schedule lesson</UI>.
            </Step>
          </Steps>
          <P>
            Students enrolled in the course see the lesson in the course&apos;s{' '}
            <strong>Live lessons</strong> panel and under <UI>Live lessons</UI> in their
            sidebar, and can join as soon as you go live.
          </P>
          <H4>Recording options</H4>
          <Defs>
            <Def term="Record automatically">
              recording starts as soon as the lesson goes live. You can also start and stop
              recording by hand during the lesson.
            </Def>
            <Def term="Publish recordings to students">
              when on, the finished recording is published to the course straight away.
              When off, it is added as a <strong>draft</strong> lesson for you to review and
              publish yourself.
            </Def>
          </Defs>
          <Callout kind="info" title="Recording availability">
            Recording controls only appear when recording is enabled for your
            ValidBridge workspace. If you do not see them, contact support.
          </Callout>
          <P>
            Next:{' '}
            <HelpLink ctx={ctx} to="livebridge/invite-to-live-lesson">
              invite students
            </HelpLink>{' '}
            or{' '}
            <HelpLink ctx={ctx} to="livebridge/run-live-lesson">
              start the lesson
            </HelpLink>
            .
          </P>
        </div>
      ),
    },
    {
      id: 'invite-to-live-lesson',
      title: 'Invite students to a live lesson',
      summary:
        'Share the lesson link, email every enrolled student or specific addresses, or add the lesson to Google Calendar.',
      audience: ['instructors'],
      keywords: ['invite', 'invitation', 'email', 'link', 'share', 'google calendar'],
      content: () => (
        <div className="space-y-4">
          <P>
            Every live lesson has its own link. Click <UI>Invite</UI> next to a lesson —
            in the course&apos;s Live lessons panel or in the LiveBridge tab — to share it.
          </P>
          <H4>Share link</H4>
          <Bullets>
            <li>
              <UI>Copy lesson link</UI> or <UI>Copy joining info</UI> (title, time and link)
              to paste into a message.
            </li>
            <li>
              <UI>Add to Google Calendar</UI> creates a calendar event with the link.
            </li>
          </Bullets>
          <H4>Email</H4>
          <Steps>
            <Step>Switch to the <UI>Email</UI> tab.</Step>
            <Step>
              Tick <UI>All enrolled students</UI>, and/or paste other email addresses
              (separated by commas, spaces or new lines — up to 100 per send).
            </Step>
            <Step>Add an optional personal note, then click <UI>Send invitations</UI>.</Step>
          </Steps>
          <Callout kind="info" title="Only people with course access can join">
            Anyone opening the link must sign in. People who can see the course but have
            not enrolled get an <UI>Enroll &amp; join</UI> button. For paid courses they
            need to buy access first.
          </Callout>
        </div>
      ),
    },
    {
      id: 'run-live-lesson',
      title: 'Start and teach a live lesson',
      summary:
        'Check your devices, start the lesson, share your screen, choose what students see and record the class.',
      audience: ['instructors'],
      keywords: ['start', 'go live', 'screen share', 'present', 'camera', 'microphone', 'record', 'recording'],
      content: () => (
        <div className="space-y-4">
          <H4>Start the lesson</H4>
          <Steps>
            <Step>
              Open the lesson — click <UI>Open</UI> in the course&apos;s Live lessons panel,
              or <UI>Open classroom</UI> in the LiveBridge tab.
            </Step>
            <Step>
              On the device check screen, test your microphone and camera. Lecturers start
              with both on; use <UI>Settings</UI> to pick a different microphone, camera or
              speaker.
            </Step>
            <Step>
              Click <UI>Start lesson</UI>. The lesson goes live and students can join
              immediately. (Once it has started, the button reads{' '}
              <UI>Enter classroom</UI>.)
            </Step>
          </Steps>
          <H4>The control bar</H4>
          <Table
            head={['Control', 'What it does']}
            rows={[
              ['Microphone / Camera', 'Turn your audio and video on or off.'],
              ['Share screen', 'Present a screen, window or browser tab. Click Stop sharing to finish.'],
              ['Start / Stop recording', 'Record the lesson (shown when recording is available). A REC badge tells everyone the lesson is being recorded.'],
              ['Settings', 'Choose microphone, camera and speaker.'],
              ['Panels', 'Open Chat, Q&A, Polls, Quiz, People, Info and Attendance.'],
              ['Leave', 'Leave the lesson (it keeps running) or end it for everyone.'],
            ]}
          />
          <H4>Choose what students see</H4>
          <P>
            While you share your screen, a <strong>What students see</strong> switch
            appears on the stage. Choose <UI>Presentation</UI> to put your shared screen
            in focus, or <UI>Camera</UI> to put your video first.
          </P>
          <Callout kind="tip" title="Use headphones">
            Headphones prevent echo when several people have their microphones on. If the
            connection weakens, LiveBridge lowers video quality automatically and the
            lesson keeps going.
          </Callout>
        </div>
      ),
    },
    {
      id: 'live-engagement',
      title: 'Chat, Q&A, polls and live quizzes',
      summary:
        'Keep students involved: answer questions, launch quick polls, and run a quiz from the course’s existing quiz questions.',
      audience: ['instructors', 'learners'],
      keywords: ['poll', 'quiz', 'question', 'q&a', 'chat', 'raise hand', 'reaction', 'vote', 'engagement'],
      content: () => (
        <div className="space-y-4">
          <H4>Chat</H4>
          <P>
            Messages in <UI>Chat</UI> are visible to everyone in the lesson.
          </P>
          <H4>Q&amp;A</H4>
          <P>
            Students ask the lecturer questions in the <UI>Q&amp;A</UI> panel; questions are
            shared with the class. Lecturers can <UI>Reply</UI> with an answer for
            everyone, mark a question <UI>Answered</UI>, <UI>Dismiss</UI> it, or{' '}
            <UI>Reopen</UI> it. Filter by <UI>Open</UI>, <UI>Answered</UI> or <UI>All</UI>.
          </P>
          <H4>Polls</H4>
          <Steps>
            <Step>Open <UI>Polls</UI> and choose <UI>Launch a poll</UI>.</Step>
            <Step>Type the question and at least two options (<UI>Add option</UI> for more).</Step>
            <Step>Optionally set a <UI>Time limit</UI>, then click <UI>Launch poll</UI>.</Step>
            <Step>Students vote from a prompt on their screen and see results after voting. Click <UI>Close poll</UI> when done.</Step>
          </Steps>
          <H4>Live quizzes</H4>
          <P>
            Live quizzes reuse the questions you already wrote: any{' '}
            <strong>quiz task</strong> in an assignment or <strong>quiz block</strong> in a
            lesson of this course can be run live.
          </P>
          <Steps>
            <Step>Open the <UI>Quiz</UI> panel and <UI>Choose a quiz</UI> (assignment quiz or lesson quiz).</Step>
            <Step>Set the <UI>Time per question</UI> and click <UI>Start quiz</UI>.</Step>
            <Step>
              Students answer each question on their own screen. When the time runs out,
              everyone sees the correct answer and how the class did. Click{' '}
              <UI>Next question</UI> to continue.
            </Step>
            <Step>
              After the last question, click <UI>Show results</UI> for the class summary.
              You can stop early at any time with <UI>End quiz</UI>.
            </Step>
          </Steps>
          <Callout kind="info" title="Scores count">
            Live quiz answers and poll votes are saved and appear in the lesson report and
            in each student&apos;s engagement figures.
          </Callout>
          <H4>For students: hands and reactions</H4>
          <P>
            Use <UI>Raise hand</UI> to get the lecturer&apos;s attention (they see a{' '}
            <strong>Hands raised</strong> list) and <UI>React</UI> to send a quick emoji.
          </P>
        </div>
      ),
    },
    {
      id: 'live-moderation',
      title: 'Manage participants',
      summary:
        'Mute students, turn off their microphone and camera access, lower hands, or remove someone from the lesson.',
      audience: ['instructors'],
      keywords: ['mute', 'remove', 'kick', 'moderate', 'participants', 'people'],
      content: () => (
        <div className="space-y-4">
          <P>
            Open the <UI>People</UI> panel to see lecturers, students and anyone with a
            raised hand. Search by name, then open a participant&apos;s actions:
          </P>
          <Defs>
            <Def term="Lower hand">clear a raised hand.</Def>
            <Def term="Mute microphone / Stop camera">switch off their audio or video once; they can turn it back on.</Def>
            <Def term="Turn off mic & camera access">
              stops them using microphone and camera for the rest of the lesson, until you
              choose <UI>Allow mic &amp; camera</UI>.
            </Def>
            <Def term="Remove from lesson">
              disconnects them; they cannot rejoin this lesson.
            </Def>
          </Defs>
          <Callout kind="warn" title="Removal is final for that lesson">
            A removed student cannot come back into the same live lesson. Use mute or
            media access for everyday classroom management.
          </Callout>
        </div>
      ),
    },
    {
      id: 'end-live-lesson',
      title: 'End a lesson and find the recording',
      summary:
        'End the lesson for everyone, then find the recording as a video lesson inside the course.',
      audience: ['instructors', 'learners'],
      keywords: ['end', 'finish', 'stop', 'recording', 'replay', 'watch later', 'draft'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>Ending the lesson</H4>
          <Steps>
            <Step>Click <UI>Leave</UI> in the control bar.</Step>
            <Step>
              Choose <UI>End lesson for everyone</UI> and confirm. Everyone is
              disconnected and the lesson is marked finished. (<UI>Leave lesson</UI>{' '}
              instead lets the lesson continue without you.)
            </Step>
          </Steps>
          <H4>Where the recording goes</H4>
          <P>
            After a recorded lesson, the recording is processed and then added to the
            course as a <strong>video activity</strong> — next to the lesson&apos;s linked
            activity, otherwise in the course&apos;s last chapter, or in a{' '}
            <strong>Live lesson recordings</strong> chapter. Its status moves from{' '}
            <em>Processing</em> to <em>Ready</em>.
          </P>
          <Bullets>
            <li>
              If <UI>Publish recordings to students</UI> was on, students can watch it right
              away.
            </li>
            <li>
              Otherwise it is a <strong>Draft</strong>: open the lesson report and click{' '}
              <UI>Review draft</UI>, check it, then publish it like any other activity.
            </li>
          </Bullets>
          <P>
            Students find recordings under <strong>Recorded lessons</strong> in the
            course&apos;s Live lessons panel (<UI>Watch</UI>) and under{' '}
            <em>Catch up on recordings</em> on their{' '}
            <ProseLink href={appHref(ctx, '/live')}>Live lessons</ProseLink> page.
          </P>
        </div>
      ),
    },
    {
      id: 'live-attendance-reports',
      title: 'Attendance and live lesson reports',
      summary:
        'See who attended, who was late or left early, how students took part, and poll and quiz results — per lesson and per student.',
      audience: ['instructors', 'admins'],
      keywords: ['attendance', 'report', 'analytics', 'present', 'absent', 'late', 'participation', 'register'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>During the lesson</H4>
          <P>
            Lecturers have an <UI>Attendance</UI> panel showing who is here now, who has
            attended and the average attendance so far.
          </P>
          <H4>After the lesson</H4>
          <P>
            In the dashboard, open the course and its <UI>LiveBridge</UI> tab (or click{' '}
            <UI>Live lesson reports</UI> on the course page).
          </P>
          <Defs>
            <Def term="Lessons">
              every live lesson with its status, attendees, time attended, questions, quiz
              average and recording. Click <UI>View report</UI> for one lesson.
            </Def>
            <Def term="Lesson report">
              attendees and attendance rate, time attended, late and early leavers,
              participation (messages, questions, poll votes, quiz answers, raised hands),
              each poll and live quiz, recordings, and a row per student.
            </Def>
            <Def term="Learner engagement">
              every enrolled student&apos;s course progress, assignments and quizzes next to
              their live attendance and participation.
            </Def>
          </Defs>
          <H4>Attendance statuses</H4>
          <Table
            head={['Status', 'Meaning']}
            rows={[
              ['Present', 'Attended the lesson on time.'],
              ['Late', 'Joined after the start.'],
              ['Left early', 'Left before the lesson ended.'],
              ['Partial', 'Attended only part of the lesson.'],
              ['Absent', 'Enrolled but did not join.'],
            ]}
          />
          <P>
            Admins can also see a student&apos;s live lessons in their individual analytics
            — see{' '}
            <HelpLink ctx={ctx} to="analytics/learner-analytics">
              Analytics for a single learner
            </HelpLink>
            .
          </P>
        </div>
      ),
    },
    {
      id: 'join-live-lesson',
      title: 'Join a live lesson (students)',
      summary:
        'Join from the course or your Live lessons page. You join with microphone and camera off and can turn them on any time.',
      audience: ['learners'],
      keywords: ['join', 'attend', 'enter', 'live now', 'class link'],
      content: (ctx) => (
        <div className="space-y-4">
          <Steps>
            <Step>
              Find the lesson: a <strong>Live now</strong> banner appears while one of your
              lessons is live, the <UI>Live lessons</UI> item in your sidebar shows a Live
              badge, and each course lists its lessons in a <strong>Live lessons</strong>{' '}
              panel. You can also open a link your lecturer sent.
            </Step>
            <Step>Click <UI>Join now</UI> (or <UI>Enter classroom</UI>).</Step>
            <Step>
              On the device check screen, optionally turn on your microphone or camera, then
              click <UI>Join lesson</UI>.
            </Step>
          </Steps>
          <Callout kind="info" title="Early?">
            If the lecturer has not started yet you will see{' '}
            <em>The lesson hasn&apos;t started yet</em>. Keep the page open — it updates
            automatically when the lesson goes live.
          </Callout>
          <H4>Access rules</H4>
          <Bullets>
            <li>You must be signed in and have access to the course.</li>
            <li>
              If you can see the course but are not enrolled, use <UI>Enroll &amp; join</UI>.
            </li>
            <li>
              For a paid course, get access from the course page first — see{' '}
              <HelpLink ctx={ctx} to="payments/paying-for-a-course">
                Paying for a course
              </HelpLink>
              .
            </li>
          </Bullets>
          <P>
            All your upcoming lessons and past recordings are on your{' '}
            <ProseLink href={appHref(ctx, '/live')}>Live lessons</ProseLink> page.
          </P>
        </div>
      ),
    },
    {
      id: 'live-troubleshooting',
      title: 'LiveBridge troubleshooting',
      summary:
        'Microphone or camera blocked, “Reconnecting…”, joined from another tab, removed from a lesson and other common live-class issues.',
      audience: ['everyone'],
      keywords: ['camera not working', 'microphone blocked', 'no audio', 'reconnecting', 'connection lost', 'echo'],
      content: () => (
        <div className="space-y-3">
          <Faq q="My microphone or camera is blocked">
            Your browser has denied access. Allow the microphone and camera in the
            browser&apos;s site settings (the lock or camera icon in the address bar), then
            try again. If the device is &ldquo;in use by another app&rdquo;, close that app.
          </Faq>
          <Faq q="The microphone or camera button is disabled">
            The lecturer has turned off microphone and camera for you in this lesson. They
            can allow it again from the People panel.
          </Faq>
          <Faq q="I see “Reconnecting…”">
            Your connection dropped briefly. Wait — the lesson resumes automatically. If
            you see <em>Connection lost</em>, check your internet and click{' '}
            <UI>Rejoin lesson</UI>.
          </Faq>
          <Faq q="“You joined from somewhere else”">
            The lesson was opened in another tab or device, so this one disconnected. Click{' '}
            <UI>Use this tab instead</UI> to continue here.
          </Faq>
          <Faq q="“Enrollment required” or “part of a paid course”">
            Enrol in the course (or buy access for a paid course) from the course page,
            then join again.
          </Faq>
          <Faq q="I can’t share my screen">
            Screen sharing is for lecturers, and some phone browsers do not support it. On
            a computer, allow screen capture when the browser asks.
          </Faq>
          <Faq q="Others hear an echo">
            Use headphones, or mute when you are not speaking.
          </Faq>
        </div>
      ),
    },
  ],
}
