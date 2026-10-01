// Terms of Service and Privacy Policy for ValidBridge, as structured data.
//
// One source renders three ways: the HTML pages (app/site/terms, app/site/privacy),
// Markdown copies for crawlers and LLMs (/terms.md, /privacy.md) and the
// /llms.txt index. Inline links use Markdown syntax: [text](href).
//
// Keep customer-facing wording free of infrastructure details (hosting vendors,
// regions, server setup). Name a third party only when the customer deals with
// it directly (Paystack) or it shapes what happens to their content (AI).

import { COMPANY, SUPPORT_EMAIL } from '@lib/help/brand'

export type LegalBlock = { p: string } | { ul: string[] }

export interface LegalSection {
  id: string
  title: string
  blocks: LegalBlock[]
}

export interface LegalDoc {
  slug: 'terms' | 'privacy'
  title: string
  description: string
  /** ISO date the text last changed. */
  updated: string
  /** Plain-language key points shown above the full text. */
  keyPoints: string[]
  sections: LegalSection[]
}

const SUPPORT = `[${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`
const COMPANY_LINK = `[${COMPANY.name}](${COMPANY.url})`
const UPDATED = '2026-09-25'

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  description:
    'The terms that apply when you use ValidBridge, the learning platform for schools, training teams and course creators operated by Stratnovo Systems in Kenya.',
  updated: UPDATED,
  keyPoints: [
    `ValidBridge is operated by ${COMPANY.name}, Kenya. These terms are an agreement between you and us.`,
    'Your organization owns its courses, recordings and other content. We only use it to run the service for you.',
    'Course sales go through your own Paystack account, straight to you. ValidBridge charges no platform fee on them.',
    'Plans are priced in KES and paid through Paystack by card, M-Pesa or bank. Paid plans renew automatically until cancelled; if you cancel, the plan runs to the end of the period.',
    'Usage above your plan is paid with packs or add-ons. At a limit, new usage pauses; nothing is deleted.',
    'Check AI-generated content before you publish it. AI can be wrong.',
    'Kenyan law applies.',
  ],
  sections: [
    {
      id: 'about',
      title: 'About these terms',
      blocks: [
        {
          p: `ValidBridge ("ValidBridge", "we", "us") is a learning platform operated by ${COMPANY_LINK}, a company based in Kenya. These Terms of Service ("Terms") apply to the ValidBridge website at validbridge.co.ke, every organization site on ValidBridge (such as school.validbridge.co.ke or an organization's own domain), our apps and the related services (together, the "Service").`,
        },
        {
          p: 'By creating an account, joining an organization or otherwise using the Service, you agree to these Terms. If you use the Service on behalf of a school, company or other body, you confirm that you are authorised to accept these Terms for it, and "you" includes that body.',
        },
        {
          p: 'Our [Privacy Policy](/privacy) explains how we handle personal data and forms part of these Terms.',
        },
      ],
    },
    {
      id: 'definitions',
      title: 'Key terms',
      blocks: [
        {
          ul: [
            '"Organization": a school, institution, training team or course creator that has an organization site on ValidBridge.',
            '"Administrator": a person an Organization has given rights to manage its site, members, content, payments or billing.',
            '"Member" or "Learner": a person who has joined an Organization, for example to take its courses or live classes.',
            '"Customer Content": everything an Organization or its Members put into the Service, including courses, lessons, files, videos, live-class recordings, assignments, submissions, messages, community posts and grades.',
          ],
        },
      ],
    },
    {
      id: 'accounts',
      title: 'Accounts and security',
      blocks: [
        {
          ul: [
            'You must give accurate information when you create an account and keep it up to date.',
            'You are responsible for keeping your password and sign-in methods secure and for activity on your account. We recommend turning on two-factor authentication.',
            `Tell us straight away at ${SUPPORT} if you think someone has accessed your account without permission.`,
            'You must be old enough to agree to these Terms under Kenyan law, or have a parent, guardian or your Organization agree for you.',
          ],
        },
      ],
    },
    {
      id: 'organizations',
      title: 'Organizations and their members',
      blocks: [
        {
          p: 'Each Organization decides who can join its site, what Members can see and do, and which content it publishes. Administrators can invite, approve, restrict and remove Members, and can see the activity, progress, grades, attendance and submissions of their Members.',
        },
        {
          p: 'An Organization is responsible for its use of the Service and its Customer Content, including obtaining any consent it needs from Members (and, for learners under 18, from their parents or guardians) and meeting the laws and policies that apply to it as an education or training provider.',
        },
        {
          p: 'If you are a Member, your Organization, not ValidBridge, decides about your enrolment, grades, certificates, course access and refunds for courses it sells. Please contact your Organization about these.',
        },
      ],
    },
    {
      id: 'content',
      title: 'Your content',
      blocks: [
        {
          p: 'You keep ownership of your Customer Content. You give us a limited licence to host, store, copy, process, transmit and display it only as needed to provide, secure and improve the Service for you, and as your Organization\'s settings direct (for example, showing a public course to visitors).',
        },
        {
          p: 'You confirm that you have the rights to the content you upload and that it does not break the law or anyone else\'s rights, including copyright.',
        },
        {
          p: `We may remove content that we reasonably believe breaks these Terms or the law. If you believe content on ValidBridge infringes your rights, write to ${SUPPORT} with enough detail for us to find it and assess your claim.`,
        },
      ],
    },
    {
      id: 'acceptable-use',
      title: 'Acceptable use',
      blocks: [
        { p: 'You must not use the Service to:' },
        {
          ul: [
            'break any law, or harass, threaten, exploit or harm anyone, especially minors;',
            'upload content that is unlawful, infringes intellectual property, or contains malware;',
            'access accounts, organizations or data you are not authorised to access, or probe, scan or test the Service\'s security without our written permission;',
            'overload, disrupt or reverse-engineer the Service, or get around plan limits or technical restrictions;',
            'send spam or unsolicited messages through the Service;',
            'resell or provide the Service to others as your own product without our written agreement.',
          ],
        },
      ],
    },
    {
      id: 'live-classes',
      title: 'Live classes and recordings',
      blocks: [
        {
          p: 'LiveBridge live classes carry audio, video, screen sharing, chat, polls and Q&A between participants. Hosts can record a class; recordings are added to the course and are Customer Content of the Organization.',
        },
        {
          p: 'Hosts must tell participants when a class is being recorded and follow the Organization\'s policies and the law on recording. Participants must not record or redistribute a class without the host\'s permission.',
        },
      ],
    },
    {
      id: 'ai',
      title: 'AI features',
      blocks: [
        {
          p: 'Some features use artificial intelligence to draft or improve lessons, generate quizzes, images, audio and captions, translate text and answer questions. To produce a result, the relevant content is sent to an AI provider (Google Gemini by default) that processes it on our behalf.',
        },
        {
          ul: [
            'AI output can be inaccurate, incomplete or unsuitable. Review it before you publish or rely on it, especially for grading and assessment.',
            'You are responsible for the AI output you choose to publish, as with any other content.',
            'AI use is measured in credits. The credits included depend on your plan.',
          ],
        },
      ],
    },
    {
      id: 'course-sales',
      title: 'Selling courses',
      blocks: [
        {
          p: 'Organizations can sell courses and subscriptions to learners using their own Paystack account. Learners pay the Organization directly by card, bank or M-Pesa; ValidBridge does not receive or hold that money and charges no platform fee on it.',
        },
        {
          ul: [
            'The sale is between the Organization and the learner. The Organization sets its prices, taxes and refund policy and handles refunds and disputes.',
            'Paystack\'s own terms apply to the Organization\'s Paystack account and to each payment. Paystack fees are charged by Paystack.',
            'The Organization is responsible for keeping its Paystack keys secure and for meeting tax and consumer-protection rules that apply to its sales.',
          ],
        },
      ],
    },
    {
      id: 'plans-billing',
      title: 'Plans, billing and cancellation',
      blocks: [
        {
          p: 'Organizations use ValidBridge on a free plan (Starter or Public Education) or a paid plan (Growth, Business or Enterprise). Current plans, allowances and prices are shown on our [pricing page](/pricing). A plan\'s allowances (for example instructor seats, active learners, storage, live class hours and premium AI credits) apply to the Organization and reset on the 1st of each month.',
        },
        {
          p: 'Prices are in Kenyan shillings (KES). Payments to ValidBridge are processed by Paystack, by card, M-Pesa or bank transfer. Prices exclude taxes unless shown otherwise, and you are responsible for taxes that apply to your purchase.',
        },
        {
          ul: [
            'Wallet: an Administrator can top up a prepaid KES wallet. Monthly bills and purchases are paid from the wallet first, then from a saved card.',
            'Saved cards: when you choose to save a card, Paystack stores the card details. ValidBridge keeps only a payment token and the last 4 digits (with the card brand and expiry date), and uses the token only to charge renewals and purchases your Organization makes. You can remove a saved card at any time. M-Pesa payments cannot be saved; M-Pesa payers top up the wallet or pay each bill when asked.',
            'Monthly bills: paid plans are billed in advance on the 1st of each month for the base price, extra instructor seats, monthly add-ons and storage above the allowance. You can instead pay 12 months upfront, which takes 15% off the base price and instructor seats.',
            'Packs: premium AI credits, live class hours and code runs are sold as one-time packs, charged when you buy them. Purchased packs do not expire. A plan\'s monthly allowance is used before packs.',
            'Usage above allowances: storage above the allowance is billed monthly while it is stored. Other usage above an allowance needs a pack, an add-on, an extra seat or a higher plan. When an allowance runs out, new usage of that kind pauses; existing content is not deleted and a live class already in progress is not cut off.',
            'Spending limit: Administrators can set a monthly spending limit. Automatic charges for usage and extras, such as automatically added seats, stay within that limit.',
          ],
        },
        {
          p: 'If a payment fails, we retry it over the following days and email the Administrators each time. If it is still unpaid, paid features pause and the Organization becomes read-only until the bill is paid. Nothing is deleted while features are paused.',
        },
        {
          p: 'Paid plans renew automatically at the end of each period until cancelled. You can cancel any time from your billing settings. Your plan stays active until the end of the period already paid for, then moves to a free plan. Unused wallet balance and packs stay available. We do not refund partial periods or used packs unless the law requires it.',
        },
        {
          p: 'We may change prices for future periods. We will tell Administrators at least 30 days before a price change takes effect for them.',
        },
        {
          p: 'Public Education is free for eligible public institutions in Kenya: public primary and secondary schools, TVETs, public universities and government training centres. To apply, an Administrator uses an official email address (such as .ac.ke, .sc.ke, .go.ke or .ed.ke) and provides a registration document or a TSC, KUCCPS or TVETA number. We review every application and may approve or decline it. Approval lasts one year and must be renewed yearly; if an institution is no longer eligible, it moves to Starter or a paid plan.',
        },
        {
          ul: [
            'By applying, the institution allows ValidBridge to show its name and logo on validbridge.co.ke and in our marketing as a customer, and agrees to provide one testimonial or short case study.',
            'The "Powered by ValidBridge" badge stays visible on the institution\'s site.',
            'Public Education institutions can buy packs and add-ons at the normal prices.',
          ],
        },
      ],
    },
    {
      id: 'third-parties',
      title: 'Third-party services',
      blocks: [
        {
          p: 'The Service can connect to services run by others, such as Paystack, Google Calendar, video platforms, Zapier and your own tools through our API and webhooks. Their terms and privacy policies apply to your use of them, and we are not responsible for them.',
        },
      ],
    },
    {
      id: 'availability',
      title: 'Availability and changes to the Service',
      blocks: [
        {
          p: 'We work to keep the Service available and secure, but we do not promise that it will be uninterrupted or error-free. We may carry out maintenance, and we may add, change or remove features. If we remove a major feature you pay for, we will give reasonable notice.',
        },
        {
          p: 'Keep your own copies of important content. Administrators can export course content and analytics from the Service.',
        },
      ],
    },
    {
      id: 'suspension',
      title: 'Suspension and termination',
      blocks: [
        {
          p: 'You can stop using the Service at any time. You can delete your account from your account settings, and an Administrator can delete their Organization.',
        },
        {
          p: 'We may suspend or close an account or Organization if it seriously or repeatedly breaks these Terms, if required by law, or to protect Members, other customers or the Service. Where reasonable, we will tell you first and give you a chance to fix the problem.',
        },
        {
          p: 'After an Organization is closed, we delete its Customer Content as described in our [Privacy Policy](/privacy#retention).',
        },
      ],
    },
    {
      id: 'liability',
      title: 'Disclaimers and liability',
      blocks: [
        {
          p: 'The Service is provided "as is" and "as available". To the extent the law allows, we disclaim implied warranties, such as fitness for a particular purpose.',
        },
        {
          p: 'To the extent the law allows, ValidBridge and Stratnovo Systems are not liable for indirect or consequential loss, or for loss of profits, revenue, data or goodwill. Our total liability arising from the Service in any 12 months is limited to the greater of the fees you paid us in that period and USD 100.',
        },
        {
          p: 'Nothing in these Terms limits liability that cannot be limited under Kenyan law, or your rights as a consumer under the Consumer Protection Act, 2012.',
        },
      ],
    },
    {
      id: 'indemnity',
      title: 'Indemnity',
      blocks: [
        {
          p: 'If someone makes a claim against us because of Customer Content you provided or your breach of these Terms, you agree to cover our reasonable costs and losses from that claim, to the extent the law allows.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to these terms',
      blocks: [
        {
          p: 'We may update these Terms as the Service or the law changes. We will change the "Last updated" date above and, for significant changes, tell Administrators by email or in the product before they take effect. If you keep using the Service after changes take effect, the new Terms apply.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Governing law and disputes',
      blocks: [
        {
          p: 'These Terms are governed by the laws of Kenya. Please contact us first so we can try to resolve any dispute informally. If we cannot, the courts of Kenya have jurisdiction.',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        {
          p: `Questions about these Terms: ${SUPPORT}. ValidBridge is a product of ${COMPANY_LINK}.`,
        },
      ],
    },
  ],
}

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description:
    'How ValidBridge collects, uses, shares and protects personal data, and the rights you have under the Kenya Data Protection Act, 2019.',
  updated: UPDATED,
  keyPoints: [
    'For learning data inside an organization, the organization (your school or trainer) decides how it is used. ValidBridge processes it for them.',
    'We never sell personal data or use it for advertising.',
    'Payments are handled by Paystack. We never see or store full card numbers or M-Pesa PINs; for a saved card we keep only a payment token, the brand, the last 4 digits and the expiry date.',
    'AI features send only the content needed for the task to our AI provider.',
    'You can access, correct, download or delete your data. You can also complain to the Office of the Data Protection Commissioner.',
  ],
  sections: [
    {
      id: 'about',
      title: 'About this policy',
      blocks: [
        {
          p: `This Privacy Policy explains how ValidBridge, operated by ${COMPANY_LINK} in Kenya ("we", "us"), handles personal data when you use validbridge.co.ke, organization sites on ValidBridge, our apps and related services (the "Service"). We follow the Data Protection Act, 2019 of Kenya and its regulations.`,
        },
        {
          p: 'Words such as "Organization", "Administrator", "Member" and "Customer Content" have the meanings given in our [Terms of Service](/terms#definitions).',
        },
      ],
    },
    {
      id: 'roles',
      title: 'Who is responsible for your data',
      blocks: [
        {
          ul: [
            'Organization data: when you learn or teach inside an Organization (your school, college, employer or course creator), that Organization is the data controller for your learning data, such as enrolments, progress, submissions, grades, attendance and recordings. We process that data on the Organization\'s behalf and on its instructions. Contact your Organization first about this data.',
            'Our own data: we are the data controller for account data we need to run the platform, such as sign-in details, security logs, billing for ValidBridge plans, support requests and visits to validbridge.co.ke.',
          ],
        },
      ],
    },
    {
      id: 'data-we-collect',
      title: 'Data we collect',
      blocks: [
        {
          ul: [
            'Account data: name, username, email address, password (stored only in hashed form), profile photo and preferences.',
            'Organization and membership data: the Organizations you belong to, your role, user groups and invitations.',
            'Learning data: courses you take or create, progress, quiz answers, assignment submissions and files, code you run in exercises, grades, feedback and certificates.',
            'Live class data: attendance (joined, left, how long), chat messages, questions, poll and quiz answers and, when a host records, the recording including audio and video.',
            'Community data: posts, comments, discussions and boards you contribute to.',
            'Payment data: for ValidBridge plans, the billing contact, plan, wallet top-ups, purchases, invoices and payment references. If an Administrator saves a card, we store the payment token Paystack gives us, the card brand, the last 4 digits and the expiry date. For course purchases, the purchase record and payment reference from Paystack. We do not receive full card numbers, card security codes or M-Pesa PINs.',
            'Technical data: IP address, device and browser type, pages visited, sign-in times and security events, and error reports.',
            'Communications: messages you send to support and your email preferences.',
          ],
        },
      ],
    },
    {
      id: 'how-we-use',
      title: 'How we use data',
      blocks: [
        { p: 'We use personal data to:' },
        {
          ul: [
            'provide the Service: sign you in, run courses, live classes, assessments, certificates, communities and payments (to perform our contract with you or your Organization);',
            'keep the Service and accounts secure, prevent fraud and abuse, and fix problems (our legitimate interests);',
            'send service emails such as verification, password reset, invitations, class reminders and receipts (to perform the contract);',
            'send product news, only if you have agreed and with an unsubscribe link in each email (consent);',
            'understand how the Service is used, in aggregate, so we can improve it (legitimate interests);',
            'meet legal, tax and accounting duties (legal obligation).',
          ],
        },
        { p: 'We do not sell personal data and we do not use it for advertising.' },
      ],
    },
    {
      id: 'ai',
      title: 'AI features',
      blocks: [
        {
          p: 'When you or an Administrator use an AI feature (for example, drafting a lesson, generating a quiz, captions or audio, translating, or asking the assistant a question), the content needed for that task is sent to our AI provider, Google Gemini by default, which processes it for us to return the result.',
        },
        {
          ul: [
            'We send only the content needed for the task.',
            'We do not use your Customer Content to train our own AI models.',
            'AI features are used when someone chooses to use them; an Organization can turn AI features off.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Who we share data with',
      blocks: [
        {
          ul: [
            'Your Organization: Administrators and instructors of an Organization you join can see your profile, activity, progress, submissions, grades and attendance in that Organization.',
            'Other members: your name, photo and contributions are visible to others where you take part, such as communities, live classes and discussions.',
            'Paystack: Paystack processes card, M-Pesa and bank payments under its own privacy policy, both when an Organization pays ValidBridge for its plan, packs and add-ons, and when you buy a course from an Organization.',
            'Service providers that help us run ValidBridge, such as cloud hosting, email delivery, AI processing, error monitoring and usage analytics. They may only use data to provide their service to us, under contracts that require them to protect it.',
            'Integrations your Organization turns on, such as webhooks, Zapier or calendar invitations.',
            'Authorities, when the law requires it, or to protect the rights, safety or property of our users or others.',
            'A buyer or successor, if our business is reorganised or sold, under this policy.',
          ],
        },
      ],
    },
    {
      id: 'transfers',
      title: 'International transfers',
      blocks: [
        {
          p: 'Some of our service providers process data outside Kenya. When that happens, we transfer data only as allowed by the Data Protection Act, 2019, with appropriate safeguards, such as contracts that require the same level of protection.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep data',
      blocks: [
        {
          ul: [
            'Account data: for as long as your account exists. When you delete your account, we delete or anonymise your personal data, except where we must keep it by law.',
            'Organization data: for as long as the Organization keeps it or has its site. When an Organization is deleted, its Customer Content is deleted.',
            'Billing records (invoices, payments and wallet history): for as long as tax and accounting law requires, even after an Organization closes. A saved card\'s token and details are deleted when the card is removed.',
            'Security logs: for a limited period, then deleted.',
            'Deleted data can remain in backups for a limited time before it is overwritten.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      blocks: [
        {
          p: 'We protect personal data with technical and organisational measures, including encryption in transit (HTTPS), hashed passwords, optional two-factor authentication, role-based access within Organizations and, on eligible plans, audit logs of administrative actions. No system is completely secure; if a breach affects your personal data, we will notify you and the Data Commissioner as the law requires.',
        },
      ],
    },
    {
      id: 'children',
      title: 'Children',
      blocks: [
        {
          p: 'Schools and training providers may give learners under 18 access to ValidBridge. In that case the Organization is responsible for obtaining consent from a parent or guardian as required by section 33 of the Data Protection Act, 2019, and for deciding what data is collected. We process children\'s data only on the Organization\'s instructions and only to provide the Service.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies',
      blocks: [
        { p: 'We use a small number of cookies and similar technologies:' },
        {
          ul: [
            'Essential cookies keep you signed in, remember which Organization you are using and protect against attacks. The Service does not work without them.',
            'Preference cookies remember settings such as language.',
            'Analytics cookies help us understand, in aggregate, how the Service is used. You can block them in your browser settings without losing core features.',
          ],
        },
      ],
    },
    {
      id: 'your-rights',
      title: 'Your rights',
      blocks: [
        { p: 'Under the Data Protection Act, 2019 you have the right to:' },
        {
          ul: [
            'be told how your personal data is used;',
            'access the personal data we hold about you;',
            'correct inaccurate data or complete incomplete data;',
            'have data deleted when it is no longer needed or was processed unlawfully;',
            'object to processing, including for direct marketing;',
            'receive your data in a portable format;',
            'withdraw consent at any time, where we rely on consent.',
          ],
        },
        {
          p: `You can update most details in your account settings. For anything else, email ${SUPPORT}. If your request is about data an Organization controls, we will pass it to that Organization or help it respond. We may need to confirm your identity first.`,
        },
        {
          p: 'You can also complain to the Office of the Data Protection Commissioner (ODPC) of Kenya at [odpc.go.ke](https://www.odpc.go.ke).',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      blocks: [
        {
          p: 'We will update this policy when our practices or the law change, and change the "Last updated" date above. For significant changes, we will tell you by email or in the product before they take effect.',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      blocks: [
        {
          p: `Questions or requests about privacy: ${SUPPORT}. ValidBridge is a product of ${COMPANY_LINK}, Kenya.`,
        },
      ],
    },
  ],
}

export const LEGAL_DOCS = { terms: TERMS, privacy: PRIVACY } as const

/** "24 September 2026" for an ISO date. */
export function formatLegalDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Strip Markdown link syntax to plain text: "[a](b)" → "a". */
export function plainText(s: string): string {
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
}

/** The whole document as Markdown, for /terms.md and /privacy.md. */
export function legalToMarkdown(doc: LegalDoc, origin: string): string {
  const abs = (s: string) => s.replace(/\]\((\/[^)]*)\)/g, `](${origin}$1)`)
  const out: string[] = [
    `# ${doc.title}`,
    '',
    `> ${doc.description}`,
    '',
    `Last updated: ${formatLegalDate(doc.updated)} · Canonical: ${origin}/${doc.slug}`,
    '',
    '## Key points',
    '',
    ...doc.keyPoints.map((k) => `- ${abs(k)}`),
    '',
  ]
  doc.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '')
    for (const b of s.blocks) {
      if ('p' in b) out.push(abs(b.p), '')
      else out.push(...b.ul.map((li) => `- ${abs(li)}`), '')
    }
  })
  return out.join('\n')
}
