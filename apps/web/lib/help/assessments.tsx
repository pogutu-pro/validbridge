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
  Numbers,
  Defs,
  Def,
  Table,
} from './prose'
import { appHref } from './links'

export const assessments: HelpCategory = {
  id: 'assessments',
  title: 'Assessments & quizzes',
  icon: 'exam',
  description: 'Assignments, quizzes, code exercises and grading — for students and instructors.',
  articles: [
    {
      id: 'assignments-learner',
      title: 'Complete and submit an assignment',
      summary: 'Task types you may meet, how autosave and submission work, deadlines, retries and formative assignments.',
      audience: ['learners'],
      keywords: ['submit', 'homework', 'deadline', 'late', 'grade', 'retry', 'model answer', 'formative'],
      content: () => (
        <div className="space-y-4">
          <P>
            An assignment is a gradable activity made of one or more <strong>tasks</strong>.
          </P>
          <Defs>
            <Def term="File upload">attach a document, image or archive.</Def>
            <Def term="Quiz">multiple-choice questions, scored automatically.</Def>
            <Def term="Short answer">a text answer, sometimes auto-graded against an answer key.</Def>
            <Def term="Number answer">a numeric value checked against an expected answer.</Def>
            <Def term="Code">code run against test cases.</Def>
            <Def term="Form">a structured form defined by your instructor.</Def>
          </Defs>
          <H4>Submit</H4>
          <Steps>
            <Step>Open the assignment from the course.</Step>
            <Step>Complete each task. Your work <strong>autosaves</strong>, so you can come back later.</Step>
            <Step>Click <UI>Submit</UI>. If retries are allowed you can resubmit before the deadline.</Step>
            <Step>Once graded, open the assignment to see your score and feedback per task.</Step>
          </Steps>
          <H4>Deadlines</H4>
          <P>
            If a due date is set, the assignment closes when it passes — you are warned
            before saving stops. Late submissions are flagged to the instructor.
          </P>
          <H4>Formative assignments</H4>
          <P>
            Formative assignments have no score. Handing in your work unlocks a{' '}
            <strong>model answer</strong> so you can compare and self-assess.
          </P>
          <Callout kind="tip" title="Submission statuses">
            Not submitted → Pending (saved, not handed in) → Submitted → Late (if past the
            deadline) → Graded.
          </Callout>
        </div>
      ),
    },
    {
      id: 'assignments-teaching',
      title: 'Create and grade assignments',
      summary: 'Build an assignment from tasks, set deadlines and retries, choose a grading scale, and review submissions.',
      audience: ['instructors'],
      keywords: ['assignment', 'grading', 'rubric', 'submissions', 'grade', 'marks', 'scale', 'formative'],
      content: (ctx) => (
        <div className="space-y-4">
          <H4>Create an assignment</H4>
          <Steps>
            <Step>
              Add an <strong>Assignment</strong> activity to a chapter, or open{' '}
              <ProseLink href={appHref(ctx, '/dash/assignments')}>Assignments</ProseLink>{' '}
              in the dashboard.
            </Step>
            <Step>Give it a title, description and optional due date.</Step>
            <Step>Add tasks in the <UI>Task Editor</UI>; each can have its own instructions and points.</Step>
            <Step>Set the grading scale, whether retries are allowed, and graded or formative mode.</Step>
            <Step>Publish it with the course.</Step>
          </Steps>
          <H4>Task types</H4>
          <Table
            head={['Task', 'Learner does', 'Grading']}
            rows={[
              ['File upload', 'Attaches files.', 'Manual'],
              ['Quiz', 'Answers multiple-choice questions.', 'Automatic'],
              ['Short answer', 'Types a text answer.', 'Automatic against an answer key, or manual'],
              ['Number answer', 'Enters a number.', 'Automatic, with a tolerance'],
              ['Code', 'Writes code run against test cases.', 'Automatic'],
              ['Form', 'Fills in a form you define.', 'Manual or automatic'],
            ]}
          />
          <H4>Grading scales</H4>
          <Defs>
            <Def term="Numeric">a raw score, such as 87 / 100.</Def>
            <Def term="Percentage">a score out of 100%.</Def>
            <Def term="Alphabet">letter grades, A–F.</Def>
          </Defs>
          <H4>Review submissions</H4>
          <Numbers>
            <li>Open the assignment and go to <UI>Submissions</UI>.</li>
            <li>Filter by student or task; each row shows its status.</li>
            <li>Open a submission. Automatic tasks are already scored; grade manual ones.</li>
            <li>Finalise the grade — it is recorded in the learner&apos;s Trail.</li>
          </Numbers>
          <H4>Formative (ungraded) assignments</H4>
          <P>
            Turn on <UI>Formative — no grading</UI>. Instead of a grade you write a model
            answer (optionally with a document) and choose when it unlocks:{' '}
            <strong>Never</strong>, <strong>On hand-in</strong> or{' '}
            <strong>After grading</strong>.
          </P>
          <Callout kind="tip" title="Reuse quiz questions live">
            Quiz tasks can also be run as a live quiz during a LiveBridge lesson — see{' '}
            <HelpLink ctx={ctx} to="livebridge/live-engagement">Live quizzes</HelpLink>.
          </Callout>
        </div>
      ),
    },
    {
      id: 'quizzes',
      title: 'Quiz blocks, quiz tasks and live quizzes',
      summary: 'The three kinds of quiz in ValidBridge and when to use each one.',
      audience: ['instructors', 'learners'],
      keywords: ['quiz', 'test', 'knowledge check', 'multiple choice', 'mcq', 'live quiz'],
      content: (ctx) => (
        <div className="space-y-4">
          <Table
            head={['Kind', 'Where it lives', 'Graded?']}
            rows={[
              [<strong key="b">Quiz block</strong>, 'Inside a dynamic page (insert it from the editor’s / menu).', 'No — a quick knowledge check with instant feedback.'],
              [<strong key="t">Quiz task</strong>, 'Inside an assignment.', 'Yes — scored automatically and saved as a submission.'],
              [<strong key="l">Live quiz</strong>, 'Run during a LiveBridge lesson from a quiz block or quiz task.', 'Scored per question; results appear in the lesson report.'],
            ]}
          />
          <P>
            Write your questions once: any quiz block or quiz task in a course can be run
            live in that course&apos;s lessons. See{' '}
            <HelpLink ctx={ctx} to="livebridge/live-engagement">
              Chat, Q&amp;A, polls and live quizzes
            </HelpLink>
            .
          </P>
          <Callout kind="info" title="Live quizzes need auto-scorable questions">
            A live quiz only uses questions that can be scored automatically. If a quiz has
            none, LiveBridge tells you it cannot be run.
          </Callout>
        </div>
      ),
    },
    {
      id: 'code-exercises',
      title: 'Code exercises',
      summary: 'Write and run code in the browser against your instructor’s test cases, in 30 languages.',
      audience: ['learners', 'instructors'],
      keywords: ['code', 'programming', 'playground', 'judge0', 'python', 'javascript', 'test cases'],
      content: () => (
        <div className="space-y-4">
          <P>
            A <strong>Code Playground</strong> block gives you an in-browser editor. Write a
            solution, then run it against the test cases your instructor defined.
          </P>
          <Steps>
            <Step>Choose the language (the exercise usually preselects it).</Step>
            <Step>Write your solution.</Step>
            <Step>Click <UI>Run</UI>. Each test case reports pass or fail, with time and memory used.</Step>
            <Step>Fix and re-run until every test passes. Your submission is saved.</Step>
          </Steps>
          <P>
            Code runs in an isolated sandbox. Thirty languages are supported, including
            Python, JavaScript, TypeScript, Java, C, C++, Rust, Go, C#, Ruby, PHP, SQL and
            Bash.
          </P>
          <Bullets>
            <li>A Code Playground block in a page is practice.</li>
            <li>A <strong>Code</strong> task in an assignment counts towards that assignment&apos;s grade.</li>
          </Bullets>
        </div>
      ),
    },
  ],
}
