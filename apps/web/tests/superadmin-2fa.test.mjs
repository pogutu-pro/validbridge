// The API answers superadmin endpoints with 403 superadmin_2fa_required when
// VALIDBRIDGE_SUPERADMIN_REQUIRE_2FA is on and the superadmin has no second
// factor. The admin layout must recognise that refusal and send the user to
// their account security page instead of rendering a dashboard of errors.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUPERADMIN_2FA_REQUIRED,
  isSuperadmin2FARequired,
} from "../lib/errors/superadmin2fa.ts";

describe("isSuperadmin2FARequired", () => {
  test("matches the FastAPI detail shape", () => {
    expect(
      isSuperadmin2FARequired(403, { detail: { error_code: SUPERADMIN_2FA_REQUIRED, message: "x" } }),
    ).toBe(true);
  });

  test("matches a flattened error_code body", () => {
    expect(isSuperadmin2FARequired(403, { error_code: SUPERADMIN_2FA_REQUIRED })).toBe(true);
  });

  test("ignores other 403s and other statuses", () => {
    expect(isSuperadmin2FARequired(403, { detail: "Superadmin access required" })).toBe(false);
    expect(isSuperadmin2FARequired(403, { detail: { error: "ee_required" } })).toBe(false);
    expect(isSuperadmin2FARequired(401, { detail: { error_code: SUPERADMIN_2FA_REQUIRED } })).toBe(false);
    expect(isSuperadmin2FARequired(403, null)).toBe(false);
  });
});

describe("admin layout gate", () => {
  const SOURCE = readFileSync(
    join(import.meta.dir, "..", "components", "Security", "SuperadminAuthorization.tsx"),
    "utf8",
  );

  test("asks the API and links to the account security page", () => {
    expect(SOURCE).toContain("getSuperadminAccess");
    expect(SOURCE).toContain('href="/account"');
  });
});
