import { describe, expect, test } from "bun:test";

import { authScope } from "../lib/query/authScope.ts";

// Regression: the course list was fetched while the login was still loading (no
// token, so only public courses) and cached under a key with no user in it, so it
// kept showing the public list until a hard refresh.
describe("authScope", () => {
  test("is not ready while the session is loading, so nothing fetches as a visitor", () => {
    expect(authScope({ status: "loading", data: null }).ready).toBe(false);
  });

  test("is ready once signed in or confirmed signed out", () => {
    expect(authScope({ status: "authenticated", data: { user: { user_uuid: "u1" } } }).ready).toBe(true);
    expect(authScope({ status: "unauthenticated", data: null }).ready).toBe(true);
  });

  test("a signed-in user and a visitor never share a cache entry", () => {
    const visitor = authScope({ status: "unauthenticated", data: null }).who;
    const user = authScope({ status: "authenticated", data: { user: { user_uuid: "u1" } } }).who;
    const other = authScope({ status: "authenticated", data: { user: { user_uuid: "u2" } } }).who;
    expect(visitor).toBe("anon");
    expect(user).not.toBe(visitor);
    expect(user).not.toBe(other);
  });

  test("falls back to a token check when the user object is missing, and tolerates no session", () => {
    expect(authScope({ status: "authenticated", data: { tokens: { access_token: "t" } } }).who).toBe("user");
    expect(authScope(null).ready).toBe(true);
    expect(authScope(null).who).toBe("anon");
  });
});
