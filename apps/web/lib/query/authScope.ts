/**
 * What a query needs to know about the session so it neither runs too early nor
 * is shared between different viewers.
 *
 * The session provider does not block rendering, so a page can mount while the
 * login is still loading. A query that fires then runs without a token, gets the
 * logged-out (public) view, and, because its cache key has no user in it, keeps
 * that view after the login arrives. The page then shows only public courses
 * until a hard refresh. Waiting for the session and keying by who is asking
 * fixes both.
 */
export type AuthScope = {
  /** False while the session is still loading: do not fetch yet. */
  ready: boolean
  /** Distinguishes cached results per viewer: a user id, or 'anon'. */
  who: string
}

export function authScope(session: any): AuthScope {
  const status = session?.status
  const user = session?.data?.user
  return {
    ready: status !== 'loading',
    who: user?.user_uuid ?? user?.id?.toString() ?? (session?.data?.tokens?.access_token ? 'user' : 'anon'),
  }
}
