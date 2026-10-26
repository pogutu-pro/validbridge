// True when a saved answer holds something: any non-empty text, a number, a ticked box, or a non-empty list.
export function hasAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return true
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.some(hasAnswer)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasAnswer)
  return false
}


