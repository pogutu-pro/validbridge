import type { Participant } from 'livekit-client'
import { HAND_ATTRIBUTE, type LiveRole } from '@services/live/live'

/** Role from the server-signed token metadata (participants cannot edit it). */
export function participantRole(participant: Participant): LiveRole {
  try {
    const role = JSON.parse(participant.metadata || '{}')?.role
    if (role === 'instructor' || role === 'moderator' || role === 'learner') return role
  } catch {
    /* malformed metadata → least privilege */
  }
  return 'learner'
}

export function participantName(participant: Participant): string {
  return participant.name || participant.identity
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Epoch ms the hand went up, or null. */
export function handRaisedAt(participant: Participant): number | null {
  const raw = participant.attributes?.[HAND_ATTRIBUTE]
  const value = raw ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

export function roleLabelKey(role: LiveRole): string {
  return role === 'instructor' ? 'live.roles.instructor' : role === 'moderator' ? 'live.roles.moderator' : 'live.roles.learner'
}

// Muted, legible avatar backgrounds (white text passes contrast on all).
const AVATAR_COLORS = ['#1a73e8', '#188038', '#c5221f', '#e37400', '#9334e6', '#12848e', '#b31412', '#5f6368', '#1967d2', '#a142f4']

/** Stable colour per participant, Meet-style. */
export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
