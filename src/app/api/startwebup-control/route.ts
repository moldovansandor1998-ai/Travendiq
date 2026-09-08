import { NextRequest, NextResponse } from 'next/server'

const safeKey = (value: unknown) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(String(value ?? ''))

async function dbRequest(path: string, init: RequestInit = {}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Missing server configuration')
  return fetch(`${base}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    cache: 'no-store',
  })
}

export async function POST(request: NextRequest) {
  const secret = process.env.STARTWEBUP_CONTROL_SECRET
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!secret) return NextResponse.json({ error: 'StartWebUp control is not configured' }, { status: 503 })
  if (!supplied || supplied !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action ?? '')

  if (action === 'health') {
    const response = await dbRequest('/rest/v1/engine_features?select=feature_key,enabled&limit=1')
    return NextResponse.json({ ok: response.ok, engine: 'booking', control_version: 1 }, { status: response.ok ? 200 : 500 })
  }

  if (action === 'feature.set') {
    const featureKey = String(body?.feature_key ?? '')
    if (!safeKey(featureKey)) return NextResponse.json({ error: 'Invalid feature key' }, { status: 400 })
    const enabled = Boolean(body?.enabled)
    const config = body?.config && typeof body.config === 'object' ? body.config : {}
    let response = await dbRequest(`/rest/v1/engine_features?feature_key=eq.${encodeURIComponent(featureKey)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ enabled, config, updated_at: new Date().toISOString() }),
    })
    let result = await response.json().catch(() => null)
    if (!response.ok) return NextResponse.json({ error: result?.message || 'Feature update failed' }, { status: 400 })
    if (!Array.isArray(result) || result.length === 0) {
      response = await dbRequest('/rest/v1/engine_features', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ feature_key: featureKey, enabled, config }) })
      result = await response.json().catch(() => null)
      if (!response.ok) return NextResponse.json({ error: result?.message || 'Feature insert failed' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, feature: Array.isArray(result) ? result[0] : result })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
