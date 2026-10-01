import { describe, expect, test } from 'bun:test'
import {
  AI_CREDIT_PACKS,
  FREE_ON_EVERY_PLAN,
  LIVE_HOUR_PACKS,
  PLANS,
  comparisonRows,
  formatKes,
  formatUsdApprox,
  monthlyPriceCents,
  planHighlights,
  yearlyTotalCents,
} from '../lib/site/pricing.ts'
import { cheapestPackMix, estimateMonthlyCost } from '../lib/site/pricing-calculator.ts'

const base = {
  instructors: 1,
  storageGb: 0,
  liveHours: 0,
  premiumAiCredits: 0,
  managedEmail: false,
  removeBadge: false,
  liveUnlimited: false,
}

const line = (estimate, id) => estimate.lines.find((l) => l.id === id)?.cents ?? 0

describe('site pricing catalogue', () => {
  test('has the five plans in order with stable ids', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['public-education', 'starter', 'growth', 'business', 'enterprise'])
  })

  test('every plan has every field', () => {
    const fields = [
      'id', 'name', 'audience', 'priceCents', 'requiresApproval', 'seats', 'learners', 'storageGb', 'liveHours',
      'simultaneousLive', 'premiumAiCredits', 'codeRuns', 'email', 'integrations', 'badge', 'recordingRetentionDays',
      'sso', 'support', 'cta',
    ]
    for (const plan of PLANS) {
      for (const f of fields) expect(plan).toHaveProperty(f)
      expect(plan.name.length).toBeGreaterThan(0)
      expect(plan.audience.length).toBeGreaterThan(0)
      expect(plan.seats).toHaveProperty('included')
      expect(plan.seats).toHaveProperty('extraCents')
      expect(plan.learners).toHaveProperty('perInstructor')
      expect(plan.learners).toHaveProperty('total')
      expect(planHighlights(plan).length).toBeGreaterThan(2)
    }
  })

  test('prices and allowances match the pricing model', () => {
    const byId = Object.fromEntries(PLANS.map((p) => [p.id, p]))
    expect(byId['public-education'].priceCents).toBe(0)
    expect(byId.starter.priceCents).toBe(0)
    expect(byId.growth.priceCents).toBe(350_000)
    expect(byId.business.priceCents).toBe(950_000)
    expect(byId.enterprise.priceCents).toBe(1_754_700)
    expect(byId.enterprise.seats.extraCents).toBe(35_000)
    expect(byId.growth.seats.extraCents).toBe(50_000)
    expect(byId.business.seats.extraCents).toBe(40_000)
    expect(byId.starter.learners.total).toBe(50)
    expect(byId['public-education'].storageGb).toBe(2)
    expect(byId['public-education'].liveHours).toBe(10)
  })

  test('SSO is an optional add-on, included in no plan', () => {
    expect(PLANS.filter((p) => p.sso).map((p) => p.id)).toEqual([])
    for (const plan of PLANS.filter((p) => p.id !== 'enterprise')) {
      expect(planHighlights(plan).join(' ')).not.toMatch(/SSO|single sign-on/i)
    }
    expect(planHighlights(PLANS.find((p) => p.id === 'enterprise')).join(' ')).toMatch(/add-on/i)
  })

  test('comparison rows have one value per plan', () => {
    for (const row of comparisonRows()) expect(row.values).toHaveLength(PLANS.length)
  })

  test('free-on-every-plan list is filled in', () => {
    expect(FREE_ON_EVERY_PLAN.length).toBeGreaterThanOrEqual(10)
  })

  test('formatting and yearly discount', () => {
    expect(formatKes(350_000)).toBe('KES 3,500')
    expect(formatUsdApprox(350_000)).toBe('≈ $27')
    expect(formatUsdApprox(950_000)).toBe('≈ $74')
    expect(monthlyPriceCents(350_000, 'yearly')).toBe(297_500)
    expect(yearlyTotalCents(350_000)).toBe(3_570_000)
    expect(monthlyPriceCents(950_000, 'monthly')).toBe(950_000)
  })
})

describe('cheapest pack mix', () => {
  test('zero and negative need nothing', () => {
    expect(cheapestPackMix(0, LIVE_HOUR_PACKS).cents).toBe(0)
    expect(cheapestPackMix(-5, LIVE_HOUR_PACKS).cents).toBe(0)
  })

  test('small needs use small packs', () => {
    expect(cheapestPackMix(20, LIVE_HOUR_PACKS)).toEqual({ cents: 60_000, packs: [{ size: 10, count: 2 }], units: 20 })
    expect(cheapestPackMix(1, AI_CREDIT_PACKS).cents).toBe(15_000)
  })

  test('a bigger pack wins when it is cheaper than several small ones', () => {
    // 45 h: 5 × 10 h = KES 1,500, one 50 h pack = KES 1,200
    expect(cheapestPackMix(45, LIVE_HOUR_PACKS)).toEqual({ cents: 120_000, packs: [{ size: 50, count: 1 }], units: 50 })
    // 80 h: 50 + 3 × 10 = KES 2,100; one 100 h pack = KES 2,000
    expect(cheapestPackMix(80, LIVE_HOUR_PACKS).cents).toBe(200_000)
    // 500 credits: 5 × 100 = KES 750, one 500 pack = KES 650
    expect(cheapestPackMix(500, AI_CREDIT_PACKS).cents).toBe(65_000)
    // 2,500 credits: 2 × 1,000 + 500 = KES 3,050
    expect(cheapestPackMix(2500, AI_CREDIT_PACKS)).toEqual({
      cents: 305_000,
      packs: [
        { size: 1000, count: 2 },
        { size: 500, count: 1 },
      ],
      units: 2500,
    })
  })
})

describe('monthly cost calculator', () => {
  // pricechange.md §5 worked examples. The document prices premium AI at the
  // 100-credit pack rate (KES 150 per 100); the calculator uses the cheapest
  // pack mix, so every other line matches exactly and AI is cheaper.
  const at100PackRate = (credits) => Math.ceil(credits / 100) * 15_000

  test('Growth academy (§5)', () => {
    const e = estimateMonthlyCost({
      ...base,
      planId: 'growth',
      instructors: 6,
      liveHours: 50,
      storageGb: 30,
      premiumAiCredits: 800,
      managedEmail: true,
      removeBadge: true,
    })
    expect(e.kind).toBe('estimate')
    expect(line(e, 'base')).toBe(350_000)
    expect(line(e, 'seats')).toBe(150_000)
    expect(line(e, 'live')).toBe(60_000)
    expect(line(e, 'storage')).toBe(30_000)
    expect(line(e, 'email')).toBe(90_000)
    expect(line(e, 'badge')).toBe(50_000)
    expect(line(e, 'ai')).toBe(65_000) // one 500-credit pack
    expect(e.totalCents).toBe(795_000)
    // Same inputs with AI at the document's per-100 rate: KES 8,050.
    expect(e.totalCents - line(e, 'ai') + at100PackRate(500)).toBe(805_000)
  })

  test('Business institution (§5)', () => {
    const e = estimateMonthlyCost({
      ...base,
      planId: 'business',
      instructors: 25,
      storageGb: 150,
      premiumAiCredits: 4000,
    })
    expect(line(e, 'base')).toBe(950_000)
    expect(line(e, 'seats')).toBe(600_000)
    expect(line(e, 'storage')).toBe(150_000)
    expect(line(e, 'live')).toBe(0)
    expect(line(e, 'ai')).toBe(305_000) // 2 × 1,000 + 500 credits
    expect(e.totalCents).toBe(2_005_000)
    expect(e.totalCents - line(e, 'ai') + at100PackRate(2500)).toBe(2_075_000) // KES 20,750
  })

  test('Small trainer on Growth with light use is the base price (§5)', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'growth', instructors: 3, storageGb: 5, liveHours: 20, premiumAiCredits: 100 })
    expect(e.totalCents).toBe(350_000)
    expect(e.lines).toHaveLength(1)
  })

  test('Enterprise has a base price and prices extra seats', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'enterprise', instructors: 30 })
    expect(line(e, 'base')).toBe(1_754_700)
    expect(line(e, 'seats')).toBe(5 * 35_000)
  })

  test('free plans start at zero and still price usage', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'public-education', instructors: 40, storageGb: 12, liveHours: 20 })
    expect(line(e, 'base')).toBe(0)
    expect(line(e, 'seats')).toBe(0) // unlimited instructors
    expect(line(e, 'storage')).toBe(15_000) // 10 GB over 2 GB
    expect(line(e, 'live')).toBe(30_000) // 10 h over 10 h
    expect(e.totalCents).toBe(45_000)
  })

  test('Starter cannot add instructor seats or remove the badge', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'starter', instructors: 4, removeBadge: true })
    expect(e.totalCents).toBe(0)
    expect(e.notes.some((n) => n.includes('Starter includes 1 instructor'))).toBe(true)
    expect(e.notes.some((n) => n.includes('badge stays'))).toBe(true)
  })

  test('Business includes managed email and badge removal', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'business', instructors: 10, managedEmail: true, removeBadge: true })
    expect(e.totalCents).toBe(950_000)
    expect(e.lines.find((l) => l.id === 'email')?.detail).toContain('Included')
  })

  test('LiveBridge Unlimited replaces hour packs', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'growth', instructors: 3, liveHours: 150, liveUnlimited: true })
    expect(line(e, 'live')).toBe(105_000) // 3 × KES 350
    expect(e.lines.filter((l) => l.id === 'live')).toHaveLength(1)
    expect(e.liveTip).toBeNull()
  })

  test('suggests the cheaper live option', () => {
    // 120 extra hours as packs = 100 h + 2 × 10 h = KES 2,600; Unlimited for 3 = KES 1,050
    const packs = estimateMonthlyCost({ ...base, planId: 'growth', instructors: 3, liveHours: 150 })
    expect(line(packs, 'live')).toBe(260_000)
    expect(packs.liveTip).toEqual({ option: 'unlimited', savesCents: 155_000 })
    // 5 extra hours: one 10 h pack (KES 300) beats Unlimited for 3 (KES 1,050)
    const unlimited = estimateMonthlyCost({ ...base, planId: 'growth', instructors: 3, liveHours: 35, liveUnlimited: true })
    expect(unlimited.liveTip).toEqual({ option: 'packs', savesCents: 75_000 })
  })

  test('yearly saving is 15% of base and seats', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'growth', instructors: 5, storageGb: 40 })
    expect(e.yearlySavingsCents).toBe(Math.round((350_000 + 100_000) * 0.15))
  })

  test('bad input is treated as zero', () => {
    const e = estimateMonthlyCost({ ...base, planId: 'growth', instructors: Number.NaN, storageGb: -3, liveHours: Infinity })
    expect(e.totalCents).toBe(350_000)
  })
})
