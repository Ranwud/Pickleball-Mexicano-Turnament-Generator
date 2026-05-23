import React, { useEffect, useMemo, useState } from 'react'

const SHARED_STATE_URL = '/api/state'
const DEFAULT_TOURNAMENT_NAME = 'Saturday Mexicano Cup'
const DEFAULT_STATE = {
  tournamentName: DEFAULT_TOURNAMENT_NAME,
  players: [],
  round: 0,
  currentRound: null,
  history: [],
  finished: false,
  archivedTournaments: [],
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function load(key, fallback) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback

  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.wins !== a.wins) return b.wins - a.wins
    return a.rests - b.rests
  })
}

function generateRound(players, courts) {
  const sorted = sortPlayers(players)
  const activeSlots = courts * 4

  let active = [...sorted]
  let resting = []

  if (players.length > activeSlots) {
    const needRest = players.length - activeSlots

    resting = [...sorted]
      .sort((a, b) => {
        if (a.rests !== b.rests) return a.rests - b.rests
        return a.gamesPlayed - b.gamesPlayed
      })
      .slice(0, needRest)

    const restingIds = new Set(resting.map((p) => p.id))
    active = sorted.filter((p) => !restingIds.has(p.id))
  }

  const matches = []

  for (let i = 0; i < active.length; i += 4) {
    const group = active.slice(i, i + 4)

    if (group.length < 4) continue

    matches.push({
      court: matches.length + 1,
      teamA: [group[0], group[3]],
      teamB: [group[1], group[2]],
      scoreA: '',
      scoreB: '',
    })
  }

  return { matches, resting }
}

function buildLocalState() {
  return {
    tournamentName: load('pb_tournament_name', DEFAULT_STATE.tournamentName),
    players: load('pb_players', DEFAULT_STATE.players),
    round: load('pb_round', DEFAULT_STATE.round),
    currentRound: load('pb_current_round', DEFAULT_STATE.currentRound),
    history: load('pb_history', DEFAULT_STATE.history),
    finished: load('pb_finished', DEFAULT_STATE.finished),
    archivedTournaments: load('pb_all_tournaments', DEFAULT_STATE.archivedTournaments),
  }
}

async function fetchSharedState() {
  const response = await fetch(SHARED_STATE_URL, {
    method: 'GET',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch shared state: ${response.status}`)
  }

  return response.json()
}

async function pushSharedState(state) {
  const response = await fetch(SHARED_STATE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ state }),
  })

  if (!response.ok) {
    throw new Error(`Failed to save shared state: ${response.status}`)
  }

  return response.json()
}

function PreviousTournaments({ tournaments }) {
  const [opened, setOpened] = useState(null)

  return (
    <div className="bg-white rounded-3xl shadow p-6">
      <h2 className="text-2xl font-semibold mb-4">
        Previous Tournaments
      </h2>

      <div className="space-y-4">
        {tournaments.length === 0 && (
          <div className="text-gray-500">
            No completed tournaments yet.
          </div>
        )}

        {tournaments.map((t) => (
          <div key={t.id} className="border rounded-2xl p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-lg">{t.name}</div>
                <div className="text-sm text-gray-500">{t.date}</div>
              </div>

              <button
                onClick={() => setOpened(opened === t.id ? null : t.id)}
                className="bg-black text-white px-4 py-2 rounded-xl"
              >
                {opened === t.id ? 'Hide' : 'Open'}
              </button>
            </div>

            {opened === t.id && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="font-semibold mb-2">Final Ranking</div>

                  <div className="space-y-2">
                    {t.ranking.map((p, idx) => (
                      <div
                        key={p.id}
                        className="bg-gray-100 rounded-xl px-4 py-2 flex justify-between"
                      >
                        <div>
                          #{idx + 1} {p.name}
                        </div>
                        <div>{p.points} pts</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PickleballMexicanoManager() {
  const [mode, setMode] = useState('viewer')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')

  const [tournamentName, setTournamentName] = useState(DEFAULT_TOURNAMENT_NAME)
  const [playerName, setPlayerName] = useState('')
  const [courts, setCourts] = useState(3)

  const [players, setPlayers] = useState(() => load('pb_players', DEFAULT_STATE.players))
  const [round, setRound] = useState(() => load('pb_round', DEFAULT_STATE.round))
  const [currentRound, setCurrentRound] = useState(() => load('pb_current_round', DEFAULT_STATE.currentRound))
  const [history, setHistory] = useState(() => load('pb_history', DEFAULT_STATE.history))
  const [finished, setFinished] = useState(() => load('pb_finished', DEFAULT_STATE.finished))
  const [archivedTournaments, setArchivedTournaments] = useState(() => load('pb_all_tournaments', DEFAULT_STATE.archivedTournaments))
  const [syncStatus, setSyncStatus] = useState('Loading published data...')
  const [syncError, setSyncError] = useState('')
  const [lastPublishedAt, setLastPublishedAt] = useState(null)
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const isAdmin = mode === 'admin'

  const ranking = useMemo(() => sortPlayers(players), [players])

  const applyState = (nextState) => {
    setTournamentName(nextState.tournamentName ?? DEFAULT_STATE.tournamentName)
    setPlayers(nextState.players ?? DEFAULT_STATE.players)
    setRound(nextState.round ?? DEFAULT_STATE.round)
    setCurrentRound(nextState.currentRound ?? DEFAULT_STATE.currentRound)
    setHistory(nextState.history ?? DEFAULT_STATE.history)
    setFinished(nextState.finished ?? DEFAULT_STATE.finished)
    setArchivedTournaments(nextState.archivedTournaments ?? DEFAULT_STATE.archivedTournaments)
  }

  useEffect(() => save('pb_tournament_name', tournamentName), [tournamentName])
  useEffect(() => save('pb_players', players), [players])
  useEffect(() => save('pb_round', round), [round])
  useEffect(() => save('pb_current_round', currentRound), [currentRound])
  useEffect(() => save('pb_history', history), [history])
  useEffect(() => save('pb_finished', finished), [finished])
  useEffect(() => save('pb_all_tournaments', archivedTournaments), [archivedTournaments])

  useEffect(() => {
    loadPublishedState()
  }, [])

  async function loadPublishedState() {
    const localState = buildLocalState()
    setIsRefreshing(true)

    try {
      const remotePayload = await fetchSharedState()
      applyState(remotePayload.state ?? DEFAULT_STATE)
      setLastPublishedAt(remotePayload.updatedAt ?? null)
      setHasUnpublishedChanges(false)
      setSyncStatus(remotePayload.updatedAt ? 'Published state loaded' : 'No published state yet')
      setSyncError('')
    } catch {
      applyState(localState)
      setHasUnpublishedChanges(true)
      setSyncStatus('Using browser draft only')
      setSyncError('Published data is unavailable right now')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function publishCurrentState(nextStateOverride) {
    const stateToPublish = nextStateOverride ?? {
      tournamentName,
      players,
      round,
      currentRound,
      history,
      finished,
      archivedTournaments,
    }

    setIsPublishing(true)

    try {
      const payload = await pushSharedState(stateToPublish)
      setLastPublishedAt(payload.updatedAt ?? null)
      setHasUnpublishedChanges(false)
      setSyncStatus('Published')
      setSyncError('')
    } catch {
      setSyncStatus('Draft changes not published')
      setSyncError('Publish failed. Changes are only in this browser until you publish successfully.')
    } finally {
      setIsPublishing(false)
    }
  }

  const login = () => {
    if (password.trim() === '4321') {
      setMode('admin')
      setPassword('')
      setLoginError('')
      return
    }

    setLoginError('Wrong password')
  }

  const addPlayer = () => {
    const normalizedName = playerName.trim()

    if (!normalizedName) return
    if (players.some((player) => player.name.toLowerCase() === normalizedName.toLowerCase())) {
      return
    }

    setPlayers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: normalizedName,
        points: 0,
        wins: 0,
        rests: 0,
        gamesPlayed: 0,
      },
    ])

    setPlayerName('')
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  const startNextRound = () => {
    if (currentRound) return
    if (players.length < 4 || courts < 1) return

    const generated = generateRound(players, courts)

    if (generated.matches.length === 0) return

    setPlayers((prev) =>
      prev.map((p) => {
        const resting = generated.resting.find((r) => r.id === p.id)

        if (!resting) return p

        return {
          ...p,
          rests: p.rests + 1,
        }
      })
    )

    setCurrentRound(generated)
    setRound((r) => r + 1)
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  const updateScore = (idx, field, value) => {
    if (!currentRound) return

    setCurrentRound((prev) => {
      const updated = { ...prev }
      updated.matches = [...updated.matches]

      updated.matches[idx] = {
        ...updated.matches[idx],
        [field]: value,
      }

      return updated
    })
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  const finalizeRound = () => {
    if (!currentRound) return

    const hasIncompleteScores = currentRound.matches.some((match) => (
      match.scoreA === '' || match.scoreB === ''
    ))

    if (hasIncompleteScores) return

    let updatedPlayers = [...players]

    currentRound.matches.forEach((m) => {
      const a = parseInt(m.scoreA)
      const b = parseInt(m.scoreB)

      if (isNaN(a) || isNaN(b)) return

      const aWon = a > b
      const isTie = a === b

      const apply = (player, pts, win) => {
        updatedPlayers = updatedPlayers.map((p) => {
          if (p.id !== player.id) return p

          return {
            ...p,
            points: p.points + pts,
            wins: p.wins + (win ? 1 : 0),
            gamesPlayed: p.gamesPlayed + 1,
          }
        })
      }

      m.teamA.forEach((p) => apply(p, a, !isTie && aWon))
      m.teamB.forEach((p) => apply(p, b, !isTie && !aWon))
    })

    setPlayers(updatedPlayers)

    setHistory((prev) => [
      ...prev,
      {
        round,
        matches: currentRound.matches,
      },
    ])

    setCurrentRound(null)
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  const finishTournament = () => {
    if (players.length === 0 || currentRound) return

    const completedTournament = {
      id: crypto.randomUUID(),
      name: tournamentName,
      date: new Date().toLocaleString(),
      ranking,
      history,
    }
    setArchivedTournaments((prev) => [completedTournament, ...prev])

    setFinished(true)
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  const resetTournament = () => {
    setPlayers([])
    setRound(0)
    setCurrentRound(null)
    setHistory([])
    setFinished(false)
    setTournamentName(DEFAULT_TOURNAMENT_NAME)

    localStorage.removeItem('pb_tournament_name')
    localStorage.removeItem('pb_players')
    localStorage.removeItem('pb_round')
    localStorage.removeItem('pb_current_round')
    localStorage.removeItem('pb_history')
    localStorage.removeItem('pb_finished')
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft changes not published')
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-3xl shadow p-4 flex flex-col md:flex-row justify-between gap-4 items-center">
          <div>
            <div className="font-semibold text-lg">
              Mode: {isAdmin ? 'Admin' : 'Viewer'}
            </div>
            <div className="text-sm text-gray-500">
              Viewer mode is read only.
            </div>
            <div className="text-sm text-gray-500">
              Sync: {syncStatus}
            </div>
            {lastPublishedAt && (
              <div className="text-sm text-gray-500">
                Last published: {new Date(lastPublishedAt).toLocaleString()}
              </div>
            )}
            {syncError && (
              <div className="text-sm text-amber-600">
                {syncError}
              </div>
            )}
          </div>

          {!isAdmin && (
            <form
              className="flex flex-col gap-2 md:items-end"
              onSubmit={(e) => {
                e.preventDefault()
                login()
              }}
            >
              <div className="flex gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (loginError) {
                    setLoginError('')
                  }
                }}
                placeholder="Admin password"
                className="border rounded-xl px-4 py-2"
              />

              <button
                type="submit"
                className="bg-black text-white px-4 py-2 rounded-xl"
              >
                Login
              </button>
              </div>

              {loginError && (
                <div className="text-sm text-red-600">
                  {loginError}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow p-6">
          <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">
                Pickleball Mexicano Manager 🎾
              </h1>

              <p className="text-gray-600">
                Dynamic 2v2 tournament manager.
              </p>
            </div>

            <input
              value={tournamentName}
              onChange={(e) => {
                setTournamentName(e.target.value)
                setHasUnpublishedChanges(true)
                setSyncStatus('Draft changes not published')
              }}
              className="border rounded-2xl px-4 py-3 w-full md:w-80"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {isAdmin && (
            <div className="bg-white rounded-3xl shadow p-6 space-y-4">
              <h2 className="text-2xl font-semibold">Players</h2>

              <div className="flex gap-2">
                <button
                  onClick={() => publishCurrentState()}
                  disabled={isPublishing || !hasUnpublishedChanges}
                  className="flex-1 bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white py-3 rounded-2xl font-semibold"
                >
                  {isPublishing ? 'Publishing...' : 'Publish To Viewers'}
                </button>

                <button
                  onClick={loadPublishedState}
                  disabled={isRefreshing}
                  className="flex-1 bg-gray-200 disabled:bg-gray-100 text-gray-900 py-3 rounded-2xl font-semibold"
                >
                  {isRefreshing ? 'Refreshing...' : 'Reload Published'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Player name"
                  className="flex-1 border rounded-xl px-4 py-2"
                />

                <button
                  onClick={addPlayer}
                  className="bg-black text-white px-4 py-2 rounded-xl"
                >
                  Add
                </button>
              </div>

              <div>
                <label className="block mb-2 font-medium">Courts</label>
                <input
                  type="number"
                  min={1}
                  value={courts}
                  onChange={(e) => {
                    setCourts(Number(e.target.value))
                    setHasUnpublishedChanges(true)
                    setSyncStatus('Draft changes not published')
                  }}
                  className="border rounded-xl px-4 py-2 w-24"
                />
              </div>

              <button
                onClick={startNextRound}
                disabled={players.length < 4 || currentRound || courts < 1}
                className="w-full bg-green-600 disabled:bg-gray-300 disabled:text-gray-500 text-white py-3 rounded-2xl font-semibold"
              >
                Generate Round {round + 1}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={finishTournament}
                  disabled={players.length === 0 || Boolean(currentRound)}
                  className="flex-1 bg-yellow-500 disabled:bg-gray-300 disabled:text-gray-500 text-white py-3 rounded-2xl font-semibold"
                >
                  Finish
                </button>

                <button
                  onClick={resetTournament}
                  className="flex-1 bg-red-500 text-white py-3 rounded-2xl font-semibold"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl shadow p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-2xl font-semibold">Leaderboard</h2>

              {!isAdmin && (
                <button
                  onClick={loadPublishedState}
                  disabled={isRefreshing}
                  className="bg-gray-200 disabled:bg-gray-100 text-gray-900 px-4 py-2 rounded-xl"
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>

            <div className="space-y-2">
              {ranking.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex justify-between bg-gray-100 rounded-xl px-4 py-3"
                >
                  <div>
                    <div className="font-semibold">
                      #{idx + 1} {p.name}
                    </div>

                    <div className="text-sm text-gray-500">
                      Wins: {p.wins} · Games: {p.gamesPlayed} · Rests: {p.rests}
                    </div>
                  </div>

                  <div className="text-xl font-bold">{p.points}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {finished && (
          <div className="bg-white rounded-3xl shadow p-6">
            <h2 className="text-3xl font-bold mb-4">
              🏆 Final Results
            </h2>

            <div className="space-y-3">
              {ranking.slice(0, 3).map((p, idx) => (
                <div
                  key={p.id}
                  className="bg-yellow-100 rounded-2xl p-4 flex justify-between"
                >
                  <div>
                    #{idx + 1} {p.name}
                  </div>

                  <div className="font-bold">{p.points}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-3xl shadow p-6">
          <h2 className="text-2xl font-semibold mb-4">
            Current Tournament History
          </h2>

          <div className="space-y-3">
            {history.map((h) => (
              <div key={h.round} className="border rounded-2xl p-4">
                <div className="font-semibold mb-2">
                  Round {h.round}
                </div>

                {h.matches.map((m, idx) => (
                  <div key={idx} className="text-sm">
                    Court {m.court}: {m.teamA.map((p) => p.name).join(' & ')} ({m.scoreA}) vs {m.teamB.map((p) => p.name).join(' & ')} ({m.scoreB})
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <PreviousTournaments tournaments={archivedTournaments} />

        {currentRound && (
          <div className="bg-white rounded-3xl shadow p-6 space-y-6">
            <h2 className="text-2xl font-semibold">
              Round {round}
            </h2>

            {currentRound.resting.length > 0 && (
              <div className="bg-yellow-100 border border-yellow-300 rounded-2xl p-4">
                Resting: {currentRound.resting.map((p) => p.name).join(', ')}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {currentRound.matches.map((m, idx) => (
                <div key={idx} className="border rounded-2xl p-4 space-y-4">
                  <div className="font-semibold">
                    Court {m.court}
                  </div>

                  <div className="bg-gray-100 rounded-xl p-3">
                    {m.teamA.map((p) => p.name).join(' & ')}
                  </div>

                  <div className="text-center text-sm text-gray-500">
                    VS
                  </div>

                  <div className="bg-gray-100 rounded-xl p-3">
                    {m.teamB.map((p) => p.name).join(' & ')}
                  </div>

                  {isAdmin ? (
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="number"
                        value={m.scoreA}
                        onChange={(e) => updateScore(idx, 'scoreA', e.target.value)}
                        className="w-20 border rounded-xl px-3 py-2 text-center"
                      />

                      <span>-</span>

                      <input
                        type="number"
                        value={m.scoreB}
                        onChange={(e) => updateScore(idx, 'scoreB', e.target.value)}
                        className="w-20 border rounded-xl px-3 py-2 text-center"
                      />
                    </div>
                  ) : (
                    <div className="text-center font-semibold">
                      {m.scoreA || 0} - {m.scoreB || 0}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {isAdmin && (
              <button
                onClick={finalizeRound}
                disabled={currentRound.matches.some((match) => match.scoreA === '' || match.scoreB === '')}
                className="w-full bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 text-white py-4 rounded-2xl font-semibold"
              >
                Finalize Round
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
