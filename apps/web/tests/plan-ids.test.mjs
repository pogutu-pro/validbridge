// Plan IDs must match the API (apps/api/src/security/features_utils/plans.py):
// public-education, starter, growth, business, enterprise.

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PLAN,
  FREE_PLANS,
  PLAN_HIERARCHY,
  PLAN_RANK,
  isPaidPlan,
  planLabel,
} from "../services/plans/plans.ts";
import { FEATURE_METADATA } from "../services/features/featureMetadata.ts";

const PLAN_IDS = ["public-education", "starter", "growth", "business", "enterprise"];
const OLD_IDS = ["free", "personal", "personal-family", "standard", "pro"];

describe("plan ids", () => {
  test("hierarchy lists exactly the new plans in order", () => {
    expect(PLAN_HIERARCHY).toEqual(PLAN_IDS);
    for (const old of OLD_IDS) expect(PLAN_RANK[old]).toBeUndefined();
  });

  test("new orgs default to starter", () => {
    expect(DEFAULT_PLAN).toBe("starter");
  });

  test("public education and starter are the free entry tiers", () => {
    expect([...FREE_PLANS].sort()).toEqual(["public-education", "starter"]);
    expect(PLAN_RANK["public-education"]).toBe(PLAN_RANK.starter);
    expect(PLAN_RANK.growth).toBeGreaterThan(PLAN_RANK.starter);
    expect(PLAN_RANK.business).toBeGreaterThan(PLAN_RANK.growth);
    expect(PLAN_RANK.enterprise).toBeGreaterThan(PLAN_RANK.business);
  });

  test("paid plans", () => {
    expect(isPaidPlan("growth")).toBe(true);
    expect(isPaidPlan("business")).toBe(true);
    expect(isPaidPlan("enterprise")).toBe(true);
    expect(isPaidPlan("starter")).toBe(false);
    expect(isPaidPlan("public-education")).toBe(false);
    expect(isPaidPlan("pro")).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });

  test("labels", () => {
    expect(planLabel("public-education")).toBe("Public Education");
    expect(planLabel("growth")).toBe("Growth");
    expect(planLabel(null)).toBe("Starter");
  });

  test("feature upsell plans use only new ids", () => {
    for (const meta of Object.values(FEATURE_METADATA)) {
      expect(PLAN_IDS).toContain(meta.upsellPlan);
    }
    expect(FEATURE_METADATA.sso.upsellPlan).toBe("enterprise");
    expect(FEATURE_METADATA.api_access.upsellPlan).toBe("growth");
    expect(FEATURE_METADATA.webhooks.upsellPlan).toBe("growth");
    expect(FEATURE_METADATA.custom_domains.upsellPlan).toBe("growth");
    expect(FEATURE_METADATA.audit_logs.upsellPlan).toBe("starter");
  });
});
