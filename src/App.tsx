import { BrowserRouter, Routes, Route } from 'react-router-dom'
import RosterPage from './pages/RosterPage'
import SessionPage from './pages/SessionPage'
import SpotifySetup from './pages/SpotifySetup'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RosterPage />} />
        <Route path="/session" element={<SessionPage />} />
        <Route path="/spotify/callback" element={<SpotifySetup />} />
      </Routes>
    </BrowserRouter>
  )
}
