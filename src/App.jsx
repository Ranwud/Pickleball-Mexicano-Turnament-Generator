import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const SHARED_STATE_URL = '/api/state'
const ADMIN_PASSWORD = '4321'
const DEFAULT_TOURNAMENT_NAME = 'Saturday Mexicano Cup'
const DEFAULT_COURTS = 3
const DEFAULT_STATE = {
  tournamentName: DEFAULT_TOURNAMENT_NAME,
  players: [],
  round: 0,
  currentRound: null,
  history: [],
  finished: false,
  archivedTournaments: [],
  completedTournamentSignature: null,
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
    if (a.rests !== b.rests) return a.rests - b.rests
    return a.name.localeCompare(b.name)
  })
}

function normalizePlayerName(name) {
  return name.trim().replace(/\s+/g, ' ')
}

function buildTournamentSignature({ tournamentName, history, ranking }) {
  return JSON.stringify({
    tournamentName,
    history: history.map((round) => ({
      round: round.round,
      matches: round.matches.map((match) => ({
        court: match.court,
        teamA: match.teamA.map((player) => player.id),
        teamB: match.teamB.map((player) => player.id),
        scoreA: match.scoreA,
        scoreB: match.scoreB,
      })),
    })),
    ranking: ranking.map((player) => ({
      id: player.id,
      points: player.points,
      wins: player.wins,
      rests: player.rests,
      gamesPlayed: player.gamesPlayed,
    })),
  })
}

function generateRound(players, courts) {
  const sorted = sortPlayers(players)
  const activeSlots = Math.max(courts, 1) * 4
  let active = [...sorted]
  let resting = []

  if (players.length > activeSlots) {
    const playersToRest = players.length - activeSlots

    resting = [...sorted]
      .sort((a, b) => {
        if (a.rests !== b.rests) return a.rests - b.rests
        if (a.gamesPlayed !== b.gamesPlayed) return a.gamesPlayed - b.gamesPlayed
        return a.name.localeCompare(b.name)
      })
      .slice(0, playersToRest)

    const restingIds = new Set(resting.map((player) => player.id))
    active = sorted.filter((player) => !restingIds.has(player.id))
  }

  const matches = []

  for (let index = 0; index < active.length; index += 4) {
    const group = active.slice(index, index + 4)
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
    completedTournamentSignature: load(
      'pb_completed_tournament_signature',
      DEFAULT_STATE.completedTournamentSignature,
    ),
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

function SectionCard({ title, subtitle, actions, children, accent = 'default' }) {
  return (
    <section className={`section-card section-card--${accent}`}>
      <div className="section-card__header">
        <div>
          <h2 className="section-card__title">{title}</h2>
          {subtitle && <p className="section-card__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="section-card__actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function StatTile({ label, value, hint }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
      {hint && <div className="stat-tile__hint">{hint}</div>}
    </div>
  )
}

function Notification({ notice }) {
  if (!notice) return null

  return (
    <div className={`notice notice--${notice.type}`}>
      <div className="notice__dot" />
      <div>{notice.message}</div>
    </div>
  )
}

function PreviousTournaments({
  tournaments,
  isAdmin,
  openedId,
  onToggle,
  onDelete,
}) {
  return (
    <SectionCard
      title="Previous Tournaments"
      subtitle="Published tournament archives stay available for players and can be managed from admin mode."
      accent="sand"
    >
      <div className="archive-list">
        {tournaments.length === 0 && (
          <div className="empty-state">
            No completed tournaments yet.
          </div>
        )}

        {tournaments.map((tournament) => {
          const isOpen = openedId === tournament.id

          return (
            <article key={tournament.id} className="archive-item">
              <div className="archive-item__top">
                <div>
                  <div className="archive-item__title">{tournament.name}</div>
                  <div className="archive-item__meta">
                    {tournament.date}
                  </div>
                </div>

                <div className="archive-item__buttons">
                  <button
                    onClick={() => onToggle(isOpen ? null : tournament.id)}
                    className="button button--ghost"
                  >
                    {isOpen ? 'Hide' : 'Open'}
                  </button>

                  {isAdmin && (
                    <button
                      onClick={() => onDelete(tournament.id)}
                      className="button button--danger-soft"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="archive-item__body">
                  <div className="mini-grid">
                    {tournament.ranking.map((player, index) => (
                      <div key={player.id} className="mini-grid__row">
                        <div>#{index + 1} {player.name}</div>
                        <div>{player.points} pts</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </SectionCard>
  )
}

export default function PickleballMexicanoManager() {
  const [mode, setMode] = useState('viewer')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState(null)

  const [tournamentName, setTournamentName] = useState(DEFAULT_TOURNAMENT_NAME)
  const [playerName, setPlayerName] = useState('')
  const [editingPlayerId, setEditingPlayerId] = useState(null)
  const [editingPlayerName, setEditingPlayerName] = useState('')
  const [courts, setCourts] = useState(DEFAULT_COURTS)
  const [archiveOpenId, setArchiveOpenId] = useState(null)

  const [players, setPlayers] = useState(() => load('pb_players', DEFAULT_STATE.players))
  const [round, setRound] = useState(() => load('pb_round', DEFAULT_STATE.round))
  const [currentRound, setCurrentRound] = useState(() => load('pb_current_round', DEFAULT_STATE.currentRound))
  const [history, setHistory] = useState(() => load('pb_history', DEFAULT_STATE.history))
  const [finished, setFinished] = useState(() => load('pb_finished', DEFAULT_STATE.finished))
  const [archivedTournaments, setArchivedTournaments] = useState(() =>
    load('pb_all_tournaments', DEFAULT_STATE.archivedTournaments),
  )
  const [completedTournamentSignature, setCompletedTournamentSignature] = useState(() =>
    load(
      'pb_completed_tournament_signature',
      DEFAULT_STATE.completedTournamentSignature,
    ),
  )
  const [syncStatus, setSyncStatus] = useState('Loading published data...')
  const [syncError, setSyncError] = useState('')
  const [lastPublishedAt, setLastPublishedAt] = useState(null)
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const finishLockRef = useRef(false)

  const isAdmin = mode === 'admin'
  const canEditPlayers = round === 0 && history.length === 0 && !currentRound && !finished
  const canModifyTournament = !finished

  const ranking = useMemo(() => sortPlayers(players), [players])
  const currentTournamentSignature = useMemo(
    () => buildTournamentSignature({ tournamentName, history, ranking }),
    [tournamentName, history, ranking],
  )
  const alreadyArchived = archivedTournaments.some(
    (tournament) => tournament.signature === currentTournamentSignature,
  )
  const canFinishTournament = (
    canModifyTournament &&
    players.length > 0 &&
    history.length > 0 &&
    !currentRound &&
    !alreadyArchived &&
    completedTournamentSignature !== currentTournamentSignature
  )

  useEffect(() => {
    if (!notice) return undefined

    const timeoutId = window.setTimeout(() => {
      setNotice(null)
    }, 2800)

    return () => window.clearTimeout(timeoutId)
  }, [notice])

  useEffect(() => save('pb_tournament_name', tournamentName), [tournamentName])
  useEffect(() => save('pb_players', players), [players])
  useEffect(() => save('pb_round', round), [round])
  useEffect(() => save('pb_current_round', currentRound), [currentRound])
  useEffect(() => save('pb_history', history), [history])
  useEffect(() => save('pb_finished', finished), [finished])
  useEffect(() => save('pb_all_tournaments', archivedTournaments), [archivedTournaments])
  useEffect(
    () => save('pb_completed_tournament_signature', completedTournamentSignature),
    [completedTournamentSignature],
  )

  useEffect(() => {
    void loadPublishedState()
  }, [])

  function showNotice(message, type = 'info') {
    setNotice({ message, type })
  }

  function applyState(nextState) {
    setTournamentName(nextState.tournamentName ?? DEFAULT_STATE.tournamentName)
    setPlayers(nextState.players ?? DEFAULT_STATE.players)
    setRound(nextState.round ?? DEFAULT_STATE.round)
    setCurrentRound(nextState.currentRound ?? DEFAULT_STATE.currentRound)
    setHistory(nextState.history ?? DEFAULT_STATE.history)
    setFinished(nextState.finished ?? DEFAULT_STATE.finished)
    setArchivedTournaments(nextState.archivedTournaments ?? DEFAULT_STATE.archivedTournaments)
    setCompletedTournamentSignature(
      nextState.completedTournamentSignature ?? DEFAULT_STATE.completedTournamentSignature,
    )
    setEditingPlayerId(null)
    setEditingPlayerName('')
  }

  function markDraftChanged(message = null) {
    setHasUnpublishedChanges(true)
    setSyncStatus('Draft has unpublished changes')
    if (message) showNotice(message, 'info')
  }

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
      showNotice('Published tournament loaded.', 'success')
    } catch {
      applyState(localState)
      setHasUnpublishedChanges(true)
      setSyncStatus('Using browser draft only')
      setSyncError('Published data is unavailable right now')
      showNotice('Published data is unavailable. Using local draft.', 'warning')
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
      completedTournamentSignature,
    }

    setIsPublishing(true)

    try {
      const payload = await pushSharedState(stateToPublish)
      setLastPublishedAt(payload.updatedAt ?? null)
      setHasUnpublishedChanges(false)
      setSyncStatus('Published for viewers')
      setSyncError('')
      showNotice('Changes published for viewers.', 'success')
    } catch {
      setSyncStatus('Draft changes not published')
      setSyncError('Publish failed. Changes are only in this browser until publish succeeds.')
      showNotice('Publish failed. Draft is still local.', 'error')
    } finally {
      setIsPublishing(false)
    }
  }

  function login() {
    if (password.trim() === ADMIN_PASSWORD) {
      setMode('admin')
      setPassword('')
      setLoginError('')
      showNotice('Admin mode enabled.', 'success')
      return
    }

    setLoginError('Wrong password')
  }

  function addPlayer() {
    if (!canModifyTournament) return

    const normalizedName = normalizePlayerName(playerName)
    if (!normalizedName) return

    if (players.some((player) => player.name.toLowerCase() === normalizedName.toLowerCase())) {
      showNotice('Player names must be unique.', 'warning')
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
    markDraftChanged(`Added ${normalizedName}.`)
  }

  function startEditingPlayer(player) {
    if (!canEditPlayers) return

    setEditingPlayerId(player.id)
    setEditingPlayerName(player.name)
  }

  function cancelEditingPlayer() {
    setEditingPlayerId(null)
    setEditingPlayerName('')
  }

  function saveEditedPlayer() {
    if (!editingPlayerId || !canEditPlayers) return

    const normalizedName = normalizePlayerName(editingPlayerName)
    if (!normalizedName) return

    if (
      players.some(
        (player) =>
          player.id !== editingPlayerId &&
          player.name.toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      showNotice('Player names must be unique.', 'warning')
      return
    }

    setPlayers((prev) =>
      prev.map((player) =>
        player.id === editingPlayerId ? { ...player, name: normalizedName } : player,
      ),
    )
    cancelEditingPlayer()
    markDraftChanged(`Updated player to ${normalizedName}.`)
  }

  function removePlayer(playerId) {
    if (!canEditPlayers) return

    const player = players.find((item) => item.id === playerId)
    setPlayers((prev) => prev.filter((item) => item.id !== playerId))

    if (editingPlayerId === playerId) {
      cancelEditingPlayer()
    }

    markDraftChanged(`Removed ${player?.name ?? 'player'}.`)
  }

  function startNextRound() {
    if (!canModifyTournament) return
    if (currentRound) return
    if (players.length < 4 || courts < 1) return

    const generated = generateRound(players, courts)
    if (generated.matches.length === 0) {
      showNotice('Not enough players for the selected courts.', 'warning')
      return
    }

    setPlayers((prev) =>
      prev.map((player) => (
        generated.resting.some((restingPlayer) => restingPlayer.id === player.id)
          ? { ...player, rests: player.rests + 1 }
          : player
      )),
    )
    setCurrentRound(generated)
    setRound((prev) => prev + 1)
    markDraftChanged(`Round ${round + 1} generated.`)
  }

  function updateScore(matchIndex, field, value) {
    if (!canModifyTournament || !currentRound) return

    setCurrentRound((prev) => {
      const updated = { ...prev }
      updated.matches = [...updated.matches]
      updated.matches[matchIndex] = {
        ...updated.matches[matchIndex],
        [field]: value,
      }
      return updated
    })

    setHasUnpublishedChanges(true)
    setSyncStatus('Draft has unpublished changes')
  }

  function finalizeRound() {
    if (!canModifyTournament || !currentRound) return

    const hasIncompleteScores = currentRound.matches.some(
      (match) => match.scoreA === '' || match.scoreB === '',
    )
    if (hasIncompleteScores) {
      showNotice('Enter every score before finalizing the round.', 'warning')
      return
    }

    let updatedPlayers = [...players]

    currentRound.matches.forEach((match) => {
      const scoreA = parseInt(match.scoreA, 10)
      const scoreB = parseInt(match.scoreB, 10)
      if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) return

      const aWon = scoreA > scoreB
      const isTie = scoreA === scoreB

      const applyResult = (player, points, won) => {
        updatedPlayers = updatedPlayers.map((currentPlayer) => (
          currentPlayer.id === player.id
            ? {
                ...currentPlayer,
                points: currentPlayer.points + points,
                wins: currentPlayer.wins + (won ? 1 : 0),
                gamesPlayed: currentPlayer.gamesPlayed + 1,
              }
            : currentPlayer
        ))
      }

      match.teamA.forEach((player) => applyResult(player, scoreA, !isTie && aWon))
      match.teamB.forEach((player) => applyResult(player, scoreB, !isTie && !aWon))
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
    markDraftChanged(`Round ${round} finalized.`)
  }

  function finishTournament() {
    if (!canFinishTournament || finishLockRef.current) return

    finishLockRef.current = true

    try {
      if (alreadyArchived || completedTournamentSignature === currentTournamentSignature) {
        setFinished(true)
        showNotice('This tournament was already finished.', 'warning')
        return
      }

      const completedTournament = {
        id: `tournament-${Date.now()}`,
        signature: currentTournamentSignature,
        name: tournamentName,
        date: new Date().toLocaleString(),
        ranking,
        history,
      }

      setArchivedTournaments((prev) => [completedTournament, ...prev])
      setCompletedTournamentSignature(currentTournamentSignature)
      setFinished(true)
      setArchiveOpenId(completedTournament.id)
      setHasUnpublishedChanges(true)
      setSyncStatus('Draft has unpublished changes')
      showNotice('Tournament finished. Publish to share the final standings.', 'success')
    } finally {
      window.setTimeout(() => {
        finishLockRef.current = false
      }, 250)
    }
  }

  function deleteArchivedTournament(tournamentId) {
    const tournament = archivedTournaments.find((item) => item.id === tournamentId)
    setArchivedTournaments((prev) => prev.filter((item) => item.id !== tournamentId))
    if (archiveOpenId === tournamentId) {
      setArchiveOpenId(null)
    }
    if (tournament?.signature === completedTournamentSignature) {
      setCompletedTournamentSignature(null)
      setFinished(false)
    }
    markDraftChanged(`Deleted archive "${tournament?.name ?? 'tournament'}".`)
  }

  function resetTournament() {
    setPlayers([])
    setRound(0)
    setCurrentRound(null)
    setHistory([])
    setFinished(false)
    setTournamentName(DEFAULT_TOURNAMENT_NAME)
    setCompletedTournamentSignature(null)
    setEditingPlayerId(null)
    setEditingPlayerName('')
    setPlayerName('')
    setCourts(DEFAULT_COURTS)

    localStorage.removeItem('pb_tournament_name')
    localStorage.removeItem('pb_players')
    localStorage.removeItem('pb_round')
    localStorage.removeItem('pb_current_round')
    localStorage.removeItem('pb_history')
    localStorage.removeItem('pb_finished')
    localStorage.removeItem('pb_completed_tournament_signature')

    markDraftChanged('Tournament reset. Publish if viewers should see the reset state.')
  }

  const roundsPlayed = history.length
  const totalMatches = history.reduce((sum, item) => sum + item.matches.length, 0)

  return (
    <div className="page-shell">
      <div className="page-shell__backdrop page-shell__backdrop--left" />
      <div className="page-shell__backdrop page-shell__backdrop--right" />

      <main className="app-frame">
        <Notification notice={notice} />

        <section className="hero-panel">
          <div className="hero-panel__copy">
            <div className="eyebrow">
              Pickleball Mexicano Tournament
            </div>
            <h1 className="hero-panel__title">
              Fast admin controls, clean viewer mode, and publish-on-demand sharing.
            </h1>
            <p className="hero-panel__text">
              Manage one live tournament draft, publish when ready, and keep an archive of completed events without creating duplicates.
            </p>

            <div className="hero-panel__badges">
              <span className={`status-pill ${isAdmin ? 'status-pill--success' : 'status-pill--neutral'}`}>
                {isAdmin ? 'Admin mode' : 'Viewer mode'}
              </span>
              <span className="status-pill status-pill--neutral">
                {syncStatus}
              </span>
              {hasUnpublishedChanges && (
                <span className="status-pill status-pill--warning">
                  Draft has unpublished changes
                </span>
              )}
            </div>

            <div className="hero-panel__meta">
              <div>Last published: {lastPublishedAt ? new Date(lastPublishedAt).toLocaleString() : 'Not published yet'}</div>
              {syncError && <div className="hero-panel__warning">{syncError}</div>}
            </div>
          </div>

          <div className="hero-panel__visual">
            <div className="court-card">
              <div className="court-card__glow" />
              <div className="court-card__court">
                <div className="court-card__net" />
                <div className="court-card__ball court-card__ball--one" />
                <div className="court-card__ball court-card__ball--two" />
              </div>
            </div>
          </div>
        </section>

        <section className="stats-row">
          <StatTile label="Players" value={players.length} hint={canEditPlayers ? 'Roster still editable' : 'Roster locked'} />
          <StatTile label="Rounds Played" value={roundsPlayed} hint={currentRound ? `Round ${round} in progress` : 'No active round'} />
          <StatTile label="Matches Logged" value={totalMatches} hint={`${archivedTournaments.length} archived tournaments`} />
          <StatTile label="Courts" value={courts} hint={finished ? 'Tournament finished' : 'Draft setup'} />
        </section>

        <div className="workspace-grid">
          <div className="workspace-grid__main">
            <SectionCard
              title="Tournament Control"
              subtitle="Edit the draft, then publish once the viewer-facing state is ready."
              accent="mint"
              actions={!isAdmin ? (
                <button
                  onClick={() => void loadPublishedState()}
                  disabled={isRefreshing}
                  className="button button--ghost"
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              ) : null}
            >
              <div className="toolbar">
                <label className="field field--wide">
                  <span className="field__label">Tournament name</span>
                  <input
                    value={tournamentName}
                    onChange={(event) => {
                      if (!canModifyTournament) return
                      setTournamentName(event.target.value)
                      markDraftChanged()
                    }}
                    className="input"
                    disabled={!isAdmin || !canModifyTournament}
                  />
                </label>

                {isAdmin ? (
                  <div className="toolbar__buttons">
                    <button
                      onClick={() => void publishCurrentState()}
                      disabled={isPublishing || !hasUnpublishedChanges}
                      className="button button--primary"
                    >
                      {isPublishing ? 'Publishing...' : 'Publish To Viewers'}
                    </button>
                    <button
                      onClick={() => void loadPublishedState()}
                      disabled={isRefreshing}
                      className="button button--ghost"
                    >
                      {isRefreshing ? 'Refreshing...' : 'Reload Published'}
                    </button>
                  </div>
                ) : (
                  <form
                    className="viewer-login"
                    onSubmit={(event) => {
                      event.preventDefault()
                      login()
                    }}
                  >
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        if (loginError) setLoginError('')
                      }}
                      placeholder="Admin password"
                      className="input"
                    />
                    <button type="submit" className="button button--dark">
                      Login
                    </button>
                    {loginError && <div className="field__error">{loginError}</div>}
                  </form>
                )}
              </div>
            </SectionCard>

            {isAdmin && (
              <SectionCard
                title="Admin Bench"
                subtitle={canEditPlayers ? 'Build the roster, tune court count, then start round one.' : 'The roster is locked once play begins.'}
                accent="sand"
              >
                <div className="admin-grid">
                  <div className="admin-grid__panel">
                    <label className="field">
                      <span className="field__label">Add player</span>
                      <div className="inline-field">
                        <input
                          value={playerName}
                          onChange={(event) => setPlayerName(event.target.value)}
                          placeholder="Player name"
                          className="input"
                          disabled={!canModifyTournament}
                        />
                        <button
                          onClick={addPlayer}
                          className="button button--dark"
                          disabled={!canModifyTournament}
                        >
                          Add
                        </button>
                      </div>
                    </label>

                    <label className="field field--compact">
                      <span className="field__label">Courts</span>
                      <input
                        type="number"
                        min={1}
                        value={courts}
                        onChange={(event) => {
                          if (!canModifyTournament) return
                          setCourts(Number(event.target.value))
                          markDraftChanged()
                        }}
                        className="input"
                        disabled={!canModifyTournament}
                      />
                    </label>
                  </div>

                  <div className="admin-grid__panel admin-grid__panel--actions">
                    <button
                      onClick={startNextRound}
                      disabled={!canModifyTournament || players.length < 4 || Boolean(currentRound) || courts < 1}
                      className="button button--success button--wide"
                    >
                      Generate Round {round + 1}
                    </button>

                    <button
                      onClick={finishTournament}
                      disabled={!canFinishTournament}
                      className="button button--accent button--wide"
                    >
                      {finished ? 'Tournament Finished' : 'Finish Tournament'}
                    </button>

                    <button
                      onClick={resetTournament}
                      className="button button--danger-soft button--wide"
                    >
                      Reset Current Tournament
                    </button>
                  </div>
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="Leaderboard"
              subtitle="Viewers see the latest published standings after a page refresh. Admin edits stay in draft until published."
              accent="default"
            >
              <div className="leaderboard">
                {ranking.length === 0 && (
                  <div className="empty-state">
                    No players yet. Add players in admin mode to start building the bracket.
                  </div>
                )}

                {ranking.map((player, index) => (
                  <div key={player.id} className="leaderboard__item">
                    <div className="leaderboard__rank">#{index + 1}</div>

                    <div className="leaderboard__main">
                      {isAdmin && canEditPlayers && editingPlayerId === player.id ? (
                        <div className="inline-field">
                          <input
                            value={editingPlayerName}
                            onChange={(event) => setEditingPlayerName(event.target.value)}
                            className="input"
                          />
                          <button onClick={saveEditedPlayer} className="button button--primary">
                            Save
                          </button>
                          <button onClick={cancelEditingPlayer} className="button button--ghost">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="leaderboard__name">{player.name}</div>
                          <div className="leaderboard__meta">
                            Wins {player.wins} · Games {player.gamesPlayed} · Rests {player.rests}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="leaderboard__score">{player.points}</div>

                    {isAdmin && canEditPlayers && editingPlayerId !== player.id && (
                      <div className="leaderboard__actions">
                        <button onClick={() => startEditingPlayer(player)} className="button button--ghost">
                          Edit
                        </button>
                        <button onClick={() => removePlayer(player.id)} className="button button--danger-soft">
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>

            {currentRound && (
              <SectionCard
                title={`Round ${round}`}
                subtitle="Enter all scores, then finalize the round to update standings."
                accent="mint"
                actions={isAdmin ? (
                  <button
                    onClick={finalizeRound}
                    disabled={currentRound.matches.some(
                      (match) => match.scoreA === '' || match.scoreB === '',
                    )}
                    className="button button--primary"
                  >
                    Finalize Round
                  </button>
                ) : null}
              >
                {currentRound.resting.length > 0 && (
                  <div className="rest-banner">
                    Resting: {currentRound.resting.map((player) => player.name).join(', ')}
                  </div>
                )}

                <div className="round-grid">
                  {currentRound.matches.map((match, index) => (
                    <div key={index} className="match-card">
                      <div className="match-card__court">Court {match.court}</div>
                      <div className="match-card__team">{match.teamA.map((player) => player.name).join(' & ')}</div>
                      <div className="match-card__versus">vs</div>
                      <div className="match-card__team">{match.teamB.map((player) => player.name).join(' & ')}</div>

                      {isAdmin ? (
                        <div className="score-entry">
                          <input
                            type="number"
                            value={match.scoreA}
                            onChange={(event) => updateScore(index, 'scoreA', event.target.value)}
                            className="input input--score"
                            disabled={!canModifyTournament}
                          />
                          <span className="score-entry__dash">-</span>
                          <input
                            type="number"
                            value={match.scoreB}
                            onChange={(event) => updateScore(index, 'scoreB', event.target.value)}
                            className="input input--score"
                            disabled={!canModifyTournament}
                          />
                        </div>
                      ) : (
                        <div className="score-static">
                          {(match.scoreA || 0)} - {(match.scoreB || 0)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="Current Tournament History"
              subtitle="Published history is what viewers will see after refresh. The current draft may contain newer changes."
              accent="default"
            >
              <div className="history-list">
                {history.length === 0 && (
                  <div className="empty-state">
                    No rounds have been finalized yet.
                  </div>
                )}

                {history.map((item) => (
                  <div key={item.round} className="history-item">
                    <div className="history-item__title">Round {item.round}</div>
                    <div className="history-item__matches">
                      {item.matches.map((match, index) => (
                        <div key={index}>
                          Court {match.court}: {match.teamA.map((player) => player.name).join(' & ')} ({match.scoreA}) vs {match.teamB.map((player) => player.name).join(' & ')} ({match.scoreB})
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <PreviousTournaments
              tournaments={archivedTournaments}
              isAdmin={isAdmin}
              openedId={archiveOpenId}
              onToggle={setArchiveOpenId}
              onDelete={deleteArchivedTournament}
            />
          </div>

          <aside className="workspace-grid__side">
            <SectionCard
              title="Viewer Guidance"
              subtitle="Keep the viewer flow obvious, especially on phones."
              accent="sand"
            >
              <div className="checklist">
                <div className="checklist__item">Refresh after the admin publishes a new draft.</div>
                <div className="checklist__item">Only published changes are visible to everyone.</div>
                <div className="checklist__item">The Finish action is idempotent and no longer creates duplicate archives.</div>
                <div className="checklist__item">Old tournaments can be deleted from admin mode.</div>
              </div>
            </SectionCard>

            <SectionCard
              title="Admin Rules"
              subtitle="A few guardrails prevent bad tournament state."
              accent="mint"
            >
              <div className="checklist">
                <div className="checklist__item">Roster editing is locked once play starts.</div>
                <div className="checklist__item">Rounds cannot finalize until every score is entered.</div>
                <div className="checklist__item">Finishing requires at least one finalized round.</div>
                <div className="checklist__item">Publish after major edits so viewers get the latest standings.</div>
              </div>
            </SectionCard>
          </aside>
        </div>
      </main>
    </div>
  )
}
