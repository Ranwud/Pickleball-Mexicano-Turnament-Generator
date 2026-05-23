import { get, put } from '@vercel/blob'

const STATE_PATHNAME = 'pickleball-mexicano/shared-state.json'

const defaultState = {
  tournamentName: 'Saturday Mexicano Cup',
  players: [],
  round: 0,
  currentRound: null,
  history: [],
  finished: false,
  archivedTournaments: [],
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  })
}

async function readState() {
  const blob = await get(STATE_PATHNAME, {
    access: 'private',
  })

  if (!blob) {
    return {
      state: defaultState,
      updatedAt: null,
    }
  }

  const data = await blob.text()
  const parsed = JSON.parse(data)

  return {
    state: {
      ...defaultState,
      ...parsed.state,
    },
    updatedAt: parsed.updatedAt ?? null,
  }
}

export async function GET() {
  try {
    const payload = await readState()
    return jsonResponse(payload)
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to load shared state',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const nextState = {
      ...defaultState,
      ...body?.state,
    }

    const payload = {
      state: nextState,
      updatedAt: new Date().toISOString(),
    }

    await put(STATE_PATHNAME, JSON.stringify(payload), {
      access: 'private',
      contentType: 'application/json',
      allowOverwrite: true,
    })

    return jsonResponse(payload)
  } catch (error) {
    return jsonResponse(
      {
        error: 'Failed to save shared state',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
