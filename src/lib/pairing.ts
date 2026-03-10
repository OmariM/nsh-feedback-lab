import type { Participant } from '../types'

export function weightedRandom(pool: Participant[]): Participant {
  if (pool.length === 0) throw new Error('Pool is empty')

  const totalWeight = pool.reduce((sum, p) => sum + p.handicap, 0)
  let r = Math.random() * totalWeight

  for (const participant of pool) {
    r -= participant.handicap
    if (r <= 0) return participant
  }

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

// Build a full session queue: every lead×follow combo in weighted-random order.
// Pass `exclude` (a Set of "leadId|followId" strings) to skip already-played pairs.
export function buildSessionQueue(
  participants: Participant[],
  exclude: Set<string> = new Set()
): [Participant, Participant][] {
  const leads = participants.filter((p) => p.role === 'lead')
  const follows = participants.filter((p) => p.role === 'follow')

  const combos: [Participant, Participant][] = []
  for (const l of leads) {
    for (const f of follows) {
      if (!exclude.has(`${l.id}|${f.id}`)) combos.push([l, f])
    }
  }

  // Weighted shuffle: at each step prefer pairs that don't repeat either
  // dancer from the previous pair. Fall back to any remaining pair only if
  // no non-overlapping option exists (e.g. very small roster).
  const result: [Participant, Participant][] = []
  const pool = [...combos]
  let lastPair: [Participant, Participant] | null = null

  while (pool.length > 0) {
    const lastIds = new Set<string>(lastPair ? [lastPair[0].id, lastPair[1].id] : [])
    const preferred = pool.filter(([l, f]: [Participant, Participant]) => !lastIds.has(l.id) && !lastIds.has(f.id))
    const candidates: [Participant, Participant][] = preferred.length > 0 ? preferred : pool

    const weights = candidates.map(([l, f]: [Participant, Participant]) => l.handicap * f.handicap)
    const total = weights.reduce((a: number, b: number) => a + b, 0)
    let r = Math.random() * total
    let idx = candidates.length - 1

    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]
      if (r <= 0) {
        idx = i
        break
      }
    }

    const chosen = candidates[idx]
    result.push(chosen)
    lastPair = chosen
    pool.splice(pool.indexOf(chosen), 1)
  }

  return result
}
