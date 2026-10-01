import type { LivePoll } from '@services/live/live'

/**
 * Pure helpers for LiveBridge timers and live results (unit-tested in
 * tests/live-classroom.test.mjs).
 */

/** How far the server clock is ahead of this device, from a response's server_time. */
export function serverOffsetMs(serverTimeIso: string | null | undefined, receivedAt: number = Date.now()): number {
  if (!serverTimeIso) return 0
  const server = Date.parse(serverTimeIso)
  return Number.isFinite(server) ? server - receivedAt : 0
}

/** Whole seconds until a server deadline (never negative); null without one. */
export function secondsLeft(deadlineIso: string | null | undefined, offsetMs = 0, now: number = Date.now()): number | null {
  if (!deadlineIso) return null
  const deadline = Date.parse(deadlineIso)
  if (!Number.isFinite(deadline)) return null
  return Math.max(0, Math.ceil((deadline - (now + offsetMs)) / 1000))
}

/** 75 → "1:15", 5 → "0:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 3900 → "1h 5m", 125 → "2m", 20 → "<1m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return m > 0 ? `${m}m` : '<1m'
}

/**
 * Apply a server "results" broadcast to cached polls. Counts are only filled
 * in where this viewer may already see them (staff, voters, closed polls):
 * a learner who hasn't voted keeps `counts: null`.
 */
export function mergePollResults(
  polls: LivePoll[] | undefined,
  update: { poll_uuid: string; counts: number[]; total_votes: number }
): LivePoll[] | undefined {
  if (!polls) return polls
  return polls.map((poll) =>
    poll.poll_uuid === update.poll_uuid && poll.counts !== null
      ? { ...poll, counts: update.counts, total_votes: update.total_votes }
      : poll
  )
}

export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/**
 * How media actually reached this browser: `host/udp` (direct), `srflx/udp`
 * (through NAT), `…/tcp` (LiveKit's TCP fallback) or `relay/…` (TURN).
 * Read from the selected ICE candidate pair of any live track.
 */
export function transportFromStats(report: RTCStatsReport | undefined): string | null {
  if (!report) return null
  const byId = new Map<string, any>()
  report.forEach((stat: any) => byId.set(stat.id, stat))
  let pair: any = null
  report.forEach((stat: any) => {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = byId.get(stat.selectedCandidatePairId) ?? pair
  })
  if (!pair) {
    report.forEach((stat: any) => {
      if (!pair && stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) pair = stat
    })
  }
  const local = pair ? byId.get(pair.localCandidateId) : null
  if (!local) return null
  const type = local.candidateType ?? 'unknown'
  const protocol = type === 'relay' ? local.relayProtocol ?? local.protocol : local.protocol
  return `${type}/${protocol ?? 'unknown'}`
}
