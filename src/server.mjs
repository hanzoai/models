/**
 * models.hanzo.ai — Model Registry API
 *
 * Serves cacheable model definitions for Zen + third-party models.
 * Orthogonal to pricing.hanzo.ai — definitions here, prices there.
 *
 * Sources:
 *   - Zen models: @zenlm/models (canonical, npm package)
 *   - Third-party: OpenRouter /api/v1/models (synced daily)
 */

import express from 'express'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { runSync } from './sync.mjs'

const PORT = process.env.PORT || 8080
const DATA_FILE = new URL('../data/models.json', import.meta.url).pathname
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

const app = express()
app.use(express.json())

// CORS
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Cache headers — model definitions change infrequently
app.use('/v1', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
  next()
})

let data = null
let lastSync = null

async function loadData() {
  if (!existsSync(DATA_FILE)) return null
  const raw = await readFile(DATA_FILE, 'utf-8')
  return JSON.parse(raw)
}

async function sync() {
  try {
    data = await runSync()
    lastSync = new Date().toISOString()
    console.log(`[sync] OK — ${data.summary.zenModels} zen, ${data.summary.thirdPartyModels} third-party`)
  } catch (err) {
    console.error('[sync] FAILED:', err.message)
  }
}

// ── Health ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    lastSync,
    summary: data?.summary || null,
  })
})

// ── All models ─────────────────────────────────────────────────────────

app.get('/v1/models', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })

  const { category, status, generation, modality, q } = req.query
  let models = [...data.zenModels, ...data.thirdPartyModels]

  if (category) models = models.filter(m => m.category === category)
  if (status) models = models.filter(m => m.status === status)
  if (generation) models = models.filter(m => m.generation === generation)
  if (modality) models = models.filter(m => m.modalities?.includes(modality))
  if (q) {
    const term = q.toLowerCase()
    models = models.filter(m =>
      m.id?.toLowerCase().includes(term) ||
      m.name?.toLowerCase().includes(term) ||
      m.provider?.toLowerCase().includes(term) ||
      m.description?.toLowerCase().includes(term)
    )
  }

  res.json({
    updated: data.updated,
    total: models.length,
    models,
  })
})

// ── Zen models only ────────────────────────────────────────────────────

app.get('/v1/models/zen', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })
  res.json({
    updated: data.updated,
    total: data.zenModels.length,
    models: data.zenModels,
  })
})

// ── Third-party models only ────────────────────────────────────────────

app.get('/v1/models/third-party', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })
  res.json({
    updated: data.updated,
    total: data.thirdPartyModels.length,
    models: data.thirdPartyModels,
  })
})

// ── Model families ─────────────────────────────────────────────────────

app.get('/v1/models/families', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })
  res.json({
    updated: data.updated,
    families: data.families,
  })
})

// ── Providers ──────────────────────────────────────────────────────────

app.get('/v1/models/providers', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })
  res.json({
    updated: data.updated,
    providers: data.providers,
  })
})

// ── Summary ────────────────────────────────────────────────────────────

app.get('/v1/models/summary', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })
  res.json({
    updated: data.updated,
    summary: data.summary,
  })
})

// ── Single model lookup ────────────────────────────────────────────────

app.get('/v1/models/:id', (req, res) => {
  if (!data) return res.status(503).json({ error: 'not synced yet' })

  const id = req.params.id.toLowerCase()
  const model =
    data.zenModels.find(m => m.id === id || m.aliases?.includes(id)) ||
    data.thirdPartyModels.find(m =>
      m.id?.toLowerCase() === id ||
      m.id?.toLowerCase().endsWith('/' + id) ||
      m.name?.toLowerCase() === id
    )

  if (!model) return res.status(404).json({ error: 'model not found' })
  res.json(model)
})

// ── Manual sync trigger ────────────────────────────────────────────────

app.post('/v1/sync', (req, res) => {
  const key = process.env.MODELS_API_KEY
  if (key) {
    const auth = req.headers.authorization
    if (!auth || auth !== `Bearer ${key}`) {
      return res.status(401).json({ error: 'unauthorized' })
    }
  }
  sync().then(() => res.json({ status: 'ok', lastSync }))
})

// ── Start ──────────────────────────────────────────────────────────────

const server = app.listen(PORT, async () => {
  console.log(`[models] listening on :${PORT}`)
  await sync()
  setInterval(sync, SYNC_INTERVAL_MS)
})

process.on('SIGTERM', () => { server.close(); process.exit(0) })
process.on('SIGINT', () => { server.close(); process.exit(0) })
