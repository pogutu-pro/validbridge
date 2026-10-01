/**
 * Returns whether the Enterprise Edition package is installed.
 *
 * Gating is disabled in this build: the instance always reports as fully
 * enabled.
 */
export const useEEStatus = () => {
  return { isEE: true, isLoading: false }
}
