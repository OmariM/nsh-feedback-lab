import type { SpotifyTrack, SpotifyPlaylist, SpotifyTokens } from '../types'

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string
const REDIRECT_URI = `${window.location.origin}/spotify/callback`
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ── Auth flow ─────────────────────────────────────────────────────────────────

export async function initiateSpotifyLogin(): Promise<void> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  sessionStorage.setItem('spotify_verifier', verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

export async function exchangeCodeForTokens(code: string): Promise<SpotifyTokens> {
  const verifier = sessionStorage.getItem('spotify_verifier')
  if (!verifier) throw new Error('Missing code verifier')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!res.ok) throw new Error('Token exchange failed')
  const data = await res.json()

  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }

  sessionStorage.setItem('spotify_tokens', JSON.stringify(tokens))
  sessionStorage.removeItem('spotify_verifier')
  return tokens
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) throw new Error('Token refresh failed')
  const data = await res.json()

  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }

  sessionStorage.setItem('spotify_tokens', JSON.stringify(tokens))
  return tokens
}

export function getStoredTokens(): SpotifyTokens | null {
  const raw = sessionStorage.getItem('spotify_tokens')
  return raw ? (JSON.parse(raw) as SpotifyTokens) : null
}

export async function getValidToken(): Promise<string | null> {
  const tokens = getStoredTokens()
  if (!tokens) return null

  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken
  }

  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken)
    return refreshed.accessToken
  } catch {
    return null
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function spotifyFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Spotify API error: ${res.status} ${path}`)
  if (res.status === 204) return null
  return res.json()
}

export async function fetchUserPlaylists(token: string): Promise<SpotifyPlaylist[]> {
  const data = await spotifyFetch('/me/playlists?limit=50', token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.items.map((item: any) => ({
    id: item.id,
    name: item.name,
    trackCount: item.tracks.total,
    imageUrl: item.images?.[0]?.url,
  }))
}

export async function fetchPlaylistTracks(
  token: string,
  playlistId: string
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(uri,name,duration_ms,artists,album(images)))`

  while (url) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await spotifyFetch(url, token)
    for (const item of data.items) {
      if (!item.track || item.track.uri.startsWith('spotify:local:')) continue
      tracks.push({
        uri: item.track.uri,
        name: item.track.name,
        artist: item.track.artists.map((a: { name: string }) => a.name).join(', '),
        durationMs: item.track.duration_ms,
        albumArt: item.track.album?.images?.[1]?.url,
      })
    }
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : ''
  }

  return tracks
}

export async function playTrack(
  token: string,
  uri: string,
  deviceId: string
): Promise<void> {
  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, token, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri] }),
  })
}

export async function pausePlayback(token: string): Promise<void> {
  await spotifyFetch('/me/player/pause', token, { method: 'PUT' })
}

export async function skipTrack(token: string): Promise<void> {
  await spotifyFetch('/me/player/next', token, { method: 'POST' })
}
