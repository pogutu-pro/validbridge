import { describe, expect, test } from 'bun:test'
import {
  EMPTY_PUBLIC_ED,
  INSTITUTION_OPTIONS,
  canApplyPublicEd,
  isOfficialEmail,
  publicEdReady,
  schoolAddressToUrl,
} from '../app/(hub)/new/_components/onboarding.ts'

describe('onboarding helpers', () => {
  test('only public institutions can apply for Public Education', () => {
    expect(canApplyPublicEd('public_school')).toBe(true)
    expect(canApplyPublicEd('tvet_college')).toBe(true)
    expect(canApplyPublicEd('university')).toBe(true)
    for (const t of ['private_school', 'training_company', 'independent', null]) expect(canApplyPublicEd(t)).toBe(false)
  })

  test('every non-student role has institution options with API-valid ids', () => {
    const valid = ['public_school', 'private_school', 'tvet_college', 'university', 'training_company', 'independent']
    for (const opts of Object.values(INSTITUTION_OPTIONS)) {
      expect(opts.length).toBeGreaterThan(0)
      for (const o of opts) expect(valid).toContain(o.id)
    }
  })

  test('official Kenyan education and government emails', () => {
    expect(isOfficialEmail('head@kisumugirls.sc.ke')).toBe(true)
    expect(isOfficialEmail('dean@uonbi.ac.ke')).toBe(true)
    expect(isOfficialEmail('teacher@gmail.com')).toBe(false)
  })

  test('public education form needs name, number and agreement', () => {
    expect(publicEdReady({ ...EMPTY_PUBLIC_ED })).toBe(false)
    expect(publicEdReady({ ...EMPTY_PUBLIC_ED, institution: 'Kisumu Girls', regNumber: 'TSC123', agree: true })).toBe(true)
    expect(publicEdReady({ ...EMPTY_PUBLIC_ED, apply: false })).toBe(true)
  })

  test('learner school address parsing', () => {
    expect(schoolAddressToUrl('riverbend', 'validbridge.co.ke')).toBe('https://riverbend.validbridge.co.ke/signup')
    expect(schoolAddressToUrl('riverbend.validbridge.co.ke', 'validbridge.co.ke')).toBe('https://riverbend.validbridge.co.ke')
    expect(schoolAddressToUrl('https://x.validbridge.co.ke/signup?inviteCode=abc', 'validbridge.co.ke')).toContain('inviteCode=abc')
    expect(schoolAddressToUrl('not a school!', 'validbridge.co.ke')).toBeNull()
    expect(schoolAddressToUrl('', 'validbridge.co.ke')).toBeNull()
  })
})
