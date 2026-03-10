import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTimer } from '../hooks/useTimer'
import { useSpotify } from '../hooks/useSpotify'
import { buildSessionQueue } from '../lib/pairing'
import { initiateSpotifyLogin } from '../lib/spotify'
import type { Participant, Round, SessionPhase } from '../types'

const DEFAULT_DANCE_SECONDS = 120
const DEFAULT_FEEDBACK_SECONDS = 180

function beep(frequency = 880, duration = 0.2) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {
    // AudioContext not available
  }
}

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function SessionPage() {
  const navigate = useNavigate()
  const [participants, setParticipants] = useLocalStorage<Participant[]>('nsh-participants', [])
  const [rounds, setRounds] = useLocalStorage<Round[]>('nsh-rounds', [])
  const [currentPair, setCurrentPair] = useState<[Participant, Participant] | null>(null)
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [trackSearch, setTrackSearch] = useState('')
  const [showTrackList, setShowTrackList] = useState(false)

  // Timer durations (adjustable before round starts)
  const [danceDuration, setDanceDuration] = useState(DEFAULT_DANCE_SECONDS)
  const [feedbackDuration, setFeedbackDuration] = useState(DEFAULT_FEEDBACK_SECONDS)

  // Use refs so callbacks always see latest values without re-creating timers
  const feedbackDurationRef = useRef(feedbackDuration)
  feedbackDurationRef.current = feedbackDuration

  // Session schedule queue
  const [sessionQueue, setSessionQueue] = useState<[Participant, Participant][]>([])
  const [queueIndex, setQueueIndex] = useState(0)

  // Track used lead×follow combos to enforce all-pairs-before-repeat
  const usedPairsRef = useRef<Set<string>>(new Set())

  // Actual round durations for predicting future start times
  const [completedSlots, setCompletedSlots] = useState<{ dance: number; feedback: number }[]>([])
  const danceStartRef = useRef(0)
  const feedbackStartRef = useRef(0)
  const danceActualRef = useRef(0) // actual dance seconds, set when dance ends

  const spotify = useSpotify()

  // ── Phase transitions ───────────────────────────────────────────────────────

  const onDanceEnd = useCallback(() => {
    beep(660, 0.4)
    spotify.fadeOut()
    danceActualRef.current = danceStartRef.current > 0
      ? (Date.now() - danceStartRef.current) / 1000
      : feedbackDurationRef.current
    feedbackStartRef.current = Date.now()
    setPhase('feedback')
    feedbackTimer.start(feedbackDurationRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify])

  const onFeedbackEnd = useCallback(() => {
    beep(880, 0.2)
    setTimeout(() => beep(880, 0.2), 300)
    if (danceActualRef.current > 0 && feedbackStartRef.current > 0) {
      const feedbackActual = (Date.now() - feedbackStartRef.current) / 1000
      setCompletedSlots((prev) => [
        ...prev,
        { dance: danceActualRef.current, feedback: feedbackActual },
      ])
      danceActualRef.current = 0
      feedbackStartRef.current = 0
    }
    setPhase('idle')
  }, [])

  const danceTimer = useTimer(onDanceEnd)
  const feedbackTimer = useTimer(onFeedbackEnd)

  const activeTimer = phase === 'dancing' ? danceTimer : feedbackTimer

  // ── Pair management ─────────────────────────────────────────────────────────

  const pickNextPair = useCallback(
    (afterPair: [Participant, Participant] | null = currentPair) => {
      let pair: [Participant, Participant] | null = null

      // Use queue if available (constraint already enforced at generation time)
      if (queueIndex < sessionQueue.length) {
        pair = sessionQueue[queueIndex]
        setQueueIndex((qi) => qi + 1)
      } else {
        // Random with no-repeat: build available combos, exclude current pair
        const currentIds = new Set((afterPair ?? []).map((p) => p.id))
        const leads = participants.filter((p) => p.role === 'lead' && !currentIds.has(p.id))
        const follows = participants.filter((p) => p.role === 'follow' && !currentIds.has(p.id))

        let available: [Participant, Participant][] = []
        for (const l of leads) {
          for (const f of follows) {
            if (!usedPairsRef.current.has(`${l.id}|${f.id}`)) {
              available.push([l, f])
            }
          }
        }

        // All combos exhausted — reset and start new cycle
        if (available.length === 0) {
          usedPairsRef.current.clear()
          for (const l of leads) {
            for (const f of follows) {
              available.push([l, f])
            }
          }
        }

        if (available.length === 0) return

        // Weighted pick by combined handicap
        const weights = available.map(([l, f]) => l.handicap * f.handicap)
        const total = weights.reduce((a, b) => a + b, 0)
        let r = Math.random() * total
        let idx = available.length - 1
        for (let i = 0; i < available.length; i++) {
          r -= weights[i]
          if (r <= 0) { idx = i; break }
        }
        pair = available[idx]
      }

      if (!pair) return
      usedPairsRef.current.add(`${pair[0].id}|${pair[1].id}`)
      setCurrentPair(pair)
      setPhase('idle')
      danceTimer.stop()
      feedbackTimer.stop()
    },
    [currentPair, participants, sessionQueue, queueIndex, danceTimer, feedbackTimer]
  )

  const generateSchedule = useCallback(() => {
    const queue = buildSessionQueue(participants)
    setSessionQueue(queue)
    setQueueIndex(0)
    usedPairsRef.current.clear()
    setScheduleOpen(true)
  }, [participants])

  const startRound = useCallback(() => {
    if (!currentPair) return
    danceStartRef.current = Date.now()
    setPhase('dancing')
    danceTimer.start(danceDuration)
    spotify.playRandom()
  }, [currentPair, danceTimer, danceDuration, spotify])

  const saveRound = useCallback(
    (pair: [Participant, Participant]) => {
      const [lead, follow] = pair
      const round: Round = {
        id: uuidv4(),
        leadId: lead.id,
        followId: follow.id,
        leadName: lead.name,
        followName: follow.name,
        songUri: spotify.currentTrack?.uri ?? '',
        songTitle: spotify.currentTrack?.name ?? '',
        timestamp: new Date().toISOString(),
      }
      setRounds((prev) => [...prev, round])
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === lead.id || p.id === follow.id
            ? { ...p, roundsPlayed: p.roundsPlayed + 1 }
            : p
        )
      )
    },
    [spotify.currentTrack, setRounds, setParticipants]
  )

  // "Finish Dance Early" — same transition as timer expiring
  const finishDanceEarly = useCallback(() => {
    danceTimer.skip()
  }, [danceTimer])

  // "Save & Next Pair" — end feedback, save round, pick next
  const saveAndNext = useCallback(() => {
    if (!currentPair) return
    const savedPair = currentPair
    saveRound(currentPair)
    // Record actual slot durations before stopping
    if (danceActualRef.current > 0 && feedbackStartRef.current > 0) {
      const feedbackActual = (Date.now() - feedbackStartRef.current) / 1000
      setCompletedSlots((prev) => [
        ...prev,
        { dance: danceActualRef.current, feedback: feedbackActual },
      ])
      danceActualRef.current = 0
      feedbackStartRef.current = 0
    }
    danceTimer.stop()
    feedbackTimer.stop()
    setPhase('idle')
    setCurrentPair(null)
    // Pass the just-finished pair so neither dancer is picked again immediately
    pickNextPair(savedPair)
  }, [currentPair, saveRound, danceTimer, feedbackTimer, pickNextPair])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return

      if (e.code === 'Space') {
        e.preventDefault()
        if (phase === 'idle' && currentPair) startRound()
        else if (phase === 'dancing' || phase === 'feedback') activeTimer.pause()
      }
      if (e.code === 'KeyN') {
        e.preventDefault()
        pickNextPair()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, currentPair, startRound, activeTimer, pickNextPair])

  // ── Derived UI state ────────────────────────────────────────────────────────

  const isUrgent = activeTimer.timeLeft > 0 && activeTimer.timeLeft <= 10

  const phaseColor =
    phase === 'dancing'
      ? 'text-emerald-400'
      : phase === 'feedback'
      ? 'text-amber-400'
      : 'text-gray-400'

  const phaseLabel =
    phase === 'dancing' ? 'Dancing' : phase === 'feedback' ? 'Feedback' : 'Ready'

  const filteredTracks = spotify.tracks.filter(
    (t) =>
      t.name.toLowerCase().includes(trackSearch.toLowerCase()) ||
      t.artist.toLowerCase().includes(trackSearch.toLowerCase())
  )

  const queueRemaining = sessionQueue.slice(queueIndex)
  const queueDone = sessionQueue.slice(0, queueIndex)

  // ── Predicted start times ────────────────────────────────────────────────
  const avgDance = completedSlots.length > 0
    ? completedSlots.reduce((s, r) => s + r.dance, 0) / completedSlots.length
    : danceDuration
  const avgFeedback = completedSlots.length > 0
    ? completedSlots.reduce((s, r) => s + r.feedback, 0) / completedSlots.length
    : feedbackDuration
  const avgSlotSec = avgDance + avgFeedback

  const msUntilNextPair =
    phase === 'dancing'
      ? (danceTimer.timeLeft + avgFeedback) * 1000
      : phase === 'feedback'
      ? feedbackTimer.timeLeft * 1000
      : 0

  const predictedTimes = queueRemaining.map((_, i) =>
    new Date(Date.now() + msUntilNextPair + i * avgSlotSec * 1000)
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-800">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Roster
        </button>
        <h1 className="font-bold text-base sm:text-lg">NSH Feedback Lab</h1>
        <div className="text-gray-400 text-sm">{rounds.length} rounds</div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4 sm:space-y-6">
        {/* Current pair display */}
        <div className="bg-gray-900 rounded-2xl p-5 sm:p-8 text-center">
          {currentPair ? (
            <div className="flex items-center justify-center gap-4 sm:gap-8">
              <div>
                <div className="text-xs uppercase tracking-widest text-purple-400 mb-1">Lead</div>
                <div className="text-2xl sm:text-4xl font-bold">{currentPair[0].name}</div>
              </div>
              <div className="text-gray-600 text-xl sm:text-3xl">×</div>
              <div>
                <div className="text-xs uppercase tracking-widest text-pink-400 mb-1">Follow</div>
                <div className="text-2xl sm:text-4xl font-bold">{currentPair[1].name}</div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-lg py-3">No pair selected</div>
          )}
        </div>

        {/* Timer + phase */}
        <div className="bg-gray-900 rounded-2xl p-5 sm:p-8 text-center">
          <div className={`text-xs uppercase tracking-widest mb-2 sm:mb-3 ${phaseColor}`}>
            {phaseLabel}
          </div>
          <div
            className={`text-6xl sm:text-8xl font-mono font-bold tabular-nums transition-all ${phaseColor} ${
              isUrgent ? 'animate-pulse' : ''
            }`}
          >
            {phase !== 'idle' ? activeTimer.formatted : '--:--'}
          </div>

          {/* Live timer adjustments (during a round) */}
          {phase !== 'idle' && (
            <div className="flex items-center justify-center gap-3 mt-4 sm:mt-5">
              <button
                onClick={() => activeTimer.adjust(-5)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
              >
                −5s
              </button>
              <span className="text-gray-500 text-xs sm:text-sm w-16">live adjust</span>
              <button
                onClick={() => activeTimer.adjust(5)}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
              >
                +5s
              </button>
            </div>
          )}

          {/* Starting duration adjustments (when idle) */}
          {phase === 'idle' && (
            <div className="flex flex-col items-center gap-2 sm:gap-3 mt-4 sm:mt-5">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setDanceDuration((d) => Math.max(15, d - 15))}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
                >
                  −15s
                </button>
                <span className="text-gray-400 text-sm w-32 text-center">
                  Dance: {fmtDuration(danceDuration)}
                </span>
                <button
                  onClick={() => setDanceDuration((d) => d + 15)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
                >
                  +15s
                </button>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setFeedbackDuration((d) => Math.max(15, d - 15))}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
                >
                  −15s
                </button>
                <span className="text-gray-400 text-sm w-32 text-center">
                  Feedback: {fmtDuration(feedbackDuration)}
                </span>
                <button
                  onClick={() => setFeedbackDuration((d) => d + 15)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-mono transition-colors"
                >
                  +15s
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
          <button
            onClick={() => pickNextPair()}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors text-sm sm:text-base"
          >
            Pick Pair (N)
          </button>

          <button
            onClick={generateSchedule}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-700 hover:bg-indigo-600 rounded-lg font-semibold transition-colors text-sm sm:text-base"
          >
            Generate Schedule
          </button>

          {phase === 'idle' && (
            <button
              onClick={startRound}
              disabled={!currentPair}
              className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
            >
              Start Round (Space)
            </button>
          )}

          {(phase === 'dancing' || phase === 'feedback') && (
            <button
              onClick={activeTimer.pause}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-yellow-700 hover:bg-yellow-600 rounded-lg font-semibold transition-colors text-sm sm:text-base"
            >
              {activeTimer.running ? 'Pause' : 'Resume'}
            </button>
          )}

          {phase === 'dancing' && (
            <button
              onClick={finishDanceEarly}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-orange-700 hover:bg-orange-600 rounded-lg font-semibold transition-colors text-sm sm:text-base"
            >
              Finish Early
            </button>
          )}

          {phase === 'feedback' && (
            <button
              onClick={saveAndNext}
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg font-semibold transition-colors"
            >
              Save &amp; Next Pair
            </button>
          )}
        </div>

        {/* Session schedule */}
        {sessionQueue.length > 0 && (
          <div className="bg-gray-900 rounded-2xl overflow-hidden">
            <button
              onClick={() => setScheduleOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800 transition-colors"
            >
              <span className="font-semibold">
                Schedule ({queueRemaining.length} remaining of {sessionQueue.length})
              </span>
              <div className="flex items-center gap-3">
                {completedSlots.length > 0 && (
                  <span className="text-gray-500 text-xs">
                    avg {fmtDuration(Math.round(avgSlotSec))}/round
                  </span>
                )}
                <span className="text-gray-400">{scheduleOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {scheduleOpen && (
              <div className="px-5 pb-5 max-h-72 overflow-y-auto space-y-1">
                {/* Completed */}
                {queueDone.map((pair, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 opacity-35">
                    <div className="text-gray-500 text-xs w-6">{i + 1}</div>
                    <div className="text-sm line-through flex-1">
                      <span className="text-purple-300">{pair[0].name}</span>
                      <span className="text-gray-500 mx-2">×</span>
                      <span className="text-pink-300">{pair[1].name}</span>
                    </div>
                  </div>
                ))}

                {/* Upcoming */}
                {queueRemaining.map((pair, i) => {
                  const globalIdx = queueIndex + i
                  const isCurrent = queueIndex > 0 && i === 0 && phase !== 'idle'
                  const predicted = predictedTimes[i]
                  const timeStr = predicted.toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                  return (
                    <div
                      key={globalIdx}
                      className={`flex items-center gap-3 py-1.5 rounded-lg ${
                        isCurrent ? 'bg-gray-800 px-2' : ''
                      }`}
                    >
                      <div className="text-gray-500 text-xs w-6">{globalIdx + 1}</div>
                      <div className="text-sm flex-1">
                        <span className="text-purple-300">{pair[0].name}</span>
                        <span className="text-gray-500 mx-2">×</span>
                        <span className="text-pink-300">{pair[1].name}</span>
                      </div>
                      <div className="text-gray-400 text-xs tabular-nums">{timeStr}</div>
                      {i === 0 && !isCurrent && (
                        <span className="text-xs text-emerald-400">next</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Spotify mini-player */}
        <div className="bg-gray-900 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Music</h2>
            {!spotify.authChecking && !spotify.isAuthenticated && (
              <button
                onClick={initiateSpotifyLogin}
                className="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg transition-colors"
              >
                Connect Spotify
              </button>
            )}
          </div>

          {/* Auth checking */}
          {spotify.authChecking && (
            <p className="text-gray-500 text-sm">Checking Spotify connection...</p>
          )}

          {/* Not authenticated */}
          {!spotify.authChecking && !spotify.isAuthenticated && (
            <p className="text-gray-500 text-sm">
              Connect your Spotify account to enable music playback.
            </p>
          )}

          {spotify.isAuthenticated && (
            <>
              {/* Player status */}
              {spotify.playerError && (
                <div className="mb-4 text-sm text-red-400 bg-red-950 rounded-lg px-3 py-2">
                  {spotify.playerError}
                </div>
              )}
              {!spotify.playerError && spotify.playerConnecting && (
                <p className="text-gray-500 text-sm mb-4">Connecting player...</p>
              )}

              {/* Playlist section */}
              {spotify.playlistsLoading && (
                <p className="text-gray-500 text-sm mb-4">Loading playlists...</p>
              )}
              {spotify.playlistsError && (
                <div className="mb-4 flex items-center gap-3">
                  <p className="text-red-400 text-sm flex-1">{spotify.playlistsError}</p>
                  <button
                    onClick={spotify.retryPlaylists}
                    className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!spotify.playlistsLoading && !spotify.playlistsError && spotify.playlists.length === 0 && (
                <p className="text-gray-500 text-sm mb-4">
                  No playlists found on your Spotify account.
                </p>
              )}
              {spotify.playlists.length > 0 && (
                <div className="mb-4">
                  <select
                    value={spotify.selectedPlaylistId ?? ''}
                    onChange={(e) => spotify.selectPlaylist(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select a playlist...</option>
                    {spotify.playlists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name} ({pl.trackCount} tracks)
                      </option>
                    ))}
                  </select>
                  {spotify.tracksLoading && (
                    <p className="text-gray-500 text-xs mt-2">Loading tracks...</p>
                  )}
                  {spotify.tracksError && (
                    <p className="text-red-400 text-xs mt-2">{spotify.tracksError}</p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-4 mb-4">
                {spotify.currentTrack ? (
                  <>
                    {spotify.currentTrack.albumArt && (
                      <img
                        src={spotify.currentTrack.albumArt}
                        alt="Album art"
                        className="w-12 h-12 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{spotify.currentTrack.name}</div>
                      <div className="text-gray-400 text-sm truncate">{spotify.currentTrack.artist}</div>
                    </div>
                    <button
                      onClick={spotify.togglePlay}
                      className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center transition-colors"
                    >
                      {spotify.isPlaying ? '⏸' : '▶'}
                    </button>
                  </>
                ) : (
                  <div className="flex-1 text-gray-500 text-sm">No track playing</div>
                )}
                {spotify.tracks.length > 0 && (
                  <button
                    onClick={spotify.playRandom}
                    disabled={!spotify.deviceId}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
                  >
                    🎲 Random Song
                  </button>
                )}
              </div>

              {spotify.tracks.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowTrackList((v) => !v)}
                    className="text-sm text-gray-400 hover:text-white transition-colors mb-3"
                  >
                    {showTrackList ? '▾' : '▸'} Track list ({spotify.tracks.length})
                  </button>

                  {showTrackList && (
                    <>
                      <input
                        type="text"
                        placeholder="Search tracks..."
                        value={trackSearch}
                        onChange={(e) => setTrackSearch(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 mb-2"
                      />
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {filteredTracks.map((t) => (
                          <button
                            key={t.uri}
                            onClick={() => spotify.playSpecific(t)}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors text-sm"
                          >
                            <span className="font-medium">{t.name}</span>
                            <span className="text-gray-400 ml-2">{t.artist}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Round history */}
        <div className="bg-gray-900 rounded-2xl overflow-hidden">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800 transition-colors"
          >
            <span className="font-semibold">Round History ({rounds.length})</span>
            <span className="text-gray-400">{historyOpen ? '▲' : '▼'}</span>
          </button>

          {historyOpen && (
            <div className="px-5 pb-5">
              {rounds.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4">No rounds yet</div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {[...rounds].reverse().map((r, i) => (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-gray-800">
                      <div className="text-gray-500 text-xs w-6">{rounds.length - i}</div>
                      <div className="flex-1">
                        <span className="text-purple-300">{r.leadName}</span>
                        <span className="text-gray-500 mx-2">+</span>
                        <span className="text-pink-300">{r.followName}</span>
                      </div>
                      {r.songTitle && (
                        <div className="text-gray-400 text-xs truncate max-w-32">{r.songTitle}</div>
                      )}
                      <div className="text-gray-600 text-xs">
                        {new Date(r.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rounds.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Reset all rounds? Participant roster will be kept.')) {
                      setRounds([])
                      usedPairsRef.current.clear()
                      setSessionQueue([])
                      setQueueIndex(0)
                      setCompletedSlots([])
                    }
                  }}
                  className="mt-3 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Reset session rounds
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-gray-700 text-xs pb-8 hidden sm:block">
        Space: start/pause · N: next pair
      </div>
    </div>
  )
}
