# ValidBridge pricing model

> Updated 2026-09-25. **Decided with the owner; not built yet.** How to build it
> is in [`pricing-implementation.md`](pricing-implementation.md).
>
> Prices are in **KES**, paid with **Paystack only** (card, M-Pesa, bank). There is
> no Stripe. There are no customers yet, so the new plans replace the old ones
> outright (no grandfathering). USD figures are approximate (KES 129 ≈ $1).

---

## 1. Principles

1. **Cheap to start, pay for what you use.** Low base prices; revenue grows with
   the school through instructor seats, live classes, premium AI, storage and
   add-ons.
2. **Free: anything cheap that doesn't give a school an edge.** Schools pay for
   what makes the platform valuable to run: live classes, premium AI, managed
   email, integrations, branding.
3. **No surprises.** Usage meters, alerts at 80% and 100%, a hard stop by default
   (nothing is ever deleted), a school-set monthly spending limit, and a prepaid
   wallet. Required by Kenya's Consumer Protection Act, and good for trust.
4. **Public institutions are free and verified.** They are the showcase and
   market ValidBridge in return.
5. **Protect the servers, not the features.** Fair-use limits on CPU-heavy work
   (simultaneous live classes, own-model AI, code runs), never feature locks.

---

## 2. Free on every plan (Public Education included)

- Unlimited courses, full editor, all block types, real-time co-editing
- Assessments: quizzes, assignments (all task types), formative mode, grading
- Certificates with QR verification
- **Advanced analytics and exports**
- Communities and boards
- Roles and permissions, user groups, invite-only sign-up, 2FA, audit logs
- Content versioning
- Course sales with the school's own Paystack account, **0% platform fee**
- **AI on ValidBridge's own model** (lesson drafts, quizzes, feedback, the
  assistant), free under fair use
- **Essential email**: verification, password reset, magic link, invitations,
  receipts

---

## 3. Plans

| | **Public Education** | **Starter** | **Growth** | **Business** | **Enterprise** |
|---|---|---|---|---|---|
| Who | Verified public institutions | Anyone trying it | Academies, trainers | Established institutions | Special needs |
| Price / month | **Free** | **Free** | **KES 3,500** (~$27) | **KES 9,500** (~$74) | Custom |
| Instructor seats included | Unlimited | 1 | 3 | 10 | Agreed |
| Extra instructor seat / month | — | — | KES 500 | KES 400 | Agreed |
| Active learners | 200 per instructor | 50 | 200 per instructor | 200 per instructor | Agreed |
| Storage included | **2 GB** | 1 GB | 10 GB | 50 GB | Agreed |
| Live class hours / month | 10 | 2 | 30 | 100 | Agreed |
| Simultaneous live classes | 2 | 1 | 3 | 10 | Agreed |
| Premium AI credits / month | 100 | 20 | 300 | 1,500 | Agreed (fair use) |
| Code runs / month | 2,000 | 200 | 5,000 | 20,000 | Agreed |
| Email beyond essentials | BYO key, or KES 900 | BYO key, or KES 900 | BYO key, or KES 900 | **Managed included** | Included |
| API, webhooks, Zapier | — | — | ✓ | ✓ | ✓ |
| Custom domain | — | — | ✓ | ✓ | ✓ |
| "Powered by ValidBridge" badge | Stays (marketing) | Stays | KES 500/mo to remove | Removed | Removed |
| Recording retention | 90 days unless paid storage | 90 days | Kept | Kept | Kept |
| SSO | — | — | — | — | **✓ Enterprise only** |
| Support | Community | Community | Standard | Priority | Dedicated |

**Definitions**
- **Instructor seat**: a member with the Admin, Maintainer or Instructor role.
- **Active learner**: a member who signed in or did learning activity in the
  calendar month (already counted by `active_users.py`).
- **Allowance resets** on the 1st of each month. **Purchased packs never expire**
  (or last 12 months at least).

---

## 4. Usage pricing and add-ons

| Item | Price | Type |
|---|---|---|
| Storage above allowance | **KES 15 per GB per month** | Monthly, while stored |
| Premium AI credits | **100 = KES 150 · 500 = KES 650 · 1,000 = KES 1,200** | One-time pack |
| Live class hours | **10 h = KES 300 · 50 h = KES 1,200 · 100 h = KES 2,000** | One-time pack |
| **LiveBridge Unlimited** | **KES 350 per instructor per month**, fair use ≈ 60 h each | Monthly add-on |
| Code runs | 5,000 runs = KES 200 | One-time pack |
| Managed email | **KES 900 / month** (5,000 emails; +KES 300 per extra 5,000) | Monthly add-on |
| Email, bring your own key | Free | — |
| Remove "Powered by ValidBridge" | KES 500 / month | Monthly add-on |
| Extra instructor seat | Growth KES 500 · Business KES 400 / month | Monthly |
| SSO | In the Enterprise quote, **≥ KES 26,000 / month** (covers WorkOS $125 + margin) | Enterprise only |

**Premium AI** = tasks that run on Gemini: images (5 credits), narrated audio (3),
video captions and translation (per minute), the high-quality model (3). Own-model
tasks never use credits.

**Live classes, both options:** plan hours are used first, then packs, unless the
school has LiveBridge Unlimited. The billing page recommends the cheaper option
("You used 40 h last month; Unlimited would save you KES 600").

**Learners over the allowance:** new learners can still join during a **7-day
grace period**; then the admin adds an instructor seat (each adds 200 learners).
With a saved card and room under the spending limit, the school can choose
**auto-add seats**.

---

## 5. Revenue check (per month)

| School | Usage | Monthly bill |
|---|---|---|
| **Growth academy** | 6 instructors, 50 live h, 30 GB, 800 premium credits, managed email, badge removed | 3,500 + 1,500 + 600 + 300 + 650 + 900 + 500 = **KES 7,950 ≈ $62** |
| **Business institution** | 25 instructors, 150 GB, 4,000 premium credits | 9,500 + 6,000 + 1,500 + 3,050 = **KES 20,050 ≈ $155** |
| **Small trainer** | 1–3 instructors, light use | **KES 3,500 ≈ $27** |
| **Public school** | Buys some live hours, storage and AI | **KES 1,000–2,000** in extras |

Packs (AI, live hours, code runs) are one-time and only count in months they are
bought. Extra usage is priced with the **cheapest mix of packs** (e.g. 500 extra
credits = one 500-pack, KES 650), the same rule the pricing-page calculator and
the billing engine use.

---

## 6. Running costs and break-even

| Item | Monthly |
|---|---|
| Oracle servers (owner + brother, Always Free) | KES 0; ~2,000–6,000 buffer for pay-as-you-go |
| Cloudflare R2 (e.g. 500 GB) | ~KES 1,000 |
| Resend (above 3,000 emails) | ~KES 2,600 |
| Gemini | Covered by credit sales |
| WorkOS | Covered by the Enterprise price |
| Domain, Cloudflare, Sentry, Tinybird (free tiers) | ~KES 0–500 |
| Paystack fees on our own collections | A few % of revenue |
| **Technology total** | **≈ KES 5,000–10,000** |

| Scenario | Revenue | Costs (tech + part-time support ≈ 40k) | Result |
|---|---|---|---|
| 2 Growth schools | ~KES 16,000 | ~KES 10,000 (tech only) | Tech covered |
| 10 public + 5 Growth + 1 Business | ~KES 76,000 | ~KES 50,000 | +KES 26,000 |
| 20 public + 12 Growth + 3 Business | ~KES 187,000 | ~KES 60,000 | +KES 127,000 |

**The real limit is CPU, not money.** Add the third server when paying usage
grows.

**Credit profitability rule:** one credit must sell for **≥ 2× its measured
Gemini cost**. After the first month, divide the Gemini bill by credits used and
adjust pack sizes.

---

## 7. Public Education

- **Eligible:** public primary and secondary schools, TVETs, public universities,
  government training centres. Private institutions use Starter or Growth.
- **Verification:** admin email on an official domain (`.ac.ke`, `.sc.ke`,
  `.go.ke`, `.ed.ke`) **and** a registration document or TSC/KUCCPS/TVETA number,
  approved by a ValidBridge superadmin. **Renews yearly.**
- **Marketing agreement** (accepted when applying): logo on validbridge.co.ke and
  permission to name the institution; one testimonial or case study; the badge
  stays visible; optional referrals (rewarded with extra storage or credits).
- They can buy packs and add-ons at normal prices from the wallet.

---

## 8. Payments and billing (Paystack only)

- **One provider: Paystack**, ValidBridge's own platform account (separate from
  each school's course-sales keys).
- **Channels:** card, M-Pesa, bank transfer.
- **Saved cards:** after a successful card payment Paystack returns a reusable
  `authorization_code`; ValidBridge stores only that plus brand, last 4 digits and
  expiry (never card numbers) and charges it for renewals and one-click pack
  purchases. **M-Pesa can't be saved.** M-Pesa payers top up the wallet or pay
  each invoice by prompt.
- **Wallet:** prepaid KES balance; monthly bills and packs draw from the wallet
  first, then the saved card.
- **Monthly bill on the 1st:** base + seats + add-ons + storage over allowance.
  Packs are charged at purchase.
- **Failed payment:** retries on day 1, 3 and 5, emails each time, then paid
  features pause (read-only, nothing deleted) until paid.
- **Yearly:** pay 12 months upfront for **15% off** the base and seats.
- **Term bundles** for public institutions on request (one fixed invoice).
- **Kenya tax:** invoices must be **KRA eTIMS** compliant; VAT applies once
  registered. **Owner to confirm with an accountant before launch.**

---

## 9. Decided

| Topic | Decision |
|---|---|
| Payment provider | Paystack only; remove Stripe |
| SSO | Enterprise only (custom price); both WorkOS and OIDC locked |
| SCORM | Enterprise only |
| Learners | 200 active learners per instructor, every plan |
| Public Education | Free, verified, marketing agreement, 2 GB, 10 live h |
| Storage | KES 15/GB/month above allowance |
| AI | Own model free; premium via credit packs (KES 150 per 100) |
| Live | Hour packs **and** LiveBridge Unlimited per instructor; school chooses |
| Email | Bring your own key free, or KES 900/month managed |
| Existing customers | None, so a clean switch |

## 10. Still to confirm

- [ ] Exact numbers in §3–4 (base prices, allowances, pack sizes)
- [ ] eTIMS / VAT with an accountant
- [ ] Wording of the Public Education marketing agreement
- [ ] Whether the 7-day learner grace period and auto-add seats suit schools
