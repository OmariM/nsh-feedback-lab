import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exchangeCodeForTokens } from '../lib/spotify'

export default function SpotifySetup() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam) {
      setError(errorParam)
      setStatus('error')
      return
    }

    if (!code) {
      setError('No authorization code received')
      setStatus('error')
      return
    }

    exchangeCodeForTokens(code)
      .then(() => {
        setStatus('success')
        setTimeout(() => navigate('/session'), 1500)
      })
      .catch((err: Error) => {
        setError(err.message)
        setStatus('error')
      })
  }, [navigate])

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        {status === 'loading' && (
          <>
            <div className="text-2xl font-semibold mb-2">Connecting to Spotify...</div>
            <div className="text-gray-400">Exchanging authorization code</div>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-2xl font-semibold text-emerald-400 mb-2">Connected!</div>
            <div className="text-gray-400">Redirecting to session...</div>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-2xl font-semibold text-red-400 mb-2">Connection failed</div>
            <div className="text-gray-400 mb-6">{error}</div>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Back to Roster
            </button>
          </>
        )}
      </div>
    </div>
  )
}
