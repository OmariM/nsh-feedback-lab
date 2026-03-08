export type Role = 'lead' | 'follow'

export interface Participant {
  id: string
  name: string
  role: Role
  handicap: number   // weight multiplier, default 1
  roundsPlayed: number
}

export interface Round {
  id: string
  leadId: string
  followId: string
  leadName: string
  followName: string
  songUri: string
  songTitle: string
  timestamp: string
}

export interface SpotifyTrack {
  uri: string
  name: string
  artist: string
  durationMs: number
  albumArt?: string
}

export interface SpotifyPlaylist {
  id: string
  name: string
  trackCount: number
  imageUrl?: string
}

export type SessionPhase = 'idle' | 'dancing' | 'feedback'

export interface SessionState {
  participants: Participant[]
  currentPair: [Participant, Participant] | null
  rounds: Round[]
  currentSong: SpotifyTrack | null
  phase: SessionPhase
}

export interface SpotifyTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}
