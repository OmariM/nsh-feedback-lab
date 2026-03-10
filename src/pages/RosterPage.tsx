import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { useLocalStorage } from '../hooks/useLocalStorage'
import type { Participant, Role } from '../types'

const STEPS = [
  {
    label: 'Add participants',
    detail: 'Add everyone who will dance. Set each person as Lead or Follow, and drag the Weight slider higher for newer dancers — they\'ll be picked more often.',
  },
  {
    label: 'Start the session',
    detail: 'Click Start → to go to the Session page. Click Generate Schedule to pre-plan every lead×follow pairing, or just use Pick Pair for a random selection.',
  },
  {
    label: 'Run a round',
    detail: 'Pick a pair, then press Start Round (or Space). The 2-minute dance timer counts down. Music plays automatically if Spotify is connected.',
  },
  {
    label: 'Give feedback',
    detail: 'When dancing ends, a 3-minute feedback timer starts. Music fades out. Click Save & Next Pair when feedback is done — the round is logged and the next pair is selected.',
  },
]

export default function RosterPage() {
  const navigate = useNavigate()
  const [participants, setParticipants] = useLocalStorage<Participant[]>('nsh-participants', [])
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<Role>('lead')
  const [tutorialOpen, setTutorialOpen] = useState(() => {
    try {
      return !localStorage.getItem('nsh-participants') ||
        JSON.parse(localStorage.getItem('nsh-participants')!).length === 0
    } catch {
      return true
    }
  })

  const addParticipant = () => {
    const name = newName.trim()
    if (!name) return
    const p: Participant = {
      id: uuidv4(),
      name,
      role: newRole,
      handicap: 1,
      roundsPlayed: 0,
    }
    setParticipants((prev) => [...prev, p])
    setNewName('')
  }

  const updateHandicap = (id: string, handicap: number) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, handicap } : p))
    )
  }

  const updateRole = (id: string, role: Role) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, role } : p))
    )
  }

  const deleteParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id))
  }

  const leads = participants.filter((p) => p.role === 'lead')
  const follows = participants.filter((p) => p.role === 'follow')
  const canStart = leads.length >= 1 && follows.length >= 1

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">NSH Feedback Lab</h1>
            <p className="text-gray-400 mt-1 text-sm sm:text-base">Manage your participant roster</p>
          </div>
          <button
            onClick={() => navigate('/session')}
            disabled={!canStart}
            className="shrink-0 px-4 py-2 sm:px-5 sm:py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors text-sm sm:text-base"
          >
            Start →
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="bg-gray-900 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-blue-400">{participants.length}</div>
            <div className="text-gray-400 text-xs sm:text-sm">Total</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-purple-400">{leads.length}</div>
            <div className="text-gray-400 text-xs sm:text-sm">Leads</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-pink-400">{follows.length}</div>
            <div className="text-gray-400 text-xs sm:text-sm">Follows</div>
          </div>
        </div>

        {/* Tutorial */}
        <div className="bg-gray-900 rounded-xl overflow-hidden mb-5 sm:mb-6">
          <button
            onClick={() => setTutorialOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-800 transition-colors"
          >
            <span className="font-semibold text-sm sm:text-base">How it works</span>
            <span className="text-gray-400 text-sm">{tutorialOpen ? '▲' : '▼'}</span>
          </button>
          {tutorialOpen && (
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {STEPS.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-700 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">{step.label}</div>
                    <div className="text-gray-400 text-xs mt-0.5 leading-relaxed">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add participant form */}
        <div className="bg-gray-900 rounded-xl p-4 sm:p-5 mb-5 sm:mb-6">
          <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">Add Participant</h2>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <input
              type="text"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addParticipant()}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex gap-2 sm:gap-3">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="flex-1 sm:flex-none bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="lead">Lead</option>
                <option value="follow">Follow</option>
              </select>
              <button
                onClick={addParticipant}
                className="flex-1 sm:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Participant list */}
        {participants.length === 0 ? (
          <div className="text-center text-gray-500 py-16">
            No participants yet. Add some above to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {participants.map((p) => (
              <div key={p.id} className="bg-gray-900 rounded-xl p-4">
                {/* Top row: name + role + delete */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-gray-400 text-sm">{p.roundsPlayed} rounds played</div>
                  </div>
                  <select
                    value={p.role}
                    onChange={(e) => updateRole(p.id, e.target.value as Role)}
                    className={`text-sm font-semibold px-3 py-1.5 rounded-full border-0 focus:outline-none cursor-pointer ${
                      p.role === 'lead'
                        ? 'bg-purple-900 text-purple-300'
                        : 'bg-pink-900 text-pink-300'
                    }`}
                  >
                    <option value="lead">Lead</option>
                    <option value="follow">Follow</option>
                  </select>
                  <button
                    onClick={() => deleteParticipant(p.id)}
                    className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none shrink-0"
                    aria-label="Remove participant"
                  >
                    ✕
                  </button>
                </div>
                {/* Bottom row: handicap slider (full width) */}
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs shrink-0">Weight: {p.handicap}</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.5}
                    value={p.handicap}
                    onChange={(e) => updateHandicap(p.id, parseFloat(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {!canStart && participants.length > 0 && (
          <p className="text-center text-amber-500 text-sm mt-6">
            Need at least 1 lead and 1 follow to start a session.
          </p>
        )}
      </div>
    </div>
  )
}
