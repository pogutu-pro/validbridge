# ValidBridge — Pre-Onboarding Platform Overview

**Audience:** Prospective institutional client · **Format:** Solution presentation
**Prepared for:** Decision-makers across teaching, administration, and IT

---

## 1. Executive Summary

ValidBridge is a self-hostable, multi-tenant learning platform that unifies the entire educational
workflow — course authoring, instruction, assessment, community, and credentialing — into a single
system an institution fully owns and controls.

> **The core promise:** ValidBridge does not just deliver content. It closes the loop from
> *enrollment → instruction → practice → assessment → verifiable proof of skill*, and gives every
> role in the organization the exact dashboard they need to do their job.

Three pillars anchor the platform:

| Pillar | What it means for your institution |
| --- | --- |
| **1. Value proposition** | Sell courses, run classes, and prove outcomes from one owned system — no per-seat SaaS lock-in, your data stays yours. |
| **2. Dual-track curriculum** | Every program pairs a **guided curriculum track** (structured learning) with an **applied proof-of-work track** (practice, assessment, verifiable output). |
| **3. Verified proof-of-work portfolios** | Each learner accumulates skills, graded work, and cryptographically verifiable certificates into a public, tamper-evident profile. |

---

## 2. Platform Value Proposition

ValidBridge is architected as three independently deployable applications, giving institutions
operational flexibility and full ownership:

| Application | Responsibility | Why it matters to you |
| --- | --- | --- |
| **API** | Auth, courses, assignments, analytics, AI, email, certificates | REST backend that integrates with your existing SIS, LMS, or HR systems. |
| **Web** | Learner, instructor, and administrator interfaces | The branded front-end your students and staff actually use. |
| **Collab** | Real-time synchronization (WebSocket / Yjs) | Live co-editing and shared whiteboards — the "in-class" experience, online. |

### Why institutions choose ValidBridge

- **Self-hosted and self-owned** — Your content, learner data, and credentials never leave your infrastructure.
- **Multi-tenant by design** — One deployment can run many organizations, campuses, or client accounts, each with its own branding, users, and settings.
- **End-to-end workflow** — From a landing page that sells a course, through instruction and grading, to an issued, verifiable certificate.
- **Extensible** — Webhooks, a Zapier integration, a full REST API, and API tokens let you connect to 6,000+ no-code tools and your own systems.
- **Enterprise-ready** — Payments (Stripe), SSO, SCORM, and audit logs available in the Enterprise edition.

---

## 3. The Dual-Track Curriculum

Every ValidBridge course can be delivered on two complementary tracks that, together, turn
*presentation* into *competence*.

### Track 1 — Guided Curriculum (Learn)

Structured content that walks a learner from first concept to mastery.

| Capability | What it does | Why it sells & teaches |
| --- | --- | --- |
| **Courses → Chapters → Activities** | Courses are organized into chapters, each containing activities. | Gives you a predictable, structured product to sell and a syllabus students can follow. |
| **Dynamic pages** | Block-based, Notion-style rich pages (text, headings, images, code, callouts, embeds). | Non-technical instructors author beautiful lessons without engineering help. |
| **Video** | Hosted video with playback tracking. | Lecture content that tracks who actually watched. |
| **Documents** | PDF and file uploads for reference material. | Distribute readings and slide decks inside the course. |
| **Quizzes** | Assessments that feed directly into progress tracking. | Check understanding and automatically drive completion metrics. |
| **Collections** | Group courses into thematic paths. | Package courses into curricula, tracks, or certificate programs you can market as a unit. |
| **Podcasts** | Audio content with episode management and streaming. | Reach learners on the go and expand your content catalogue. |

### Track 2 — Applied Proof-of-Work (Prove)

Hands-on, assessable, and verifiable activities that demonstrate skill, not just exposure.

| Capability | What it does | Why it proves outcomes |
| --- | --- | --- |
| **Assignments** | File-upload, quiz, and custom tasks with rubric grading, multi-task structure, and optional deadlines. | The primary instrument for graded, evidence-based assessment. |
| **Code Playgrounds** | In-browser execution across 30+ languages with auto-graded test cases. | Turns a technical curriculum into instantly verifiable, machine-graded skill. |
| **Playgrounds** | AI-generated interactive simulations and diagrams. | Hands-on, exploratory learning that keeps engagement high. |
| **Boards** | Real-time collaborative canvases (sticky notes, drawings, frames, embeds). | Team projects and live workshops — proof of collaborative work. |
| **Communities** | Discussion threads with comments, voting, and reactions. | Peer learning and instructor presence that measurably improves completion. |
| **Certificates** | Auto-issued on course completion, with a unique ID and QR verification. | The credential your learner takes out into the world — and your institution's brand travels with it. |

> **Why "dual-track" wins the sale:** prospects see a *complete* product — not just a video
> library, but a system that certifies that students can actually **do** the work.

---

## 4. Verified Proof-of-Work Portfolio Profiles

Every learner in ValidBridge builds a persistent, shareable profile that *accumulates evidence*
rather than resetting at the end of each course.

### What the learner accumulates

- **Completed courses** (via their **Trail** — the per-student record of activity completion, quiz results, and progression).
- **Graded assignments** and quiz scores.
- **Earned certificates**, each with a unique UUID and a public verification page.
- **A self-built portfolio profile** — drag-and-drop sections for skills, experience, education, image galleries, links, affiliations, and courses.

### Why this closes the deal for an institutional buyer

| Outcome | How ValidBridge delivers it |
| --- | --- |
| **Verifiable credentials** | Each certificate carries a unique ID and QR code; anyone can confirm authenticity on the public `/verify` page. No PDF forgeries. |
| **Alumni & employer value** | Learners graduate with a living portfolio — a recruitment and alumni-relations asset for the institution. |
| **Outcome reporting** | The portfolio is built from the same data your analytics already track, so "proof of learning" is reportable, not anecdotal. |
| **Brand equity** | Issued certificates and portfolio profiles carry your organization's branding, reinforcing your institution as the credentialing authority. |

---

## 5. Audience Breakdown (Role by Role)

### 5.1 Student (Learner) — *the buyer of your courses and the proof of your outcomes*

| Feature | What it does | Why it helps you sell & retain |
| --- | --- | --- |
| **Course player** | A focused, branded interface for progressing through chapters and activities. | A polished learner experience is the product your tuition actually buys. |
| **Trail (progress)** | Automatically records completed activities, quiz scores, and course progression. | Learners always know where they are — reducing dropout and support load. |
| **Assignments & submissions** | Submit files, take quizzes, and see grades in one place. | The mechanism by which learning is assessed and evidenced. |
| **Certificates** | Auto-issued on completion, viewable and shareable from the profile. | The tangible, shareable reward that justifies enrollment and drives word-of-mouth. |
| **Profile / portfolio builder** | Drag-and-drop sections for skills, experience, education, and courses. | Gives the learner an outcome they keep after the class ends. |
| **Communities & boards** | Participate in discussions and collaborate on shared canvases. | Peer community raises satisfaction and completion — your retention metrics. |
| **AI assistant** | Context-aware help while learning. | Personalized support at scale, without adding headcount. |

### 5.2 Instructor — *the operator of your classes*

| Feature | What it does | Why it helps you conduct classes |
| --- | --- | --- |
| **Course editor** | Block-based WYSIWYG authoring of chapters and activities. | Instructors build and update curriculum without engineering tickets. |
| **Real-time co-editing** | Multiple authors edit the same page simultaneously (Collab server). | Curriculum teams collaborate live; faster course production. |
| **Assignment grading** | Grade individual tasks or whole assignments; bulk grading supported. | Manageable grading at class scale. |
| **Formative mode** | Learners hand in work and instantly get a model answer to self-assess. | Offloads low-stakes grading, freeing instructors for high-value feedback. |
| **Learner progress** | View trails and performance for the courses the instructor owns. | Spot struggling students early and intervene — better pass rates. |
| **AI content assistance** | Context-aware help for creating and improving content. | Accelerates lesson production and reduces instructor burnout. |

### 5.3 Administrator / Maintainer — *the owner of the platform*

| Feature | What it does | Why it helps you run the business |
| --- | --- | --- |
| **User management** | Add/invite users, assign roles, and manage user groups. | Control who teaches, who administers, and who learns. |
| **Roles & permissions** | Four seeded roles (Admin, Maintainer, Instructor, User) plus custom roles with a per-resource permission matrix. | Least-privilege access that scales with your org chart — and your compliance posture. |
| **Course & collection management** | Oversee all content, publish/unpublish, and organize collections. | Central governance over the catalogue you sell. |
| **Organization settings** | Branding, landing pages, menus, theming, signup, and SEO. | A white-labeled, discoverable storefront that markets itself. |
| **Analytics** | Engagement, course, and organization-level dashboards, including cohort retention. | Prove ROI and refine offerings with data, not guesses. |
| **Audit logs** *(Enterprise)* | Org-wide, filterable activity trail. | Compliance and accountability for regulated or accredited programs. |

### 5.4 Organization-Level Management — *the strategist and the buyer*

| Capability | What it does | Why it matters at the portfolio level |
| --- | --- | --- |
| **Multi-tenant organizations** | Each org has isolated users, courses, branding, and settings. | One deployment can serve many schools, departments, or B2B clients. |
| **Payments (Stripe)** *(Enterprise)* | Offers, subscriptions, bundles, and pay-what-you-want; enrollments. | Monetize courses directly — turn the platform into a revenue center. |
| **SSO** *(Enterprise)* | WorkOS, Keycloak, Okta, Auth0, SAML, or custom OIDC. | Enterprise sign-on that IT teams require for procurement approval. |
| **SCORM** *(Enterprise)* | Import and play SCORM packages. | Reuse existing content investments and integrate with enterprise training ecosystems. |
| **Automations (webhooks + Zapier)** | Emit platform events to your own systems or 6,000+ tools. | Connect ValidBridge to your CRM, reporting, or ERP with no custom code. |
| **API & tokens** | Full REST API with scoped API tokens. | Headless integration and custom front-ends, now and as you grow. |

---

## 6. Dashboard Overview

ValidBridge ships three distinct dashboard experiences, matched to each role's responsibilities.

### 6.1 Admin / Maintainer Dashboard

The command center for running the organization.

| Area | What the admin sees and does |
| --- | --- |
| **Home** | Welcome hero, plan/usage summary, content overview, recent courses, recent members, quick stats. |
| **Analytics** | Global engagement, course performance, org growth, new-vs-returning, cohort retention, peak usage hours, certification rates. |
| **Courses / Library** | Full catalogue, folders, media uploads, and access management. |
| **Users** | Member roster, roles, user groups, org access, and per-user analytics. |
| **Org Settings** | General, branding, landing page, menu, AI, SSO, custom domains, SEO, socials, automations, API access, audit logs, usage, and danger zone. |
| **Assignments, Boards, Podcasts, Payments** | Manage the assessment, collaboration, audio, and commerce surfaces. |

### 6.2 Instructor Dashboard

Scoped to the instructor's teaching responsibilities.

| Area | What the instructor sees and does |
| --- | --- |
| **My courses** | Create and edit courses, chapters, and activities they own. |
| **Course structure editor** | Reorder chapters/activities, set access, certification, contributors, and SEO. |
| **Learner progress** | Trails and quiz/submission results for their own courses. |
| **Assignment grading** | Review and grade submissions, individually or in bulk. |
| **AI assistant** | Content creation and course-improvement support. |

### 6.3 Student (Learner) Dashboard

Scoped to learning, practice, and personal outcomes.

| Area | What the student sees and does |
| --- | --- |
| **My courses / library** | Enrolled courses and the public catalogue. |
| **Course player** | Progress through chapters and activities with a live trail. |
| **Assignments** | View tasks, submit work, and see grades/feedback. |
| **Certificates** | View, download, and share earned credentials. |
| **Profile / portfolio** | Build a public portfolio of skills, experience, and verified work. |
| **Communities & boards** | Participate in discussions and collaborative projects. |
| **AI assistant** | Context-aware learning support. |

---

## 7. Feature-by-Feature Value Proposition

Mapped to the three institutional goals: **Sell** courses, **Conduct** classes, and **Track**
educational outcomes.

### 7.1 To Sell Courses

| Feature | What it does | Why it helps you sell |
| --- | --- | --- |
| **Landing pages & branding** | Custom landing pages, themes, menus, and logos per org. | A professional, white-labeled storefront that converts. |
| **SEO** | Metadata, sitemaps, and Open Graph support. | Your courses get found by search engines. |
| **Collections & bundles** | Group courses into sellable paths; offer subscriptions, single courses, and bundles. | Higher-order packaging raises average order value. |
| **Payments (Stripe)** *(Enterprise)* | Checkout, subscriptions, bundles, pay-what-you-want, and enrollments. | Turn content directly into recurring revenue. |
| **Certificates** | Shareable, verifiable completion credentials. | Credentials are the premium outcome customers pay for. |

### 7.2 To Conduct Classes

| Feature | What it does | Why it helps you teach |
| --- | --- | --- |
| **Course editor (block-based)** | Notion-style authoring of rich, interactive lessons. | Instructors ship high-quality content fast. |
| **Real-time co-editing** | Multiple authors edit simultaneously. | Live curriculum collaboration for teaching teams. |
| **Communities** | Moderated discussions with voting and reactions. | Instructor presence and peer support improve engagement. |
| **Boards** | Real-time collaborative whiteboards. | Live workshops, office hours, and group projects. |
| **Code Playgrounds & Playgrounds** | Run code in-browser (30+ languages) and AI-generated interactive simulations. | Conduct technical and hands-on classes at scale. |
| **Assignments (graded + formative)** | File/quiz/custom tasks, optional deadlines, bulk grading, self-assessment mode. | A complete, scalable assessment workflow. |
| **Podcasts** | Host and stream audio episodes. | Extend instruction beyond the screen. |

### 7.3 To Track Educational Outcomes

| Feature | What it does | Why it proves outcomes |
| --- | --- | --- |
| **Trails** | Per-student record of activity completion, quiz results, and progression. | Objective, granular evidence of learning. |
| **Assignment analytics** | Submission status, grades, and pass-rate distribution per task. | Pinpoint where students succeed and where they stall. |
| **Analytics suite** | Engagement, course, org, cohort-retention, and certification-rate dashboards. | Board-level reporting and continuous improvement. |
| **Verified certificates** | Unique ID + QR verification page. | Tamper-evident credentials you can stand behind. |
| **Portfolio profiles** | Learner-curated, evidence-backed public profiles. | Career and alumni outcomes — the ultimate proof of program value. |
| **Audit logs** *(Enterprise)* | Org-wide, filterable activity trail with export. | Compliance-grade accountability for accredited programs. |

---

## 8. Enterprise & Platform Capabilities

Differentiators for large or regulated institutions.

| Capability | Description | Status |
| --- | --- | --- |
| **Payments** | Stripe checkout, subscriptions, bundles, Stripe Connect. | Enterprise |
| **SSO** | WorkOS, Keycloak, Okta, Auth0, SAML, OIDC. | Enterprise |
| **SCORM** | Import and playback of SCORM 1.2 / 2004 packages. | Enterprise |
| **Audit logs** | Org-wide activity viewer and export. | Enterprise |
| **Webhooks + Zapier** | Connect platform events to your systems and 6,000+ tools. | Included |
| **API tokens** | Scoped tokens for headless integrations. | Included |
| **Multi-tenancy** | Many organizations on one deployment, each fully isolated. | Included |

---

## 9. Actionable Takeaways

1. **One system, full loop** — ValidBridge replaces the patchwork of LMS, video host, assessment tool, and credential issuer with a single self-hosted platform.
2. **Dual-track = better outcomes** — Guided curriculum plus applied proof-of-work means your graduates can *demonstrate* skills, not just claim them.
3. **Verified portfolios build the brand** — Every certificate and profile is a portable, verifiable artifact that markets your institution long after enrollment ends.
4. **Role-native dashboards** — Students, instructors, and admins each get the exact workspace they need, reducing training and support cost.
5. **Enterprise-ready, no lock-in** — Self-hosting, SSO, SCORM, Stripe, audit logs, and an open API make ValidBridge compliant, integrable, and yours to own.

### Suggested Next Steps

- **Live walkthrough** of the demo organization (Riverbend Academy) across all three roles.
- **Data & security review** — self-hosting topology, SSO, and audit-log requirements.
- **Pilot scope** — one program, delivered on both curriculum tracks, with certificates and analytics enabled.
