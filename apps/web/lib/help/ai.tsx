import type { HelpCategory } from './types'
import { P, H4, UI, ProseLink, Callout, Bullets, Defs, Def } from './prose'
import { appHref } from './links'

export const ai: HelpCategory = {
  id: 'ai',
  title: 'AI Copilot & tools',
  icon: 'sparkle',
  description: 'Ask the AI Copilot about your lessons, and use AI to draft content, quizzes, audio, images and playgrounds.',
  articles: [
    {
      id: 'ai-copilot',
      title: 'Ask AI (the Copilot)',
      summary: 'An on-demand tutor that reads the course material you are looking at, cites its sources and suggests follow-ups.',
      audience: ['learners'],
      keywords: ['ai', 'copilot', 'chatbot', 'tutor', 'genie', 'assistant', 'explain', 'summarise', 'flashcards'],
      content: (ctx) => (
        <div className="space-y-4">
          <P>
            The <strong>AI Copilot</strong> answers questions using the course material you
            are studying, so its answers are grounded in your actual lessons.
          </P>
          <H4>Open it</H4>
          <Bullets>
            <li>From an activity, click <UI>Ask AI</UI> — it opens in a side drawer with that activity in context.</li>
            <li>
              From anywhere, open the full-page{' '}
              <ProseLink href={appHref(ctx, '/copilot')}>Copilot</ProseLink> to ask
              about all of your courses.
            </li>
          </Bullets>
          <H4>Things to ask</H4>
          <Bullets>
            <li>&ldquo;Explain this activity in simpler terms.&rdquo;</li>
            <li>&ldquo;Summarise this lesson in five bullet points.&rdquo;</li>
            <li>&ldquo;Make flashcards from this material.&rdquo;</li>
            <li>&ldquo;Quiz me on what I have learned so far.&rdquo;</li>
            <li>&ldquo;Build me a study plan for this course.&rdquo;</li>
          </Bullets>
          <P>
            Answers show the sources they used — click one to jump to that activity — and
            suggest follow-up questions.
          </P>
          <Callout kind="info" title="Don’t see Ask AI?">
            AI may be switched off for your organization, or its AI credits may have run
            out. An admin can check under <UI>Organization</UI> → <UI>AI</UI>.
          </Callout>
          <Callout kind="warn" title="Check important answers">
            AI can be confidently wrong. Use it as a study aid, not a source of truth.
          </Callout>
        </div>
      ),
    },
    {
      id: 'ai-teaching-tools',
      title: 'AI tools for teaching',
      summary: 'Draft and improve lessons, generate quizzes, images and narrated audio, and build interactive playgrounds.',
      audience: ['instructors'],
      keywords: ['generate', 'ai writer', 'text to speech', 'podcast', 'narration', 'image generation', 'magic block', 'credits'],
      content: () => (
        <div className="space-y-4">
          <H4>In the editor</H4>
          <Bullets>
            <li><strong>Draft content</strong> — write or expand a section from a prompt or outline.</li>
            <li><strong>Improve content</strong> — clarity, tone and completeness edits you can accept or reject.</li>
            <li><strong>Generate quizzes</strong> from the material.</li>
            <li><strong>Magic block</strong> — insert an AI-generated interactive element.</li>
          </Bullets>
          <H4>Audio and images</H4>
          <P>
            Generate images for activities, and create audio from the Audio block&apos;s{' '}
            <UI>Generate</UI> tab:
          </P>
          <Defs>
            <Def term="Text to speech">narrate text you write.</Def>
            <Def term="Podcast (2 voices)">the AI writes a two-host discussion you can edit before generating.</Def>
            <Def term="Speak">the AI writes and narrates a single-speaker talk.</Def>
          </Defs>
          <H4>Playgrounds</H4>
          <P>
            Generate interactive web experiences — simulations, visualisations, widgets —
            from a prompt, refine them, and choose who can open them.
          </P>
          <Callout kind="info" title="AI credits">
            AI features use your organization&apos;s AI credits. When credits run low the app
            lets you know.
          </Callout>
          <Callout kind="warn" title="Review before publishing">
            Always check AI-generated content for accuracy and tone before learners see it.
          </Callout>
        </div>
      ),
    },
  ],
}
