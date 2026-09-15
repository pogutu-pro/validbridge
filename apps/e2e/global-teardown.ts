/**
 * Playwright global teardown.
 *
 * The suite runs against an externally-started instance and never tears it
 * down. E2E_KEEP is accepted for backwards compatibility with older invocation
 * scripts.
 */
export default async function globalTeardown(): Promise<void> {
  console.log('Leaving the running instance untouched (managed externally).')
}
