const FALLBACK_REDIRECT = '/account'

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function safeInternalRedirect(value: unknown, fallback = FALLBACK_REDIRECT): string {
  if (typeof value !== 'string') return fallback
  const candidate = value.trim()
  if (
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    containsControlCharacter(candidate)
  ) {
    return fallback
  }
  return candidate
}
