import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

// ── Constants ────────────────────────────────────────────────────────────────
const SHARED_STATE_URL = '/api/state'
const ADMIN_PASSWORD = '4321'
const DEFAULT_STATE = { tournaments: [] }

const TOURNAMENT_TYPES = [
  { value: 'mexicano', label: 'Mexicano' },
  { value: 'americano', label: 'Americano' },
]
const TOURNAMENT_FORMATS = [
  { value: '2v2', label: '2 на 2' },
  { value: '1v1', label: '1 на 1' },
]

// ── Storage ──────────────────────────────────────────────────────────────────
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
function load(key, fallback) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}

// ── Player helpers ───────────────────────────────────────────────────────────
function sortPlayers(players) {
  return [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.rests !== b.rests) return a.rests - b.rests
    return a.name.localeCompare(b.name)
  })
}

function normalizeName(name) { return name.trim().replace(/\s+/g, ' ') }

function makePlayer(name) {
  return { id: crypto.randomUUID(), name, points: 0, wins: 0, rests: 0, gamesPlayed: 0 }
}

// ── Round generation ─────────────────────────────────────────────────────────
function pairKey(a, b) { return [a.id, b.id].sort().join('|') }

function buildPartnerCounts(history) {
  const map = new Map()
  for (const round of history) {
    for (const match of round.matches) {
      if (match.teamA.length >= 2) {
        const k = pairKey(match.teamA[0], match.teamA[1])
        map.set(k, (map.get(k) ?? 0) + 1)
      }
      if (match.teamB.length >= 2) {
        const k = pairKey(match.teamB[0], match.teamB[1])
        map.set(k, (map.get(k) ?? 0) + 1)
      }
    }
  }
  return map
}

function buildOpponentCounts(history) {
  const map = new Map()
  for (const round of history) {
    for (const match of round.matches) {
      for (const pa of match.teamA) {
        for (const pb of match.teamB) {
          const k = pairKey(pa, pb)
          map.set(k, (map.get(k) ?? 0) + 1)
        }
      }
    }
  }
  return map
}

function bestPairing(group, partnerCounts) {
  const opts = [
    { teamA: [group[0], group[3]], teamB: [group[1], group[2]] },
    { teamA: [group[0], group[2]], teamB: [group[1], group[3]] },
    { teamA: [group[0], group[1]], teamB: [group[2], group[3]] },
  ]
  let best = opts[0]; let bestScore = Infinity
  for (const opt of opts) {
    const score =
      (partnerCounts.get(pairKey(opt.teamA[0], opt.teamA[1])) ?? 0) +
      (partnerCounts.get(pairKey(opt.teamB[0], opt.teamB[1])) ?? 0)
    if (score < bestScore) { bestScore = score; best = opt }
  }
  return best
}

function greedySinglesPairs(active, opponentCounts) {
  const remaining = [...active]; const pairs = []
  while (remaining.length >= 2) {
    const a = remaining.shift()
    let bestIdx = 0; let bestCount = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = opponentCounts.get(pairKey(a, remaining[i])) ?? 0
      if (c < bestCount) { bestCount = c; bestIdx = i }
    }
    pairs.push([a, remaining[bestIdx]])
    remaining.splice(bestIdx, 1)
  }
  return pairs
}

function generateRound(tournament) {
  const { players, courts, type, format, history } = tournament
  const ppc = format === '1v1' ? 2 : 4
  const sorted = sortPlayers(players)
  const maxCourts = Math.min(courts, Math.floor(players.length / ppc))
  const activeSlots = maxCourts * ppc
  const toRest = players.length - activeSlots

  let resting = []
  if (toRest > 0) {
    resting = [...sorted]
      .sort((a, b) => a.rests - b.rests || a.gamesPlayed - b.gamesPlayed || a.name.localeCompare(b.name))
      .slice(0, toRest)
  }
  const restIds = new Set(resting.map(p => p.id))
  const active = sorted.filter(p => !restIds.has(p.id))

  const matches = []

  if (format === '1v1') {
    const pairs = type === 'mexicano'
      ? active.reduce((acc, p, i) => { if (i % 2 === 0 && active[i + 1]) acc.push([p, active[i + 1]]); return acc }, [])
      : greedySinglesPairs(active, buildOpponentCounts(history))
    pairs.forEach((pair, i) =>
      matches.push({ court: i + 1, teamA: [pair[0]], teamB: [pair[1]], scoreA: '', scoreB: '' })
    )
  } else {
    const partnerCounts = type === 'americano' ? buildPartnerCounts(history) : null
    for (let i = 0; i + 3 < active.length; i += 4) {
      const g = active.slice(i, i + 4)
      const { teamA, teamB } = type === 'mexicano'
        ? { teamA: [g[0], g[3]], teamB: [g[1], g[2]] }
        : bestPairing(g, partnerCounts)
      matches.push({ court: matches.length + 1, teamA, teamB, scoreA: '', scoreB: '' })
    }
  }

  return { matches, resting }
}

// ── API ──────────────────────────────────────────────────────────────────────
async function fetchSharedState() {
  const res = await fetch(SHARED_STATE_URL, { method: 'GET', cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
async function pushSharedState(state) {
  const res = await fetch(SHARED_STATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Utilities ────────────────────────────────────────────────────────────────
function computeGlobalLeaderboard(tournaments) {
  const map = new Map()
  for (const t of tournaments) {
    if (t.status !== 'finished') continue
    for (const p of t.players) {
      const key = normalizeName(p.name).toLowerCase()
      const ex = map.get(key) ?? { name: p.name, points: 0, wins: 0, gamesPlayed: 0, tournaments: 0 }
      map.set(key, {
        ...ex,
        points: ex.points + p.points,
        wins: ex.wins + p.wins,
        gamesPlayed: ex.gamesPlayed + p.gamesPlayed,
        tournaments: ex.tournaments + 1,
      })
    }
  }
  return [...map.values()].sort((a, b) =>
    b.points - a.points || b.wins - a.wins || b.tournaments - a.tournaments
  )
}

function formatDateTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function typeLabel(type, format) {
  return `${type === 'mexicano' ? 'Mexicano' : 'Americano'} ${format === '2v2' ? '2×2' : '1×1'}`
}

function migrateOldState(raw) {
  if (!raw) return []
  if (Array.isArray(raw.tournaments)) return raw.tournaments
  // old format: convert archivedTournaments to finished
  return (raw.archivedTournaments ?? []).map(t => ({
    id: t.id ?? `t-${Date.now()}-${Math.random()}`,
    name: t.name ?? 'Турнир',
    scheduledAt: null,
    type: 'mexicano',
    format: '2v2',
    courts: 2,
    status: 'finished',
    players: t.ranking ?? [],
    round: (t.history ?? []).length,
    currentRound: null,
    history: t.history ?? [],
  }))
}

// ── UI Primitives ────────────────────────────────────────────────────────────
function Notification({ notice }) {
  if (!notice) return null
  return (
    <div className={`notice notice--${notice.type}`}>
      <div className="notice__dot" />
      <span>{notice.message}</span>
    </div>
  )
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

// ── Pickleball Court Animation ───────────────────────────────────────────────
function CourtAnimation() {
  return (
    <div className="court-card">
      <div className="court-card__glow" />
      <div className="pb-court">
        {/* Outer court boundary */}
        <div className="pb-outer">
          {/* NVZ (kitchen) zones */}
          <div className="pb-nvz pb-nvz--left" />
          <div className="pb-nvz pb-nvz--right" />
          {/* Center service line */}
          <div className="pb-service-line" />
          {/* Net */}
          <div className="pb-net" />
          {/* Animated ball */}
          <div className="pb-ball" />
        </div>
        {/* Player markers */}
        <div className="pb-player pb-player--a1"><span>А1</span></div>
        <div className="pb-player pb-player--a2"><span>А2</span></div>
        <div className="pb-player pb-player--b1"><span>Б1</span></div>
        <div className="pb-player pb-player--b2"><span>Б2</span></div>
        {/* Team labels */}
        <div className="pb-team pb-team--a">Команда А</div>
        <div className="pb-team pb-team--b">Команда Б</div>
      </div>
    </div>
  )
}

// ── Tournament Modal ─────────────────────────────────────────────────────────
function TournamentModal({ initial, onSave, onClose }) {
  const isEdit = Boolean(initial)
  const canEditRoster = !isEdit || (initial.round === 0 && !initial.currentRound && initial.history.length === 0)

  const [name, setName] = useState(initial?.name ?? '')
  const [scheduledAt, setScheduledAt] = useState(
    initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : ''
  )
  const [type, setType] = useState(initial?.type ?? 'mexicano')
  const [format, setFormat] = useState(initial?.format ?? '2v2')
  const [courts, setCourts] = useState(initial?.courts ?? 2)
  const [players, setPlayers] = useState(initial?.players ?? [])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingVal, setEditingVal] = useState('')
  const [err, setErr] = useState('')
  const newNameRef = useRef(null)

  function addPlayer() {
    const n = normalizeName(newName)
    if (!n) return
    if (players.some(p => p.name.toLowerCase() === n.toLowerCase())) {
      setErr('Игрок с таким именем уже есть'); return
    }
    setPlayers(prev => [...prev, makePlayer(n)])
    setNewName(''); setErr('')
    newNameRef.current?.focus()
  }

  function saveEdit() {
    const n = normalizeName(editingVal)
    if (!n) return
    if (players.some(p => p.id !== editingId && p.name.toLowerCase() === n.toLowerCase())) {
      setErr('Имя уже занято'); return
    }
    setPlayers(prev => prev.map(p => p.id === editingId ? { ...p, name: n } : p))
    setEditingId(null); setEditingVal(''); setErr('')
  }

  function handleSave() {
    const n = normalizeName(name)
    if (!n) { setErr('Введите название турнира'); return }
    const minPlayers = format === '1v1' ? 2 : 4
    if (players.length > 0 && players.length < minPlayers) {
      setErr(`Для формата ${format} нужно минимум ${minPlayers} игрока`); return
    }
    onSave({
      ...(initial ?? {}),
      id: initial?.id ?? `t-${Date.now()}`,
      name: n,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      type,
      format,
      courts: Math.max(1, courts),
      status: initial?.status ?? 'upcoming',
      players,
      round: initial?.round ?? 0,
      currentRound: initial?.currentRound ?? null,
      history: initial?.history ?? [],
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? 'Редактировать турнир' : 'Новый турнир'}</h2>
          <button onClick={onClose} className="modal__close" aria-label="Закрыть">✕</button>
        </div>

        <div className="modal__body">
          {err && <div className="field__error modal__err">{err}</div>}

          <label className="field">
            <span className="field__label">Название турнира</span>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setErr('') }}
              className="input"
              placeholder="Субботний Mexicano"
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field__label">Дата и время</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="input"
            />
          </label>

          <div className="modal__row">
            <label className="field">
              <span className="field__label">Тип</span>
              <select value={type} onChange={e => setType(e.target.value)} className="input">
                {TOURNAMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Формат</span>
              <select value={format} onChange={e => setFormat(e.target.value)} className="input">
                {TOURNAMENT_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <label className="field field--compact">
              <span className="field__label">Корты</span>
              <input
                type="number" min={1} max={20}
                value={courts}
                onChange={e => setCourts(Number(e.target.value))}
                className="input"
              />
            </label>
          </div>

          <div className="modal__type-hint">
            {type === 'mexicano'
              ? 'Mexicano: партнёры меняются каждый раунд на основе текущего рейтинга.'
              : 'Americano: жеребьёвка минимизирует повторы партнёров, каждый сыграет со всеми.'}
            {' '}
            {format === '2v2' ? 'Формат 2×2: команды по два человека.' : 'Формат 1×1: одиночные матчи.'}
          </div>

          <div className="field">
            <span className="field__label">
              Участники ({players.length})
              {!canEditRoster && <span className="field__locked"> · состав заблокирован после начала</span>}
            </span>
            {canEditRoster && (
              <div className="inline-field">
                <input
                  ref={newNameRef}
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setErr('') }}
                  onKeyDown={e => e.key === 'Enter' && addPlayer()}
                  placeholder="Имя игрока"
                  className="input"
                />
                <button onClick={addPlayer} className="button button--dark">Добавить</button>
              </div>
            )}
          </div>

          <div className="player-list">
            {players.length === 0 && (
              <div className="empty-state" style={{ padding: '0.75rem' }}>Участников пока нет.</div>
            )}
            {players.map(p => (
              <div key={p.id} className="player-list__item">
                {editingId === p.id ? (
                  <div className="inline-field" style={{ width: '100%' }}>
                    <input
                      value={editingVal}
                      onChange={e => setEditingVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                      className="input"
                      autoFocus
                    />
                    <button onClick={saveEdit} className="button button--primary">OK</button>
                    <button onClick={() => setEditingId(null)} className="button button--ghost">✕</button>
                  </div>
                ) : (
                  <>
                    <span className="player-list__name">{p.name}</span>
                    {canEditRoster && (
                      <div className="player-list__actions">
                        <button
                          onClick={() => { setEditingId(p.id); setEditingVal(p.name) }}
                          className="button button--ghost button--icon"
                          title="Переименовать"
                        >✏</button>
                        <button
                          onClick={() => setPlayers(prev => prev.filter(x => x.id !== p.id))}
                          className="button button--danger-soft button--icon"
                          title="Удалить"
                        >✕</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal__footer">
          <button onClick={onClose} className="button button--ghost">Отмена</button>
          <button onClick={handleSave} className="button button--primary">
            {isEdit ? 'Сохранить' : 'Создать турнир'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Global Leaderboard ───────────────────────────────────────────────────────
function GlobalLeaderboard({ tournaments }) {
  const leaders = useMemo(() => computeGlobalLeaderboard(tournaments), [tournaments])

  return (
    <SectionCard
      title="Общий рейтинг"
      subtitle="Топ игроков по всем завершённым турнирам"
      accent="mint"
    >
      <div className="leaderboard">
        {leaders.length === 0 && (
          <div className="empty-state">
            Рейтинг появится после завершения первого турнира.
          </div>
        )}
        {leaders.slice(0, 20).map((p, i) => (
          <div key={p.name} className="leaderboard__item">
            <div className={`leaderboard__rank${i < 3 ? ` leaderboard__rank--${['gold','silver','bronze'][i]}` : ''}`}>
              #{i + 1}
            </div>
            <div className="leaderboard__main">
              <div className="leaderboard__name">{p.name}</div>
              <div className="leaderboard__meta">
                Побед {p.wins} · Игр {p.gamesPlayed} · Турниров {p.tournaments}
              </div>
            </div>
            <div className="leaderboard__score">{p.points}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

// ── Active Tournament Panel ──────────────────────────────────────────────────
function ActiveTournamentPanel({ tournament, isAdmin, onUpdate, showNotice }) {
  const { round, currentRound, history, players, format } = tournament
  const ranking = useMemo(() => sortPlayers(players), [players])
  const ppc = format === '1v1' ? 2 : 4
  const canStart = !currentRound && players.length >= ppc
  const canFinalize = currentRound &&
    !currentRound.matches.some(m => m.scoreA === '' || m.scoreB === '')

  function update(patch) { onUpdate({ ...tournament, ...patch }) }

  function handleStartRound() {
    if (!canStart) return
    const gen = generateRound(tournament)
    if (!gen.matches.length) { showNotice('Недостаточно игроков для жеребьёвки.', 'warning'); return }
    update({
      players: players.map(p =>
        gen.resting.some(r => r.id === p.id) ? { ...p, rests: p.rests + 1 } : p
      ),
      currentRound: gen,
      round: round + 1,
    })
  }

  function updateScore(idx, field, val) {
    if (!currentRound) return
    const matches = [...currentRound.matches]
    matches[idx] = { ...matches[idx], [field]: val }
    update({ currentRound: { ...currentRound, matches } })
  }

  function handleFinalize() {
    if (!canFinalize) return
    let updated = [...players]
    currentRound.matches.forEach(m => {
      const a = parseInt(m.scoreA, 10), b = parseInt(m.scoreB, 10)
      if (isNaN(a) || isNaN(b)) return
      const aWon = a > b; const tie = a === b
      const apply = (p, pts, won) => {
        updated = updated.map(x =>
          x.id === p.id
            ? { ...x, points: x.points + pts, wins: x.wins + (!tie && won ? 1 : 0), gamesPlayed: x.gamesPlayed + 1 }
            : x
        )
      }
      m.teamA.forEach(p => apply(p, a, aWon))
      m.teamB.forEach(p => apply(p, b, !aWon))
    })
    update({ players: updated, currentRound: null, history: [...history, { round, matches: currentRound.matches }] })
    showNotice(`Раунд ${round} зафиксирован.`, 'success')
  }

  function handleFinish() {
    if (history.length === 0) { showNotice('Нужен хотя бы один завершённый раунд.', 'warning'); return }
    update({ status: 'finished' })
    showNotice(`Турнир «${tournament.name}» завершён!`, 'success')
  }

  return (
    <>
      <SectionCard
        title={`${tournament.name}`}
        subtitle={`${typeLabel(tournament.type, tournament.format)} · Раундов: ${history.length} · ${players.length} игроков`}
        accent="mint"
        actions={isAdmin ? (
          <div className="section-card__actions">
            <button
              onClick={handleStartRound}
              disabled={!canStart || Boolean(currentRound)}
              className="button button--success"
            >
              Раунд {round + 1}
            </button>
            <button
              onClick={handleFinish}
              disabled={history.length === 0 || Boolean(currentRound)}
              className="button button--accent"
            >
              Завершить
            </button>
          </div>
        ) : null}
      >
        <div className="leaderboard">
          {ranking.length === 0 && <div className="empty-state">Нет игроков.</div>}
          {ranking.map((p, i) => (
            <div key={p.id} className="leaderboard__item">
              <div className={`leaderboard__rank${i < 3 ? ` leaderboard__rank--${['gold','silver','bronze'][i]}` : ''}`}>
                #{i + 1}
              </div>
              <div className="leaderboard__main">
                <div className="leaderboard__name">{p.name}</div>
                <div className="leaderboard__meta">
                  Побед {p.wins} · Игр {p.gamesPlayed} · Отдыхов {p.rests}
                </div>
              </div>
              <div className="leaderboard__score">{p.points}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {currentRound && (
        <SectionCard
          title={`Раунд ${round}`}
          subtitle="Введите счёт всех матчей, затем нажмите «Зафиксировать»."
          accent="sand"
          actions={isAdmin ? (
            <button
              onClick={handleFinalize}
              disabled={!canFinalize}
              className="button button--primary"
            >
              Зафиксировать
            </button>
          ) : null}
        >
          {currentRound.resting.length > 0 && (
            <div className="rest-banner">
              Отдыхают: {currentRound.resting.map(p => p.name).join(', ')}
            </div>
          )}
          <div className="round-grid">
            {currentRound.matches.map((match, idx) => (
              <div key={idx} className="match-card">
                <div className="match-card__court">Корт {match.court}</div>
                <div className="match-card__team">
                  {match.teamA.map(p => p.name).join(' и ')}
                </div>
                <div className="match-card__versus">против</div>
                <div className="match-card__team">
                  {match.teamB.map(p => p.name).join(' и ')}
                </div>
                {isAdmin ? (
                  <div className="score-entry">
                    <input
                      type="number" min={0}
                      value={match.scoreA}
                      onChange={e => updateScore(idx, 'scoreA', e.target.value)}
                      className="input input--score"
                    />
                    <span className="score-entry__dash">—</span>
                    <input
                      type="number" min={0}
                      value={match.scoreB}
                      onChange={e => updateScore(idx, 'scoreB', e.target.value)}
                      className="input input--score"
                    />
                  </div>
                ) : (
                  <div className="score-static">{match.scoreA || 0} — {match.scoreB || 0}</div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </>
  )
}

// ── Previous Tournaments ─────────────────────────────────────────────────────
function PreviousTournaments({ tournaments, isAdmin, onDelete }) {
  const finished = useMemo(
    () => [...tournaments.filter(t => t.status === 'finished')].reverse(),
    [tournaments]
  )
  const [openId, setOpenId] = useState(null)
  const [tab, setTab] = useState('ranking')

  function toggle(id) {
    setOpenId(prev => (prev === id ? null : id))
    setTab('ranking')
  }

  return (
    <SectionCard
      title="Прошедшие турниры"
      subtitle="Архив завершённых турниров с рейтингом и историей раундов."
      accent="sand"
    >
      <div className="archive-list">
        {finished.length === 0 && (
          <div className="empty-state">Завершённых турниров пока нет.</div>
        )}
        {finished.map(t => {
          const isOpen = openId === t.id
          const ranking = sortPlayers(t.players)
          return (
            <article key={t.id} className="archive-item">
              <div className="archive-item__top">
                <div>
                  <div className="archive-item__title">{t.name}</div>
                  <div className="archive-item__meta">
                    {t.scheduledAt ? formatDateTime(t.scheduledAt) : 'Дата не указана'}
                    {' · '}{typeLabel(t.type, t.format)}
                    {' · '}{t.history.length} раундов
                    {' · '}{t.players.length} игроков
                  </div>
                </div>
                <div className="archive-item__buttons">
                  <button
                    onClick={() => toggle(t.id)}
                    className="button button--ghost"
                  >
                    {isOpen ? 'Скрыть' : 'Открыть'}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => onDelete(t.id)}
                      className="button button--danger-soft"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="archive-item__body">
                  <div className="archive-tabs">
                    <button
                      className={`archive-tab${tab === 'ranking' ? ' archive-tab--active' : ''}`}
                      onClick={() => setTab('ranking')}
                    >
                      Рейтинг
                    </button>
                    <button
                      className={`archive-tab${tab === 'rounds' ? ' archive-tab--active' : ''}`}
                      onClick={() => setTab('rounds')}
                    >
                      Раунды ({t.history.length})
                    </button>
                  </div>

                  {tab === 'ranking' && (
                    <div className="mini-grid">
                      {ranking.length === 0 && (
                        <div className="empty-state">Нет данных о игроках.</div>
                      )}
                      {ranking.map((p, i) => (
                        <div key={p.id} className="mini-grid__row">
                          <div>#{i + 1} {p.name}</div>
                          <div className="mini-grid__stats">
                            <span>{p.points} очк.</span>
                            <span>{p.wins} поб.</span>
                            <span>{p.gamesPlayed} игр</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {tab === 'rounds' && (
                    <div className="history-list">
                      {t.history.length === 0 && (
                        <div className="empty-state">Нет сыгранных раундов.</div>
                      )}
                      {t.history.map(h => (
                        <div key={h.round} className="history-item">
                          <div className="history-item__title">Раунд {h.round}</div>
                          <div className="history-item__matches">
                            {h.matches.map((m, i) => (
                              <div key={i} className="history-match">
                                <span className="history-match__court">Корт {m.court}</span>
                                <span className="history-match__team">{m.teamA.map(p => p.name).join(' и ')}</span>
                                <span className="history-match__score">{m.scoreA} — {m.scoreB}</span>
                                <span className="history-match__team">{m.teamB.map(p => p.name).join(' и ')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState('viewer')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState(null)

  const [tournaments, setTournaments] = useState(() => load('pb_tournaments', []))
  const [syncStatus, setSyncStatus] = useState('Загрузка...')
  const [syncError, setSyncError] = useState('')
  const [lastPublishedAt, setLastPublishedAt] = useState(null)
  const [hasUnpublished, setHasUnpublished] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  const isAdmin = mode === 'admin'

  const active = useMemo(() => tournaments.filter(t => t.status === 'active'), [tournaments])
  const upcoming = useMemo(
    () => [...tournaments.filter(t => t.status === 'upcoming')].sort((a, b) =>
      (a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1
    ),
    [tournaments]
  )
  const finishedCount = useMemo(() => tournaments.filter(t => t.status === 'finished').length, [tournaments])

  const totalPlayers = useMemo(() => {
    const names = new Set()
    tournaments.forEach(t => t.players.forEach(p => names.add(normalizeName(p.name).toLowerCase())))
    return names.size
  }, [tournaments])
  const totalMatches = useMemo(
    () => tournaments.reduce((s, t) => s + t.history.reduce((a, r) => a + r.matches.length, 0), 0),
    [tournaments]
  )

  useEffect(() => save('pb_tournaments', tournaments), [tournaments])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(id)
  }, [notice])
  useEffect(() => { void loadPublished() }, [])

  function showNotice(msg, type = 'info') { setNotice({ message: msg, type }) }
  function markChanged() { setHasUnpublished(true); setSyncStatus('Есть неопубликованные изменения') }

  async function loadPublished() {
    setIsRefreshing(true)
    try {
      const payload = await fetchSharedState()
      const next = migrateOldState(payload.state)
      setTournaments(next)
      setLastPublishedAt(payload.updatedAt ?? null)
      setHasUnpublished(false)
      setSyncStatus(payload.updatedAt ? 'Данные загружены' : 'Нет опубликованных данных')
      setSyncError('')
      showNotice('Данные турнира загружены.', 'success')
    } catch {
      setSyncStatus('Работаем локально')
      setSyncError('Нет связи с сервером. Используются локальные данные.')
      showNotice('Нет связи с сервером.', 'warning')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function publish(next = tournaments) {
    setIsPublishing(true)
    try {
      const payload = await pushSharedState({ tournaments: next })
      setLastPublishedAt(payload.updatedAt ?? null)
      setHasUnpublished(false)
      setSyncStatus('Опубликовано')
      setSyncError('')
      showNotice('Изменения опубликованы.', 'success')
    } catch {
      setSyncStatus('Не опубликовано')
      setSyncError('Ошибка публикации. Данные сохранены локально.')
      showNotice('Ошибка публикации.', 'error')
    } finally {
      setIsPublishing(false)
    }
  }

  function patchTournament(updated) {
    setTournaments(prev => prev.map(t => t.id === updated.id ? updated : t))
    markChanged()
  }

  function deleteTournament(id) {
    setTournaments(prev => prev.filter(t => t.id !== id))
    markChanged()
  }

  function handleCreate(t) {
    setTournaments(prev => [...prev, t])
    setShowCreate(false)
    markChanged()
    showNotice(`Турнир «${t.name}» создан.`, 'success')
  }

  function handleSaveEdit(t) {
    patchTournament(t)
    setEditTarget(null)
    showNotice(`Турнир «${t.name}» обновлён.`, 'success')
  }

  function startTournament(id) {
    setTournaments(prev => prev.map(t => t.id === id ? { ...t, status: 'active' } : t))
    markChanged()
    showNotice('Турнир начат!', 'success')
  }

  function login() {
    if (password.trim() === ADMIN_PASSWORD) {
      setMode('admin'); setPassword(''); setLoginError('')
      showNotice('Режим администратора включён.', 'success')
      return
    }
    setLoginError('Неверный пароль')
  }

  const nextUpcoming = upcoming[0]

  return (
    <div className="page-shell">
      <div className="page-shell__backdrop page-shell__backdrop--left" />
      <div className="page-shell__backdrop page-shell__backdrop--right" />

      <main className="app-frame">
        <Notification notice={notice} />

        {/* ── Hero ── */}
        <section className="hero-panel">
          <div className="hero-panel__copy">
            <div className="eyebrow">Пиклбол · Турнирный менеджер</div>
            <h1 className="hero-panel__title">Управляй турниром, следи за счётом.</h1>
            <p className="hero-panel__text">
              Создавай турниры в форматах Mexicano и Americano — 2×2 или 1×1.
              Автоматическая жеребьёвка, честный рейтинг и архив всех игр.
            </p>
            <div className="hero-panel__badges">
              <span className={`status-pill ${isAdmin ? 'status-pill--success' : 'status-pill--neutral'}`}>
                {isAdmin ? 'Администратор' : 'Просмотр'}
              </span>
              <span className="status-pill status-pill--neutral">{syncStatus}</span>
              {hasUnpublished && (
                <span className="status-pill status-pill--warning">Есть изменения</span>
              )}
            </div>
            <div className="hero-panel__meta">
              <div>Последняя публикация: {lastPublishedAt ? formatDateTime(lastPublishedAt) : 'не опубликовано'}</div>
              {syncError && <div className="hero-panel__warning">{syncError}</div>}
            </div>
          </div>
          <div className="hero-panel__visual">
            <CourtAnimation />
          </div>
        </section>

        {/* ── Stats ── */}
        <section className="stats-row">
          <StatTile
            label="Игроков всего"
            value={totalPlayers}
            hint={`${tournaments.length} ${tournaments.length === 1 ? 'турнир' : 'турниров'}`}
          />
          <StatTile
            label="Активных"
            value={active.length}
            hint={active[0]?.name ?? 'нет активных'}
          />
          <StatTile
            label="Предстоящих"
            value={upcoming.length}
            hint={nextUpcoming ? (formatDateTime(nextUpcoming.scheduledAt) ?? 'дата не указана') : '—'}
          />
          <StatTile
            label="Матчей сыграно"
            value={totalMatches}
            hint={`${finishedCount} завершённых`}
          />
        </section>

        <div className="workspace-grid">
          <div className="workspace-grid__main">

            {/* ── Control bar ── */}
            <SectionCard
              title="Управление"
              subtitle="Публикуй изменения, чтобы зрители видели актуальные данные."
              accent="mint"
              actions={!isAdmin ? (
                <button
                  onClick={() => void loadPublished()}
                  disabled={isRefreshing}
                  className="button button--ghost"
                >
                  {isRefreshing ? 'Загрузка...' : 'Обновить'}
                </button>
              ) : null}
            >
              {isAdmin ? (
                <div className="toolbar__buttons">
                  <button onClick={() => setShowCreate(true)} className="button button--dark">
                    + Создать турнир
                  </button>
                  <button
                    onClick={() => void publish()}
                    disabled={isPublishing || !hasUnpublished}
                    className="button button--primary"
                  >
                    {isPublishing ? 'Публикация...' : 'Опубликовать'}
                  </button>
                  <button
                    onClick={() => void loadPublished()}
                    disabled={isRefreshing}
                    className="button button--ghost"
                  >
                    {isRefreshing ? 'Загрузка...' : 'Перезагрузить'}
                  </button>
                </div>
              ) : (
                <form className="viewer-login" onSubmit={e => { e.preventDefault(); login() }}>
                  <input
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); if (loginError) setLoginError('') }}
                    placeholder="Пароль администратора"
                    className="input"
                  />
                  <button type="submit" className="button button--dark">Войти</button>
                  {loginError && <div className="field__error">{loginError}</div>}
                </form>
              )}
            </SectionCard>

            {/* ── Upcoming ── */}
            {(upcoming.length > 0 || isAdmin) && (
              <SectionCard
                title="Предстоящие турниры"
                subtitle="Запланированные турниры, которые ещё не начались."
                accent="sand"
              >
                <div className="archive-list">
                  {upcoming.length === 0 && (
                    <div className="empty-state">
                      Предстоящих турниров нет. Создайте новый кнопкой выше.
                    </div>
                  )}
                  {upcoming.map(t => (
                    <article key={t.id} className="archive-item">
                      <div className="archive-item__top">
                        <div>
                          <div className="archive-item__title">{t.name}</div>
                          <div className="archive-item__meta">
                            {t.scheduledAt ? formatDateTime(t.scheduledAt) : 'Дата не указана'}
                            {' · '}{typeLabel(t.type, t.format)}
                            {' · '}{t.players.length} игроков
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="archive-item__buttons">
                            <button
                              onClick={() => startTournament(t.id)}
                              className="button button--success"
                              disabled={t.players.length < (t.format === '1v1' ? 2 : 4)}
                            >
                              Начать
                            </button>
                            <button
                              onClick={() => setEditTarget(t)}
                              className="button button--ghost"
                            >
                              Изменить
                            </button>
                            <button
                              onClick={() => deleteTournament(t.id)}
                              className="button button--danger-soft"
                            >
                              Удалить
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* ── Active tournaments ── */}
            {active.map(t => (
              <ActiveTournamentPanel
                key={t.id}
                tournament={t}
                isAdmin={isAdmin}
                onUpdate={patchTournament}
                showNotice={showNotice}
              />
            ))}

            {active.length === 0 && upcoming.length === 0 && (
              <SectionCard title="Нет активных турниров" accent="default">
                <div className="empty-state">
                  {isAdmin
                    ? 'Создайте турнир кнопкой «+ Создать турнир» выше.'
                    : 'Ожидайте начала турнира.'}
                </div>
              </SectionCard>
            )}

            {/* ── Global Leaderboard ── */}
            <GlobalLeaderboard tournaments={tournaments} />

            {/* ── Previous tournaments ── */}
            <PreviousTournaments
              tournaments={tournaments}
              isAdmin={isAdmin}
              onDelete={deleteTournament}
            />

          </div>

          {/* ── Sidebar ── */}
          <aside className="workspace-grid__side">
            {nextUpcoming && (
              <SectionCard title="Ближайший турнир" accent="mint">
                <div className="sidebar-event">
                  <div className="sidebar-event__name">{nextUpcoming.name}</div>
                  {nextUpcoming.scheduledAt && (
                    <div className="sidebar-event__date">{formatDateTime(nextUpcoming.scheduledAt)}</div>
                  )}
                  <div className="sidebar-event__meta">{typeLabel(nextUpcoming.type, nextUpcoming.format)}</div>
                  {nextUpcoming.players.length > 0 && (
                    <>
                      <div className="sidebar-event__players-title">
                        {nextUpcoming.players.length} игроков:
                      </div>
                      <div className="sidebar-players">
                        {nextUpcoming.players.map(p => (
                          <span key={p.id} className="sidebar-player">{p.name}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </SectionCard>
            )}

            {active.map(t => {
              const top5 = sortPlayers(t.players).slice(0, 5)
              return (
                <SectionCard key={t.id} title={t.name} subtitle="Текущие лидеры" accent="sand">
                  <div className="mini-grid">
                    {top5.map((p, i) => (
                      <div key={p.id} className="mini-grid__row">
                        <div>#{i + 1} {p.name}</div>
                        <div>{p.points} очк.</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )
            })}
          </aside>
        </div>
      </main>

      {showCreate && (
        <TournamentModal onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <TournamentModal
          initial={editTarget}
          onSave={handleSaveEdit}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  )
}
