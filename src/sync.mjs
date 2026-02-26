/**
 * Sync module — builds models.json from canonical sources.
 *
 * Zen models:      @zenlm/models (npm, THE single source of truth)
 * Third-party:     OpenRouter /api/v1/models (definitions only, no pricing)
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { allModels, families } from '@zenlm/models'

const DATA_FILE = new URL('../data/models.json', import.meta.url).pathname
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models'

/**
 * Fetch third-party model definitions from OpenRouter.
 * Only metadata — no pricing (that's pricing.hanzo.ai's job).
 */
async function fetchThirdPartyModels() {
  try {
    const res = await fetch(OPENROUTER_API)
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const { data } = await res.json()

    return data.map(m => ({
      id: m.id,
      name: m.name,
      provider: deriveProvider(m.id),
      description: m.description || null,
      context: m.context_length || null,
      modalities: deriveModalities(m),
      status: 'available',
      category: 'third-party',
    }))
  } catch (err) {
    console.error('[sync] OpenRouter fetch failed:', err.message)
    return []
  }
}

function deriveProvider(id) {
  if (!id || !id.includes('/')) return 'Unknown'
  const prefix = id.split('/')[0]
  const map = {
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'google': 'Google',
    'meta-llama': 'Meta',
    'mistralai': 'Mistral',
    'deepseek': 'DeepSeek',
    'qwen': 'Qwen',
    'cohere': 'Cohere',
    'x-ai': 'xAI',
    'microsoft': 'Microsoft',
    'nvidia': 'NVIDIA',
    'perplexity': 'Perplexity',
    'amazon': 'Amazon',
    'databricks': 'Databricks',
    'ai21': 'AI21',
    'together': 'Together',
    'fireworks': 'Fireworks',
    'groq': 'Groq',
  }
  return map[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

function deriveModalities(m) {
  const mods = []
  const arch = m.architecture?.modality || ''
  if (arch.includes('text')) mods.push('text')
  if (arch.includes('image') || m.id?.includes('vision')) mods.push('vision')
  if (arch.includes('audio')) mods.push('audio')
  if (m.id?.includes('coder') || m.id?.includes('code')) mods.push('code')
  if (mods.length === 0) mods.push('text')
  return mods
}

/**
 * Build provider summary from third-party models.
 */
function buildProviders(thirdParty) {
  const providers = {}
  for (const m of thirdParty) {
    if (!providers[m.provider]) {
      providers[m.provider] = { total: 0, models: [] }
    }
    providers[m.provider].total++
    providers[m.provider].models.push(m.id)
  }
  return providers
}

/**
 * Transform @zenlm/models ZenModel to API format.
 */
function transformZenModel(m) {
  return {
    id: m.id,
    name: m.name,
    fullName: m.fullName,
    description: m.description,
    provider: 'Hanzo',
    generation: m.generation,
    tier: m.tier,
    category: m.category,
    modalities: m.modalities,
    spec: m.spec,
    features: m.features,
    status: m.status,
    huggingface: m.huggingface,
    github: m.github,
    aliases: m.aliases,
  }
}

/**
 * Run full sync and write data file.
 */
export async function runSync() {
  console.log('[sync] starting...')

  // Zen models from @zenlm/models (canonical)
  const zenModels = allModels.map(transformZenModel)

  // Third-party from OpenRouter (definitions only)
  const thirdPartyModels = await fetchThirdPartyModels()

  // Providers
  const providers = buildProviders(thirdPartyModels)

  const data = {
    updated: new Date().toISOString(),
    summary: {
      zenModels: zenModels.length,
      thirdPartyModels: thirdPartyModels.length,
      totalModels: zenModels.length + thirdPartyModels.length,
      providers: Object.keys(providers).length,
      families: families.length,
      categories: [...new Set(zenModels.map(m => m.category))],
      generations: [...new Set(zenModels.map(m => m.generation))],
    },
    zenModels,
    thirdPartyModels,
    families: families.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      icon: f.icon,
      models: f.models,
    })),
    providers,
  }

  // Write to disk
  await mkdir(dirname(DATA_FILE), { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2))
  console.log(`[sync] wrote ${DATA_FILE}`)

  return data
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
