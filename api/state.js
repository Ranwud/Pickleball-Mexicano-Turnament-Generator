import { get, list, put } from '@vercel/blob'

const SNAPSHOT_PREFIX = 'pickleball-mexicano/snapshots/'

const defaultState = {
  tournaments: [],
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

async function readBlobText(blob) {
  if (typeof blob.text === 'function') return blob.text()
  if (blob.body) return new Response(blob.body).text()
  if (blob.stream) {
    const stream = typeof blob.stream === 'function' ? blob.stream() : blob.stream
    return new Response(stream).text()
  }
  throw new Error('Blob payload is missing a readable body')
}

function migrateState(raw) {
  if (!raw) return defaultState
  // New format: has tournaments array
  if (Array.isArray(raw.tournaments)) return { tournaments: raw.tournaments }
  // Old format: had archivedTournaments etc — convert to new
  const archived = (raw.archivedTournaments ?? []).map(t => ({
    id: t.id ?? `t-migrated-${Date.now()}-${Math.random()}`,
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
  return { tournaments: archived }
}

async function readLatestState() {
  const { blobs } = await list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
  if (!blobs.length) return { state: defaultState, updatedAt: null }

  const latestBlob = blobs[blobs.length - 1]
  const blob = await get(latestBlob.url, { access: 'private' })
  if (!blob) return { state: defaultState, updatedAt: null }

  const parsed = JSON.parse(await readBlobText(blob))
  return {
    state: migrateState(parsed.state),
    updatedAt: parsed.updatedAt ?? null,
  }
}

export async function GET() {
  try {
    const payload = await readLatestState()
    return jsonResponse(payload)
  } catch (error) {
    return jsonResponse(
      { error: 'Failed to load shared state', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const nextState = migrateState(body?.state)
    const updatedAt = new Date().toISOString()
    const pathname = `${SNAPSHOT_PREFIX}${Date.now().toString().padStart(13, '0')}.json`
    const payload = { state: nextState, updatedAt, pathname }

    await put(pathname, JSON.stringify(payload), {
      access: 'private',
      contentType: 'application/json',
    })

    return jsonResponse(payload)
  } catch (error) {
    return jsonResponse(
      { error: 'Failed to save shared state', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
