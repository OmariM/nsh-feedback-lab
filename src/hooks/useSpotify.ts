import { useState, useEffect, useRef, useCallback } from 'react'
import type { SpotifyTrack, SpotifyPlaylist } from '../types'
import {
  getValidToken,
  fetchUserPlaylists,
  fetchPlaylistTracks,
  playTrack,
  pausePlayback,
} from '../lib/spotify'

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: {
      Player: new (options: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume: number
      }) => SpotifyPlayer
    }
  }
}

interface SpotifyPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (data: unknown) => void): void
  removeListener(event: string, cb: (data: unknown) => void): void
  getCurrentState(): Promise<unknown>
  pause(): Promise<void>
  resume(): Promise<void>
  setVolume(volume: number): Promise<void>
}

const BASE_VOLUME = 0.8

export function useSpotify() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    () => localStorage.getItem('nsh-spotify-playlist')
  )
  const [tracks, setTracks] = useState<SpotifyTrack[]>([])
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const playedUris = useRef<Set<string>>(new Set())
  const fadingRef = useRef(false)

  // Check auth on mount
  useEffect(() => {
    getValidToken().then((t) => {
      if (t) setIsAuthenticated(true)
    })
  }, [])

  // Load SDK script
  useEffect(() => {
    if (!isAuthenticated) return
    if (document.getElementById('spotify-sdk')) {
      setSdkReady(true)
      return
    }

    const script = document.createElement('script')
    script.id = 'spotify-sdk'
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    document.body.appendChild(script)

    window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true)
  }, [isAuthenticated])

  // Initialize player
  useEffect(() => {
    if (!sdkReady || !isAuthenticated) return

    const player = new window.Spotify.Player({
      name: 'NSH Feedback Lab',
      getOAuthToken: async (cb) => {
        const token = await getValidToken()
        if (token) cb(token)
      },
      volume: BASE_VOLUME,
    })

    player.addListener('ready', (data) => {
      const { device_id } = data as { device_id: string }
      setDeviceId(device_id)
    })

    player.addListener('player_state_changed', (state) => {
      if (!state) return
      const s = state as {
        paused: boolean
        track_window: { current_track: { uri: string; name: string; artists: { name: string }[]; album: { images: { url: string }[] } } }
      }
      setIsPlaying(!s.paused)
      const t = s.track_window?.current_track
      if (t) {
        setCurrentTrack({
          uri: t.uri,
          name: t.name,
          artist: t.artists.map((a) => a.name).join(', '),
          durationMs: 0,
          albumArt: t.album?.images?.[1]?.url,
        })
      }
    })

    player.connect()
    playerRef.current = player

    return () => player.disconnect()
  }, [sdkReady, isAuthenticated])

  // Load playlists when authenticated
  useEffect(() => {
    if (!isAuthenticated) return
    getValidToken().then((token) => {
      if (token) fetchUserPlaylists(token).then(setPlaylists)
    })
  }, [isAuthenticated])

  // Load tracks when playlist selected
  useEffect(() => {
    if (!selectedPlaylistId) return
    getValidToken().then((token) => {
      if (token)
        fetchPlaylistTracks(token, selectedPlaylistId).then((t) => {
          setTracks(t)
          playedUris.current.clear()
        })
    })
  }, [selectedPlaylistId])

  const selectPlaylist = useCallback((id: string) => {
    setSelectedPlaylistId(id)
    localStorage.setItem('nsh-spotify-playlist', id)
  }, [])

  const playRandom = useCallback(async () => {
    if (!deviceId || tracks.length === 0) return
    const token = await getValidToken()
    if (!token) return

    const unplayed = tracks.filter((t) => !playedUris.current.has(t.uri))
    const pool = unplayed.length > 0 ? unplayed : tracks
    if (unplayed.length === 0) playedUris.current.clear()

    const track = pool[Math.floor(Math.random() * pool.length)]
    playedUris.current.add(track.uri)

    // Restore volume before playing in case a fade was in progress
    try { await playerRef.current?.setVolume(BASE_VOLUME) } catch { /* ignore */ }
    await playTrack(token, track.uri, deviceId)
    setCurrentTrack(track)
    setIsPlaying(true)
  }, [deviceId, tracks])

  const playSpecific = useCallback(
    async (track: SpotifyTrack) => {
      if (!deviceId) return
      const token = await getValidToken()
      if (!token) return
      playedUris.current.add(track.uri)
      try { await playerRef.current?.setVolume(BASE_VOLUME) } catch { /* ignore */ }
      await playTrack(token, track.uri, deviceId)
      setCurrentTrack(track)
      setIsPlaying(true)
    },
    [deviceId]
  )

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) return
    if (isPlaying) {
      const token = await getValidToken()
      if (token) await pausePlayback(token)
    } else {
      await playerRef.current.resume()
    }
  }, [isPlaying])

  const pause = useCallback(async () => {
    const token = await getValidToken()
    if (token) await pausePlayback(token)
  }, [])

  // Fade volume to 0 over durationMs, then pause and restore volume
  const fadeOut = useCallback(async (durationMs = 3000) => {
    if (!playerRef.current || fadingRef.current) return
    fadingRef.current = true

    const steps = 20
    const intervalMs = durationMs / steps

    for (let i = steps - 1; i >= 0; i--) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
      if (!fadingRef.current) break // cancelled
      try {
        await playerRef.current?.setVolume((i / steps) * BASE_VOLUME)
      } catch { /* ignore */ }
    }

    const token = await getValidToken()
    if (token) {
      try { await pausePlayback(token) } catch { /* ignore */ }
    }

    // Restore volume for next song
    try { await playerRef.current?.setVolume(BASE_VOLUME) } catch { /* ignore */ }
    fadingRef.current = false
  }, [])

  return {
    isAuthenticated,
    playlists,
    selectedPlaylistId,
    selectPlaylist,
    tracks,
    currentTrack,
    isPlaying,
    deviceId,
    playRandom,
    playSpecific,
    togglePlay,
    pause,
    fadeOut,
  }
}
