/**
 * Sync module — discovers available models from live upstream sources.
 *
 * THE GATEWAY IS THE SOURCE OF TRUTH, for both halves of the catalog and for
 * every number in it. api.hanzo.ai/v1/models states what is routable right now
 * and what each route costs, and the id shape splits the listing the same way
 * the gateway publishes it: a bare id is ours, a `vendor/model` id is a lab's.
 * So the page can never advertise a model the endpoint does not serve, and a
 * price on the page is the price that will be billed.
 *
 * Prose is enrichment, and each half has its own source: zenCatalog below for
 * ours, the OpenRouter listing for the labs'. Enrichment can only add a name and
 * a description to an id the gateway already listed — it never adds a model.
 *
 * No npm package imports. Everything is live.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const DATA_FILE = new URL('../data/models.json', import.meta.url).pathname
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models'
const FETCH_TIMEOUT_MS = 30_000

// zen-gateway is behind api.hanzo.ai. In-cluster, use the service URL.
const ZEN_GATEWAY_URL =
  process.env.ZEN_GATEWAY_URL ||
  process.env.API_URL ||
  'https://api.hanzo.ai'

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── Zen model metadata ──────────────────────────────────────────────────
// Enrichment data for models discovered from the gateway.
// The gateway is the source of truth for WHAT'S ENABLED.
// This catalog adds descriptions, specs, families, features.
// If a model is in the gateway but not here, it still appears — just minimal.
//
// BRAND POLICY: Never expose upstream model names. Zen models are our own.

const zenCatalog = {
  // Zen4 Generation
  'zen4':             { fullName: 'Zen4 — Flagship', description: 'Flagship MoE model for complex reasoning and multi-domain tasks.', features: ['202K context window', 'Flagship intelligence', '100+ languages'], tier: 'ultra max', context: 202000, specs: { params: '744B (40B active)', arch: 'MoE' }, generation: 'zen4', category: 'chat' },
  'zen4-ultra':       { fullName: 'Zen4 Ultra — Maximum Reasoning', description: 'Maximum reasoning capability with extended chain-of-thought on MoE architecture.', features: ['262K context window', 'Deep reasoning', 'Chain-of-thought'], tier: 'ultra max', context: 262000, specs: { params: '744B (40B active)', arch: 'MoE + CoT' }, generation: 'zen4', category: 'chat' },
  'zen4-pro':         { fullName: 'Zen4 Pro — High Capability', description: 'Efficient MoE model for demanding workloads with strong reasoning at production-grade cost.', features: ['131K context window', 'MoE architecture'], tier: 'ultra', context: 131000, specs: { params: '80B (3B active)', arch: 'MoE' }, generation: 'zen4', category: 'chat' },
  'zen4-max':         { fullName: 'Zen4 Max — Maximum Intelligence', description: 'Most capable model for complex reasoning, analysis, and agentic tasks. 1M token context window.', features: ['1M context window', 'Maximum intelligence', 'Agentic coding'], tier: 'ultra max', context: 1000000, specs: { params: 'N/A', arch: 'Dense' }, generation: 'zen4', category: 'chat' },
  'zen4.1':           { fullName: 'Zen4.1 — Extended Context', description: 'High-performance 1M context model for long-document analysis and agentic workflows.', features: ['1M context window', 'Agentic coding', 'Cost efficient'], tier: 'ultra', context: 1000000, specs: { params: 'N/A', arch: 'Dense' }, generation: 'zen4', category: 'chat' },
  'zen4-mini':        { fullName: 'Zen4 Mini — Fast & Efficient', description: 'Ultra-fast lightweight model optimized for speed and cost efficiency.', features: ['128K context window', 'Ultra-fast inference', 'Free tier'], tier: 'starter', context: 128000, specs: { params: 'N/A', arch: 'Dense' }, generation: 'zen4', category: 'chat' },
  'zen4-thinking':    { fullName: 'Zen4 Thinking — Deep Reasoning', description: 'Dedicated reasoning model with explicit chain-of-thought capabilities.', features: ['131K context window', 'Chain-of-thought'], tier: 'pro max', context: 131000, specs: { params: '80B (3B active)', arch: 'MoE + CoT' }, generation: 'zen4', category: 'chat' },
  // Zen4 Code
  'zen4-coder':       { fullName: 'Zen4 Coder — Code Generation', description: 'Code-specialized MoE model for generation, review, debugging, and agentic programming.', features: ['163K context window', 'All major languages'], tier: 'ultra', context: 163000, specs: { params: '480B (35B active)', arch: 'MoE' }, generation: 'zen4', category: 'code' },
  'zen4-coder-pro':   { fullName: 'Zen4 Coder Pro — Premium Code', description: 'Full-precision BF16 code model for maximum accuracy on complex codebases.', features: ['131K context window', 'BF16 full precision'], tier: 'ultra max', context: 131000, specs: { params: '480B', arch: 'Dense BF16' }, generation: 'zen4', category: 'code' },
  'zen4-coder-flash': { fullName: 'Zen4 Coder Flash — Fast Code', description: 'Lightweight code model optimized for speed and inline completions.', features: ['262K context window', 'Fast inference'], tier: 'pro max', context: 262000, specs: { params: '30B (3B active)', arch: 'MoE' }, generation: 'zen4', category: 'code' },
  // Zen3 Generation — Chat
  'zen3-omni':        { fullName: 'Zen3 Omni — Hypermodal', description: 'Multimodal model supporting text, vision, audio, and structured output.', features: ['202K context window', 'Text + Vision + Audio'], tier: 'pro max', context: 202000, specs: { params: '~200B', arch: 'Dense Multimodal' }, generation: 'zen3', category: 'chat' },
  'zen3-vl':          { fullName: 'Zen3 VL — Vision-Language', description: 'Vision-language model for image understanding and visual reasoning.', features: ['262K context window', 'Vision + Language'], tier: 'pro max', context: 262000, specs: { params: '30B (3B active)', arch: 'MoE Vision-Language' }, generation: 'zen3', category: 'vision' },
  'zen3-nano':        { fullName: 'Zen3 Nano — Edge', description: 'Ultra-lightweight model for edge deployment and low-latency tasks.', features: ['128K context window', '8B parameters', 'Free tier'], tier: 'starter', context: 128000, specs: { params: '8B', arch: 'Dense' }, generation: 'zen3', category: 'chat' },
  'zen3-guard':       { fullName: 'Zen3 Guard — Content Safety', description: 'Content safety classifier for moderation and guardrails. 9 safety categories, 119 languages.', features: ['65K context window', 'Safety classifier'], tier: 'pro', context: 65000, specs: { params: '4B', arch: 'Dense' }, generation: 'zen3', category: 'safety' },
  // Zen3 Embedding
  'zen3-embedding':         { fullName: 'Zen3 Embedding', description: 'High-quality text embeddings for RAG, search, and classification.', features: ['8K context window', '3072 dimensions'], tier: 'pro max', context: 8000, specs: { params: 'N/A', arch: 'Embedding' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/embeddings' },
  'zen3-embedding-medium':  { fullName: 'Zen3 Embedding Medium', description: 'Balanced embedding model for cost-effective retrieval workloads.', features: ['40K context window', '4B parameters'], tier: 'pro', context: 40000, specs: { params: '4B', arch: 'Embedding' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/embeddings' },
  'zen3-embedding-small':   { fullName: 'Zen3 Embedding Small', description: 'Lightweight embedding model for high-throughput, low-cost applications.', features: ['32K context window', '0.6B parameters'], tier: 'starter', context: 32000, specs: { params: '0.6B', arch: 'Embedding' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/embeddings' },
  'zen3-embedding-openai':  { fullName: 'Zen3 Embedding — OpenAI Compatible', description: 'OpenAI-compatible embedding endpoint for drop-in migration.', features: ['8K context window', '3072 dimensions'], tier: 'pro max', context: 8000, specs: { params: 'N/A', arch: 'Embedding' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/embeddings' },
  // Zen3 Reranker
  'zen3-reranker':        { fullName: 'Zen3 Reranker', description: 'High-quality reranker for improving retrieval accuracy in RAG pipelines.', features: ['40K context window', '8B parameters'], tier: 'pro max', context: 40000, specs: { params: '8B', arch: 'Reranker' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/rerank' },
  'zen3-reranker-medium': { fullName: 'Zen3 Reranker Medium', description: 'Balanced reranker for cost-effective retrieval quality improvement.', features: ['40K context window', '4B parameters'], tier: 'pro', context: 40000, specs: { params: '4B', arch: 'Reranker' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/rerank' },
  'zen3-reranker-small':  { fullName: 'Zen3 Reranker Small', description: 'Lightweight reranker for high-throughput reranking at minimal cost.', features: ['40K context window', '0.6B parameters'], tier: 'starter', context: 40000, specs: { params: '0.6B', arch: 'Reranker' }, generation: 'zen3', category: 'embedding', endpoint: '/v1/rerank' },
  // Zen3 Image
  'zen3-image':           { fullName: 'Zen3 Image', description: 'Best general-purpose image generation.', features: ['Text-to-image', 'Image editing'], tier: 'pro max', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-max':       { fullName: 'Zen3 Image Max', description: 'Maximum quality image generation for professional creative work.', features: ['Text-to-image', 'Maximum quality'], tier: 'ultra max', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-dev':       { fullName: 'Zen3 Image Dev', description: 'Development model for experimentation and iteration.', features: ['Text-to-image', 'Development'], tier: 'pro', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-fast':      { fullName: 'Zen3 Image Fast', description: 'Fastest image model for real-time generation.', features: ['Text-to-image', 'Ultra-fast'], tier: 'pro', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-sdxl':      { fullName: 'Zen3 Image SDXL', description: 'High-resolution image generation at 1024px.', features: ['Text-to-image', '1024px'], tier: 'pro', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-playground': { fullName: 'Zen3 Image Playground', description: 'Aesthetic model for artistic image generation.', features: ['Text-to-image', 'Aesthetic'], tier: 'pro', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-ssd':       { fullName: 'Zen3 Image SSD', description: 'Fastest diffusion model for real-time generation.', features: ['Text-to-image', 'Fastest'], tier: 'starter', specs: { params: '1B', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  'zen3-image-jp':        { fullName: 'Zen3 Image JP', description: 'Japanese-specialized image generation model.', features: ['Text-to-image', 'Japanese'], tier: 'pro', specs: { params: 'N/A', arch: 'Diffusion' }, generation: 'zen3', category: 'image', endpoint: '/v1/images/generations' },
  // Zen3 Audio / ASR
  'zen3-audio':       { fullName: 'Zen3 Audio', description: 'Best quality speech-to-text transcription. 100+ languages.', features: ['Multi-language', 'Best accuracy', '100+ languages'], tier: 'pro max', specs: { params: '1.5B', arch: 'ASR' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/transcriptions' },
  'zen3-audio-fast':  { fullName: 'Zen3 Audio Fast', description: 'Fastest speech-to-text for high-throughput workloads.', features: ['Multi-language', 'Fastest', 'Batch optimized'], tier: 'pro', specs: { params: '809M', arch: 'ASR' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/transcriptions' },
  'zen3-asr':         { fullName: 'Zen3 ASR', description: 'Real-time streaming speech recognition for live transcription and voice agents.', features: ['Streaming', 'Real-time', 'Sub-500ms latency'], tier: 'pro max', specs: { params: 'N/A', arch: 'Streaming ASR' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/transcriptions' },
  'zen3-asr-v1':      { fullName: 'Zen3 ASR v1', description: 'First-generation streaming ASR for legacy compatibility.', features: ['Streaming', 'Legacy'], tier: 'pro', specs: { params: 'N/A', arch: 'Streaming ASR' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/transcriptions' },
  // Zen3 TTS
  'zen3-tts':         { fullName: 'Zen3 TTS', description: 'High-quality text-to-speech with natural prosody. 40+ voices, 8 languages.', features: ['40+ voices', '8 languages', 'Natural prosody'], tier: 'pro max', specs: { params: '82M', arch: 'TTS' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/speech' },
  'zen3-tts-hd':      { fullName: 'Zen3 TTS HD', description: 'Maximum fidelity text-to-speech for broadcast-quality audio.', features: ['HD quality', 'Broadcast-grade', '48kHz output'], tier: 'ultra max', specs: { params: 'N/A', arch: 'TTS HD' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/speech' },
  'zen3-tts-fast':    { fullName: 'Zen3 TTS Fast', description: 'Low-latency text-to-speech for real-time voice agents.', features: ['Low latency', 'Real-time', 'Voice agents'], tier: 'pro', specs: { params: '82M', arch: 'TTS' }, generation: 'zen3', category: 'audio', endpoint: '/v1/audio/speech' },
  // Zen5 — Early Access (not yet routed in gateway)
  'zen5':             { fullName: 'Zen5 — Next Generation', description: 'Next-generation agentic frontier model with native chain-of-thought.', features: ['1M+ context window', 'Agentic-trained', 'Native CoT'], tier: 'ultra max', context: 1048576, specs: { params: 'TBA', arch: 'MoDE + CoT' }, generation: 'zen5', category: 'chat', contactSales: true },
  'zen5-pro':         { fullName: 'Zen5 Pro — Advanced', description: 'High-throughput agentic model for demanding production workloads.', features: ['512K context window', 'Agentic-trained', 'Native CoT'], tier: 'ultra', context: 524288, specs: { params: 'TBA', arch: 'MoDE + CoT' }, generation: 'zen5', category: 'chat', contactSales: true },
  'zen5-max':         { fullName: 'Zen5 Max — Extended', description: 'Maximum context agentic model for document-scale analysis.', features: ['2M context window', 'Agentic-trained', 'Extended CoT'], tier: 'ultra max', context: 2097152, specs: { params: 'TBA', arch: 'MoDE + CoT' }, generation: 'zen5', category: 'chat', contactSales: true },
  'zen5-ultra':       { fullName: 'Zen5 Ultra — Deep Reasoning', description: 'Deepest reasoning model. Multi-pass chain-of-thought with self-verification.', features: ['1M context window', 'Deep CoT', 'Self-verification'], tier: 'ultra max', context: 1048576, specs: { params: 'TBA', arch: 'MoDE + Deep CoT' }, generation: 'zen5', category: 'chat', contactSales: true },
  'zen5-mini':        { fullName: 'Zen5 Mini — Efficient', description: 'Efficient agentic model delivering zen5-class intelligence at a fraction of the cost.', features: ['256K context window', 'Native CoT', 'Cost efficient'], tier: 'pro', context: 262144, specs: { params: 'TBA', arch: 'MoDE + CoT' }, generation: 'zen5', category: 'chat', contactSales: true },
  // Foundation (open-weight, self-hosted via Fireworks)
  'zen':              { fullName: 'Zen — Foundation', description: 'General-purpose foundation model.', features: ['131K context', 'Open weights'], tier: 'pro', context: 131000, specs: { params: '32B', arch: 'Dense' }, generation: 'foundation', category: 'chat' },
  'zen-pro':          { fullName: 'Zen Pro — Large', description: 'High-capability open-weight foundation model.', features: ['131K context', 'Open weights'], tier: 'ultra', context: 131000, specs: { params: '72B', arch: 'Dense' }, generation: 'foundation', category: 'chat' },
  'zen-max':          { fullName: 'Zen Max — Largest', description: 'Largest open-weight foundation model.', features: ['131K context', 'Open weights'], tier: 'ultra max', context: 131000, specs: { params: '235B', arch: 'MoE' }, generation: 'foundation', category: 'chat' },
  'zen-mini':         { fullName: 'Zen Mini — Small', description: 'Compact open-weight model for fast inference.', features: ['128K context', 'Open weights'], tier: 'starter', context: 128000, specs: { params: '8B', arch: 'Dense' }, generation: 'foundation', category: 'chat' },
  'zen-nano':         { fullName: 'Zen Nano — Tiny', description: 'Smallest model for edge and mobile.', features: ['128K context', 'Open weights', 'Edge'], tier: 'starter', context: 128000, specs: { params: '0.6B', arch: 'Dense' }, generation: 'foundation', category: 'chat' },
  'zen-coder':        { fullName: 'Zen Coder — Open Code', description: 'Open-weight code generation model.', features: ['131K context', 'Code'], tier: 'pro', context: 131000, specs: { params: '32B', arch: 'Dense' }, generation: 'foundation', category: 'code' },
  'zen-coder-flash':  { fullName: 'Zen Coder Flash — Fast Code', description: 'Fast open-weight code model.', features: ['131K context', 'Code', 'Fast'], tier: 'starter', context: 131000, specs: { params: '8B', arch: 'Dense' }, generation: 'foundation', category: 'code' },
  'zen-coder-pro':    { fullName: 'Zen Coder Pro — Large Code', description: 'Large open-weight code model.', features: ['131K context', 'Code'], tier: 'ultra', context: 131000, specs: { params: '72B', arch: 'Dense' }, generation: 'foundation', category: 'code' },
  'zen-omni':         { fullName: 'Zen Omni — Open Multimodal', description: 'Open-weight multimodal model with vision.', features: ['131K context', 'Vision + Text'], tier: 'pro', context: 131000, specs: { params: '32B', arch: 'Dense Multimodal' }, generation: 'foundation', category: 'vision' },
  'zen-vl':           { fullName: 'Zen VL — Open Vision', description: 'Open-weight vision-language model.', features: ['131K context', 'Vision'], tier: 'pro', context: 131000, specs: { params: '32B', arch: 'Dense Multimodal' }, generation: 'foundation', category: 'vision' },
  'zen-guard':        { fullName: 'Zen Guard — Open Safety', description: 'Open-weight content safety model.', features: ['65K context', 'Safety'], tier: 'pro', context: 65000, specs: { params: '4B', arch: 'Dense' }, generation: 'foundation', category: 'safety' },
  'zen-embedding':    { fullName: 'Zen Embedding — Open', description: 'Open-weight embedding model.', features: ['8K context', 'Embeddings'], tier: 'pro', context: 8000, specs: { params: 'N/A', arch: 'Embedding' }, generation: 'foundation', category: 'embedding', endpoint: '/v1/embeddings' },
  'zen-reranker':     { fullName: 'Zen Reranker — Open', description: 'Open-weight reranker model.', features: ['8K context', 'Reranking'], tier: 'pro', context: 8000, specs: { params: 'N/A', arch: 'Reranker' }, generation: 'foundation', category: 'embedding', endpoint: '/v1/rerank' },
  'zen-agent':        { fullName: 'Zen Agent', description: 'Agent-optimized model for tool use and planning.', features: ['131K context', 'Tool use', 'Planning'], tier: 'pro', context: 131000, specs: { params: '32B', arch: 'Dense' }, generation: 'foundation', category: 'agents' },
}

// ── Model families ──────────────────────────────────────────────────────

const zenFamilies = [
  { id: 'zen5', name: 'Zen 5', description: 'Next-generation agentic models with native chain-of-thought.', icon: 'Rocket', models: ['zen5', 'zen5-pro', 'zen5-max', 'zen5-ultra', 'zen5-mini'] },
  { id: 'zen4', name: 'Zen 4', description: 'Latest generation production models with MoDE architecture.', icon: 'Sparkles', models: ['zen4-max', 'zen4.1', 'zen4', 'zen4-ultra', 'zen4-pro', 'zen4-thinking', 'zen4-mini'] },
  { id: 'code', name: 'Code', description: 'Specialized models for code generation, review, and debugging.', icon: 'Code', models: ['zen4-coder', 'zen4-coder-flash', 'zen4-coder-pro', 'zen-coder', 'zen-coder-flash', 'zen-coder-pro'] },
  { id: 'zen3', name: 'Zen 3 Multimodal', description: 'Vision, safety, and multimodal chat models.', icon: 'Eye', models: ['zen3-omni', 'zen3-vl', 'zen3-nano', 'zen3-guard'] },
  { id: 'embedding', name: 'Embedding & Retrieval', description: 'Text embeddings and search reranking via API.', icon: 'Search', models: ['zen3-embedding', 'zen3-embedding-medium', 'zen3-embedding-small', 'zen3-reranker', 'zen3-reranker-medium', 'zen3-reranker-small', 'zen-embedding', 'zen-reranker'] },
  { id: 'image', name: 'Image Generation', description: 'Text-to-image generation via API.', icon: 'Image', models: ['zen3-image', 'zen3-image-max', 'zen3-image-dev', 'zen3-image-fast', 'zen3-image-sdxl', 'zen3-image-playground', 'zen3-image-ssd', 'zen3-image-jp'] },
  { id: 'audio', name: 'Audio & Speech', description: 'Speech-to-text, text-to-speech, and streaming ASR.', icon: 'Mic', models: ['zen3-audio', 'zen3-audio-fast', 'zen3-asr', 'zen3-asr-v1', 'zen3-tts', 'zen3-tts-hd', 'zen3-tts-fast'] },
  { id: 'foundation', name: 'Foundation', description: 'General-purpose open-weight models.', icon: 'Brain', models: ['zen-nano', 'zen-mini', 'zen', 'zen-pro', 'zen-max'] },
  { id: 'vision', name: 'Vision (Open Weights)', description: 'Vision-language open-weight models.', icon: 'Eye', models: ['zen-vl', 'zen-omni'] },
  { id: 'safety', name: 'Safety', description: 'Content moderation and safety guardrail models.', icon: 'Shield', models: ['zen3-guard', 'zen-guard'] },
  { id: 'agents', name: 'Agents', description: 'Agent-optimized models for tool use and planning.', icon: 'Network', models: ['zen-agent'] },
]

// ── Discovery ───────────────────────────────────────────────────────────

/**
 * Read the gateway listing — every model routable right now, ours and the labs'.
 * One read, because both halves of the catalog and every price come out of it.
 */
async function fetchGateway() {
  const url = `${ZEN_GATEWAY_URL}/v1/models`
  console.log(`[sync] Reading the gateway listing from ${url}...`)
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const { data } = await res.json()
    const models = (data || []).filter(m => m && typeof m.id === 'string' && m.id.trim())
    console.log(`[sync] Gateway lists ${models.length} models`)
    return models
  } catch (err) {
    console.error(`[sync] Gateway read failed: ${err.message}`)
    return []
  }
}

/**
 * Build Zen model entries by merging gateway-discovered models with catalog metadata.
 * Models in gateway but not in catalog still appear (minimal info).
 * Models in catalog with contactSales=true appear even if not in gateway.
 */
function buildZenModels(enabledIds) {
  const enabledSet = new Set(enabledIds)
  const seen = new Set()
  const zenModels = []

  // 1. All enabled models from gateway (enriched with catalog if available)
  for (const id of enabledIds) {
    seen.add(id)
    const meta = zenCatalog[id]
    if (meta) {
      zenModels.push({
        id,
        name: meta.fullName || id,
        ...meta,
        provider: 'Hanzo',
        status: 'available',
      })
    } else {
      // Gateway has it but no catalog entry — still serve it (minimal)
      console.warn(`[sync] Model ${id} in gateway but not in catalog — serving minimal`)
      zenModels.push({
        id,
        name: id,
        fullName: id,
        description: `Zen model: ${id}`,
        features: [],
        tier: 'pro',
        provider: 'Hanzo',
        status: 'available',
        generation: id.startsWith('zen4') ? 'zen4' : id.startsWith('zen3') ? 'zen3' : 'foundation',
        category: 'chat',
      })
    }
  }

  // 2. Catalog-only models not in gateway (e.g. zen5 early access, upcoming)
  for (const [id, meta] of Object.entries(zenCatalog)) {
    if (seen.has(id)) continue
    if (meta.contactSales) {
      zenModels.push({
        id,
        name: meta.fullName || id,
        ...meta,
        provider: 'Hanzo',
        status: 'contact-sales',
      })
    }
    // Non-contactSales models not in gateway are simply not available — skip
  }

  return zenModels
}

/**
 * Prose for the labs' models, keyed by the id the gateway routes. A name and a
 * description and nothing else — what a model IS and what it COSTS come from the
 * gateway, so nothing here can put a model on the page or change its price.
 */
async function fetchThirdPartyProse() {
  try {
    const res = await fetchWithTimeout(OPENROUTER_API)
    if (!res.ok) throw new Error(`${res.status}`)
    const { data } = await res.json()
    const prose = new Map()
    for (const m of data || []) {
      if (!m?.id) continue
      prose.set(m.id, { name: (m.name || '').trim() || null, description: plain(m.description) })
    }
    console.log(`[sync] Prose for ${prose.size} lab models`)
    return prose
  } catch (err) {
    console.error('[sync] Prose fetch failed:', err.message)
    return new Map()
  }
}

/**
 * Prose as a page can render it: markdown links become their own text and bare
 * URLs are dropped. A description written for someone else's site carries their
 * links, and a static page renders neither the markup nor the link — it prints
 * both, verbatim, in the middle of a sentence.
 */
function plain(text) {
  if (typeof text !== 'string') return null
  const out = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return out || null
}

/** A readable name for an id no prose describes: the model half, as written. */
function nameFromId(id) {
  const tail = id.slice(id.indexOf('/') + 1)
  return tail || id
}

/**
 * The labs' half of the gateway listing: every `vendor/model` route, carrying the
 * context and price the gateway states, named and described where prose has it.
 */
function buildThirdPartyModels(gateway, prose) {
  return gateway
    .filter(m => m.id.includes('/'))
    .map(m => {
      const p = prose.get(m.id)
      return {
        id: m.id,
        name: p?.name || nameFromId(m.id),
        provider: deriveProvider(m.id),
        description: p?.description || null,
        context: m.context_window || null,
        pricing: m.pricing ? { input: m.pricing.input ?? null, output: m.pricing.output ?? null } : null,
        modalities: m.supports_vision ? ['text', 'vision'] : ['text'],
        status: 'available',
        category: 'third-party',
      }
    })
}

function deriveProvider(id) {
  if (!id || !id.includes('/')) return 'Unknown'
  const prefix = id.split('/')[0]
  const map = {
    'openai': 'OpenAI', 'anthropic': 'Anthropic', 'google': 'Google',
    'meta-llama': 'Meta', 'mistralai': 'Mistral', 'deepseek': 'DeepSeek',
    'qwen': 'Qwen', 'cohere': 'Cohere', 'x-ai': 'xAI',
    'microsoft': 'Microsoft', 'nvidia': 'NVIDIA', 'perplexity': 'Perplexity',
    'amazon': 'Amazon', 'databricks': 'Databricks', 'ai21': 'AI21',
    'together': 'Together', 'fireworks': 'Fireworks', 'groq': 'Groq',
  }
  return map[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

function buildProviders(thirdParty) {
  const providers = {}
  for (const m of thirdParty) {
    if (!providers[m.provider]) providers[m.provider] = { total: 0, models: [] }
    providers[m.provider].total++
    providers[m.provider].models.push(m.id)
  }
  return providers
}

// ── Main sync ───────────────────────────────────────────────────────────

/**
 * Run full sync: read the gateway, dress it in prose, write to disk.
 * Accepts previousData to preserve each half on upstream failure.
 */
export async function runSync(previousData = null) {
  console.log('[sync] starting...')

  // 1. The gateway listing — both halves of the catalog, and every price.
  const gateway = await fetchGateway()
  const enabledIds = gateway.filter(m => !m.id.includes('/')).map(m => m.id)

  // If gateway is down, preserve previous zen data
  let zenModels
  if (enabledIds.length === 0 && previousData?.zenModels?.length > 0) {
    console.warn('[sync] Gateway returned 0 models — preserving previous Zen data')
    zenModels = previousData.zenModels
  } else {
    zenModels = buildZenModels(enabledIds)
  }

  // 2. The labs' half, dressed in prose.
  let thirdPartyModels = buildThirdPartyModels(gateway, await fetchThirdPartyProse())
  if (thirdPartyModels.length === 0 && previousData?.thirdPartyModels?.length > 0) {
    console.warn('[sync] Gateway listed no lab models — preserving previous third-party data')
    thirdPartyModels = previousData.thirdPartyModels
  }

  // 3. Build output
  const providers = buildProviders(thirdPartyModels)

  // Filter families to only include models that are actually available or in catalog
  const allModelIds = new Set(zenModels.map(m => m.id))
  const families = zenFamilies.map(f => ({
    ...f,
    models: f.models.filter(id => allModelIds.has(id)),
  })).filter(f => f.models.length > 0)

  const data = {
    updated: new Date().toISOString(),
    summary: {
      zenModels: zenModels.length,
      thirdPartyModels: thirdPartyModels.length,
      totalModels: zenModels.length + thirdPartyModels.length,
      providers: Object.keys(providers).length,
      families: families.length,
      categories: [...new Set(zenModels.map(m => m.category))],
      generations: [...new Set(zenModels.map(m => m.generation).filter(Boolean))],
    },
    zenModels,
    thirdPartyModels,
    families,
    providers,
  }

  // Write to disk
  await mkdir(dirname(DATA_FILE), { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2))
  console.log(`[sync] wrote ${DATA_FILE}`)
  console.log(`[sync] Zen: ${zenModels.length} | Third-party: ${thirdPartyModels.length} | Total: ${data.summary.totalModels}`)

  return data
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
