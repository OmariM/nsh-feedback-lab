# NSH Feedback Lab

A session management tool for dance feedback labs. The host runs it on a laptop or projector. Each round, a lead+follow pair is randomly selected, they dance for 2 minutes, then the group gives 3 minutes of feedback. The app handles pair rotation, timers, Spotify playback, and predicted start times.

**Live:** https://nsh-feedback-lab.vercel.app

---

## Running a Session

### 1. Build the roster

Open the app and add all participants on the Roster page. For each person, set their **role** (Lead or Follow) and their **weight** (1–5). Weight controls how often someone is selected — a weight of 3 means they're roughly 3× more likely to be picked than someone with weight 1. Use higher weights for newer dancers who need more practice.

### 2. Generate a schedule (recommended)

On the Session page, click **Generate Schedule**. The app creates a queue that covers every lead×follow combination in weighted-random order, with no dancer appearing twice in a row. Pairs already danced in this session are automatically excluded when you regenerate.

Or skip the schedule and just use **Pick Pair (N)** to pick randomly at any time.

### 3. Run a round

1. Click **Pick Pair** or let the schedule advance to the next pair.
2. Press **Start Round** (or Space) — the 2-minute dance timer begins. Spotify (if connected) plays a random song.
3. When the dance ends (timer or **Finish Early**), the feedback timer starts automatically. Spotify fades out.
4. During feedback, click **Save & Next Pair** to record the round and advance to the next pair.

### 4. Timer adjustments

- **Before a round:** use the −15s / +15s buttons to change the default dance and feedback durations.
- **During a round:** use the −5s / +5s buttons to adjust the live timer without restarting it.

### 5. Predicted times

The schedule panel shows a predicted start time for each upcoming pair. These predictions update in real time based on the rolling average of how long recent rounds and feedback sessions actually took.

---

## Spotify

Connecting Spotify enables in-browser playback from any playlist on your account. **Spotify Premium is required** for the Web Playback SDK.

### Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Under **Redirect URIs**, add `http://127.0.0.1:5173/spotify/callback` (for local dev) and your production URL (e.g. `https://nsh-feedback-lab.vercel.app/spotify/callback`).
3. Copy your **Client ID** into a `.env` file at the project root:
   ```
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   ```
4. On the Session page, click **Connect Spotify**, log in, and select a playlist.

### Embedded player fallback

If you hit Spotify's 25-user developer mode limit (or don't have Premium), paste a playlist URL into the **Embedded playlist** field after connecting. The app will load all tracks from the playlist and show a per-track Spotify embed each round, auto-playing when a round starts and pausing when it ends.

---

## Keyboard Shortcuts

| Key   | Action                         |
|-------|--------------------------------|
| Space | Start round / Pause / Resume   |
| N     | Pick next pair                 |

---

## Participant Weights

The weight (handicap) slider on each participant controls how frequently they're selected:

- Weight 1 = baseline selection probability
- Weight 3 = 3× more likely to be selected than weight 1
- Weight 5 = maximum — use for dancers who need the most practice time

Weights apply independently for leads and follows, so a weight-3 lead paired with a weight-3 follow has 9× the combined probability of a weight-1 × weight-1 pair.

---

## Local Development

```bash
npm install
npm run dev
```

App runs at `http://127.0.0.1:5173`.

Participant data and round history persist in `localStorage` between sessions.
