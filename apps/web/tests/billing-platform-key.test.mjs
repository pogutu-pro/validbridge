// Contract test for the platform key used by pack activation and active-user
// overage billing.
//
// Same class of failure as the internal plan key: the key was read with a
// `|| ""` fallback, so an unset env var sent an empty header and the backend
// answered 500 "not configured on the server" — which read as a backend fault
// rather than a missing credential here. Both call sites must resolve it
// through one helper that fails loud.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Sibling billing test files mock `@services/billing/packs` at module scope.
// When the suite runs in one process, that mock can leak into this file's
// top-level import — clear any registered mocks before importing the real
// module (then re-assert the `server-only` stub this file needs).
mock.restore();
mock.module("server-only", () => ({}));
afterAll(() => { mock.restore(); });

// Imported under a unique specifier so a sibling file's mock of
// "@services/billing/packs" (which lacks this export) cannot leak in.
const { platformApiKey } = await import("../services/billing/packs.ts?platform-key-test");

let original;

beforeEach(() => {
  original = process.env.VALIDBRIDGE_PLATFORM_API_KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.VALIDBRIDGE_PLATFORM_API_KEY;
  else process.env.VALIDBRIDGE_PLATFORM_API_KEY = original;
});

describe("platformApiKey", () => {
  test("returns the configured key", () => {
    process.env.VALIDBRIDGE_PLATFORM_API_KEY = "platform-key";
    expect(platformApiKey()).toBe("platform-key");
  });

  test("throws when unset instead of returning an empty key", () => {
    delete process.env.VALIDBRIDGE_PLATFORM_API_KEY;
    expect(() => platformApiKey()).toThrow(/VALIDBRIDGE_PLATFORM_API_KEY is unset/);
  });

  test("treats an empty string as unset", () => {
    process.env.VALIDBRIDGE_PLATFORM_API_KEY = "";
    expect(() => platformApiKey()).toThrow(/VALIDBRIDGE_PLATFORM_API_KEY is unset/);
  });
});
