import type { Participant } from '../types'

export function weightedRandom(pool: Participant[]): Participant {
  if (pool.length === 0) throw new Error('Pool is empty')

  const totalWeight = pool.reduce((sum, p) => sum + p.handicap, 0)
  let r = Math.random() * totalWeight

  for (const participant of pool) {
    r -= participant.handicap
    if (r <= 0) return participant
  }

  // Fallback (floating point edge case)
  return pool[pool.length - 1]
}

export function pickPair(
  participants: Participant[],
  currentPair: Participant[] = []
): [Participant, Participant] | null {
  const currentIds = new Set(currentPair.map((p) => p.id))
  const eligible = participants.filter((p) => !currentIds.has(p.id))

  const leads = eligible.filter((p) => p.role === 'lead')
  const follows = eligible.filter((p) => p.role === 'follow')

  if (leads.length === 0 || follows.length === 0) return null

  const lead = weightedRandom(leads)
  const follow = weightedRandom(follows)

  return [lead, follow]
}
