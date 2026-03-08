import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTimer } from '../hooks/useTimer'
import { useSpotify } from '../hooks/useSpotify'
import { pickPair } from '../lib/pairing'
import { initiateSpotifyLogin } from '../lib/spotify'
import type { Participant, Round, SessionPhase } from '../types'

const DANCE_SECONDS = 60
const FEEDBACK_SECONDS = 180

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

export default function SessionPage() {
  const navigate = useNavigate()
  const [participants, setParticipants] = useLocalStorage<Participant[]>('nsh-participants', [])
  const [rounds, setRounds] = useLocalStorage<Round[]>('nsh-rounds', [])
  const [currentPair, setCurrentPair] = useState<[Participant, Participant] | null>(null)
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [trackSearch, setTrackSearch] = useState('')
  const [showTrackList, setShowTrackList] = useState(false)

  const spotify = useSpotify()

  // ── Phase transitions ──────────────────────────────────────────────────────

  const onDanceEnd = useCallback(() => {
    beep(660, 0.4)
    setPhase('feedback')
    feedbackTimer.start(FEEDBACK_SECONDS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFeedbackEnd = useCallback(() => {
    beep(880, 0.2)
    setTimeout(() => beep(880, 0.2), 300)
    setPhase('idle')
  }, [])

  const danceTimer = useTimer(onDanceEnd)
  const feedbackTimer = useTimer(onFeedbackEnd)

  const activeTimer = phase === 'dancing' ? danceTimer : feedbackTimer

  // ── Pair management ────────────────────────────────────────────────────────

  const pickNext = useCallback(() => {
    const pair = pickPair(participants, currentPair ?? [])
    setCurrentPair(pair)
    setPhase('idle')
    danceTimer.stop()
    feedbackTimer.stop()
  }, [participants, currentPair, danceTimer, feedbackTimer])

  const startRound = useCallback(() => {
    if (!currentPair) return
    setPhase('dancing')
    danceTimer.start(DANCE_SECONDS)
    spotify.playRandom()
  }, [currentPair, danceTimer, spotify])

  const endRound = useCallback(() => {
    if (!currentPair) return

    // Record round
    const [lead, follow] = currentPair
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

    // Update rounds played
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === lead.id || p.id === follow.id
          ? { ...p, roundsPlayed: p.roundsPlayed + 1 }
          : p
      )
    )

    danceTimer.stop()
    feedbackTimer.stop()
    setPhase('idle')
    setCurrentPair(null)
  }, [currentPair, spotify.currentTrack, setRounds, setParticipants, danceTimer, feedbackTimer])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

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
        pickNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, currentPair, startRound, activeTimer, pickNext])

  // ── Timer pulse on last 10s ────────────────────────────────────────────────

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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Roster
        </button>
        <h1 className="font-bold text-lg">NSH Feedback Lab</h1>
        <div className="text-gray-400 text-sm">{rounds.length} rounds today</div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Current pair display */}
        <div className="bg-gray-900 rounded-2xl p-8 text-center">
          {currentPair ? (
            <>
              <div className="flex items-center justify-center gap-8 mb-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-purple-400 mb-1">Lead</div>
                  <div className="text-4xl font-bold">{currentPair[0].name}</div>
                </div>
                <div className="text-gray-600 text-3xl">×</div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-pink-400 mb-1">Follow</div>
                  <div className="text-4xl font-bold">{currentPair[1].name}</div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-gray-500 text-xl py-4">No pair selected</div>
          )}
        </div>

        {/* Timer + phase */}
        <div className="bg-gray-900 rounded-2xl p-8 text-center">
          <div className={`text-xs uppercase tracking-widest mb-3 ${phaseColor}`}>
            {phaseLabel}
          </div>
          <div
            className={`text-8xl font-mono font-bold tabular-nums transition-all ${phaseColor} ${
              isUrgent ? 'animate-pulse' : ''
            }`}
          >
            {phase !== 'idle' ? activeTimer.formatted : '--:--'}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={pickNext}
            className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
          >
            Pick Pair (N)
          </button>

          {phase === 'idle' && (
            <button
              onClick={startRound}
              disabled={!currentPair}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors"
            >
              Start Round (Space)
            </button>
          )}

          {(phase === 'dancing' || phase === 'feedback') && (
            <>
              <button
                onClick={activeTimer.pause}
                className="px-5 py-2.5 bg-yellow-700 hover:bg-yellow-600 rounded-lg font-semibold transition-colors"
              >
                {activeTimer.running ? 'Pause (Space)' : 'Resume (Space)'}
              </button>
              <button
                onClick={activeTimer.skip}
                className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
              >
                Skip Timer
              </button>
            </>
          )}

          {phase === 'feedback' && (
            <button
              onClick={endRound}
              className="px-5 py-2.5 bg-red-800 hover:bg-red-700 rounded-lg font-semibold transition-colors"
            >
              End &amp; Save Round
            </button>
          )}
        </div>

        {/* Spotify mini-player */}
        <div className="bg-gray-900 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Music</h2>
            {!spotify.isAuthenticated && (
              <button
                onClick={initiateSpotifyLogin}
                className="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg transition-colors"
              >
                Connect Spotify
              </button>
            )}
          </div>

          {spotify.isAuthenticated && (
            <>
              {/* Playlist selector */}
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
                </div>
              )}

              {/* Current track */}
              {spotify.currentTrack ? (
                <div className="flex items-center gap-4 mb-4">
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
                  <button
                    onClick={spotify.playRandom}
                    disabled={!spotify.deviceId}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm transition-colors"
                  >
                    Random
                  </button>
                </div>
              ) : (
                <div className="text-gray-500 text-sm mb-4">No track playing</div>
              )}

              {/* Track list toggle */}
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

      {/* Keyboard hint */}
      <div className="text-center text-gray-700 text-xs pb-6">
        Space: start/pause · N: next pair
      </div>
    </div>
  )
}
