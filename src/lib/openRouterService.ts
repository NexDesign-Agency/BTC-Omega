import { KlineData, SignalResult } from './signalEngine'

export interface AISignalCard {
  type: 'BUY' | 'SELL' | 'WAIT'
  label: string
  entry: string
  sl: string
  tp1: string
  tp2: string
  rr: string
  confidence: number
  note: string
  reasoning: string
}

export interface AIAnalysisResult {
  primaryEntry: AISignalCard
  scalpTrend: AISignalCard
  scalpCounter: AISignalCard
  marketAnalysis: string
  tfDirections: Record<string, { direction: string; strength: number }>
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

// ─── FREE FALLBACK MODELS — last-resort static list ────────────────────────
// Ini hanya safety net. Model aktual diambil dari dynamic fetch OpenRouter API.
// Dari log terbukti yang masih punya provider aktif:
const FREE_FALLBACK_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',      // Terbukti punya provider (429 bukan 404)
  'nousresearch/hermes-3-llama-3.1-405b:free',   // Terbukti punya provider
  'qwen/qwen3-coder:free',                        // Terbukti punya provider
  'mistralai/mistral-7b-instruct:free',           // Fallback lama, sering ada
  'huggingfaceh4/zephyr-7b-beta:free',            // Safety net
]
let cachedDynamicFreeModels: string[] | null = null
let cachedDynamicFreeModelsAt = 0

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface CreateChatCompletionArgs {
  apiKey: string
  model: string
  messages: OpenRouterChatMessage[]
  temperature?: number
  max_tokens?: number
}

interface CreateChatCompletionResult {
  data: any
  usedModel: string
  usedFallback: boolean
}

function isInsufficientBalanceError(status: number, errText: string): boolean {
  if (status === 402 || status === 403 || status === 429) return true
  const text = errText.toLowerCase()
  return (
    text.includes('insufficient') ||
    text.includes('insufficient_quota') ||
    text.includes('balance') ||
    text.includes('credit') ||
    text.includes('credits') ||
    text.includes('quota') ||
    text.includes('quota exceeded') ||
    text.includes('billing') ||
    text.includes('payment required') ||
    text.includes('payment') ||
    text.includes('rate limit') ||
    text.includes('no provider') ||
    text.includes('no endpoint') ||
    text.includes('no endpoints') ||
    text.includes('provider returned error')
  )
}

function extractAffordableMaxTokens(errText: string): number | null {
  const m = errText.match(/can only afford\s+(\d+)/i)
  if (!m) return null
  const affordable = parseInt(m[1], 10)
  if (!Number.isFinite(affordable) || affordable <= 32) return null
  return Math.max(64, affordable - 16)
}

// Skor model berdasarkan kecenderungan kuat untuk analisa trading + JSON output
function scoreFreeModel(id: string): number {
  const s = id.toLowerCase()
  let score = 0
  // Model yang diketahui kuat untuk reasoning & JSON terstruktur
  if (s.includes('deepseek-r1'))            score += 100
  if (s.includes('deepseek-chat-v3'))       score += 95
  if (s.includes('qwen3-235b'))             score += 90
  if (s.includes('qwen3-30b'))              score += 80
  if (s.includes('gemini-2.0-flash'))       score += 85
  if (s.includes('llama-4-maverick'))       score += 82
  if (s.includes('llama-4-scout'))          score += 75
  if (s.includes('phi-4-reasoning'))        score += 72
  if (s.includes('hermes-3'))               score += 70  // terbukti aktif dari log
  if (s.includes('llama-3.3-70b'))          score += 68
  if (s.includes('qwen3-coder'))            score += 65  // terbukti aktif dari log
  if (s.includes('mistral-small-3.1'))      score += 60
  if (s.includes('mistral-small-3.2'))      score += 62
  if (s.includes('qwen3'))                  score += 55
  if (s.includes('llama-3.1-70b'))          score += 50
  if (s.includes('llama-3.1-405b'))         score += 65
  // Boost untuk model yang dikenal bisa handle long JSON
  if (s.includes('70b') || s.includes('72b')) score += 15
  if (s.includes('235b') || s.includes('405b')) score += 20
  if (s.includes('instruct') || s.includes('chat')) score += 5
  // Penalti untuk model yang sering gagal JSON kompleks
  if (s.includes('vision') || s.includes('audio') || s.includes('omni')) score -= 50
  if (s.includes('2b') || s.includes('3b') || s.includes('4b')) score -= 30
  if (s.includes('7b') || s.includes('8b') || s.includes('9b')) score -= 20
  return score
}

async function getDynamicFreeFallbackModels(): Promise<string[]> {
  const now = Date.now()
  if (cachedDynamicFreeModels && now - cachedDynamicFreeModelsAt < 10 * 60 * 1000) {
    return cachedDynamicFreeModels
  }
  try {
    const res = await fetch(OPENROUTER_MODELS_URL)
    if (!res.ok) return []
    const data = await res.json()
    const ids: string[] = Array.isArray(data?.data)
      ? data.data
          .map((m: any) => String(m?.id || ''))
          .filter((id: string) => id.endsWith(':free') && scoreFreeModel(id) > 0)
      : []
    // Sort by score descending — model terkuat duluan
    ids.sort((a, b) => scoreFreeModel(b) - scoreFreeModel(a))
    cachedDynamicFreeModels = ids
    cachedDynamicFreeModelsAt = now
    return cachedDynamicFreeModels
  } catch {
    return []
  }
}

async function postChatCompletion(
  apiKey: string,
  model: string,
  messages: OpenRouterChatMessage[],
  temperature: number,
  max_tokens: number
): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
    }),
  })
}

export async function createOpenRouterChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.7,
  max_tokens = 2048,
}: CreateChatCompletionArgs): Promise<CreateChatCompletionResult> {
  // Dynamic models diambil dulu — ini yang BENAR-BENAR tersedia di OpenRouter sekarang
  const dynamicFreeModels = await getDynamicFreeFallbackModels()

  // Urutan kandidat yang BENAR:
  // 1. Model utama (pilihan user)
  // 2. Dynamic models dari API (up-to-date, yang benar-benar ada providernya) — difilter yang belum dicoba
  // 3. Static FREE_FALLBACK_MODELS sebagai last resort
  const staticSet = new Set(FREE_FALLBACK_MODELS)
  const dynamicSet = new Set(dynamicFreeModels)
  const candidateModels = [
    model,
    ...dynamicFreeModels.filter((m) => m !== model),                            // dynamic dulu!
    ...FREE_FALLBACK_MODELS.filter((m) => m !== model && !dynamicSet.has(m)),   // static hanya jika belum ada di dynamic
  ]
  let shouldTryFallback = false
  let firstErrorText = ''
  let firstErrorStatus = 0
  let fallbackMaxTokens = Math.min(max_tokens, 1024)
  let consecutive429 = 0
  const MAX_CONSECUTIVE_429 = 6 // stop setelah 6 model berturut-turut rate-limited

  for (let i = 0; i < candidateModels.length; i++) {
    const candidateModel = candidateModels[i]
    if (i > 0 && !shouldTryFallback) break

    // Delay adaptif:
    // - 404 = tidak perlu delay (langsung skip, provider tidak ada)
    // - 429 = tunggu lebih lama sesuai berapa kali sudah rate-limited
    if (i > 0) {
      const delay = consecutive429 > 0
        ? Math.min(2000 + consecutive429 * 1000, 8000) // 2s, 3s, 4s, ... max 8s
        : 300                                           // 404 = cukup 300ms
      await new Promise(r => setTimeout(r, delay))
    }

    const tokensForAttempt = i === 0 ? max_tokens : fallbackMaxTokens
    const res = await postChatCompletion(apiKey, candidateModel, messages, temperature, tokensForAttempt)
    if (res.ok) {
      const data = await res.json()
      const bodyErrorText =
        typeof data?.error === 'string'
          ? data.error
          : data?.error?.message || data?.message || ''
      if (bodyErrorText && isInsufficientBalanceError(res.status, String(bodyErrorText))) {
        if (i === 0) {
          firstErrorText = String(bodyErrorText)
          firstErrorStatus = res.status || 402
          shouldTryFallback = true
          continue
        }
      }
      const content = data?.choices?.[0]?.message?.content
      if (!content || (typeof content === 'string' && !content.trim())) {
        // Respons kosong sering terjadi di model tertentu; lanjut coba fallback berikutnya.
        if (i < candidateModels.length - 1) {
          if (i === 0) {
            firstErrorText = 'Primary model returned empty content'
            firstErrorStatus = res.status || 200
            shouldTryFallback = true
          }
          continue
        }
      }
      return {
        data,
        usedModel: candidateModel,
        usedFallback: i > 0,
      }
    }

    const errText = await res.text()
    const isRateLimit = res.status === 429
    const isNotFound = res.status === 404
    if (isRateLimit) consecutive429++
    else consecutive429 = 0  // reset: 404 bukan rate limit, jangan accumulate

    if (i === 0) {
      firstErrorText = errText
      firstErrorStatus = res.status
      // 404 = model tidak ditemukan, 402/429 = quota/rate limit → coba fallback
      shouldTryFallback = isNotFound || isInsufficientBalanceError(res.status, errText)
      const affordableTokens = extractAffordableMaxTokens(errText)
      if (affordableTokens) {
        fallbackMaxTokens = Math.min(fallbackMaxTokens, affordableTokens)
      }
      if (!shouldTryFallback) {
        throw new Error(`OpenRouter API error ${res.status}: ${errText.slice(0, 200)}`)
      }
      console.warn(`Primary model failed (${res.status}), trying free fallback...`)
      continue
    }
    // Stop jika terlalu banyak rate limit berturut-turut
    if (consecutive429 >= MAX_CONSECUTIVE_429) {
      console.warn(`${MAX_CONSECUTIVE_429} consecutive 429s — stopping fallback chain`)
      break
    }
    // Fallback model gagal → skip saja, lanjut ke berikutnya
    console.warn(`Fallback model ${candidateModel} failed (${res.status}), trying next...`)
    continue
  }

  throw new Error(
    `OpenRouter API error ${firstErrorStatus}: ${firstErrorText.slice(0, 200)}`
  )
}

function klinesToText(klines: any[], label: string, limit = 30): string {
  const data = klines.slice(-limit)
  const lines: string[] = [`## ${label} (${data.length} candles)`]
  lines.push('```')
  lines.push('Time(UTC)    Open      High      Low       Close')
  lines.push('─'.repeat(62))
  for (const k of data) {
    const d = new Date(k[0])
    const time = d.toISOString().slice(11, 16)
    const dt = d.toISOString().slice(5, 10)
    const o = parseFloat(k[1]).toFixed(1).padStart(9)
    const h = parseFloat(k[2]).toFixed(1).padStart(9)
    const l = parseFloat(k[3]).toFixed(1).padStart(9)
    const c = parseFloat(k[4]).toFixed(1).padStart(9)
    lines.push(`${dt} ${time} ${o} ${h} ${l} ${c}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function buildPrompt(currentPrice: number, kd: KlineData): string {
  const h4Text = kd.h4?.length ? klinesToText(kd.h4, 'H4', 20) : '(data H4 tidak tersedia)'
  const h1Text = kd.h1?.length ? klinesToText(kd.h1, 'H1', 24) : '(data H1 tidak tersedia)'
  const m15Text = kd.m15?.length ? klinesToText(kd.m15, 'M15', 30) : '(data M15 tidak tersedia)'
  const m5Text = kd.m5?.length ? klinesToText(kd.m5, 'M5', 30) : '(data M5 tidak tersedia)'

  return `Kamu adalah AI trading analyst spesialis BTCUSD. Analisis data OHLCV multi-timeframe di bawah dan berikan sinyal trading.

**HARGA BTCUSD SAAT INI: $${currentPrice.toLocaleString()}**

**DATA CHART:**

${h4Text}

${h1Text}

${m15Text}

${m5Text}

---

**TUGAS:** Analisis chart multi-timeframe dan berikan output dalam format JSON STRICT berikut (JANGAN tambahkan teks lain selain JSON):

\`\`\`json
{
  "primaryEntry": {
    "type": "BUY" | "SELL" | "WAIT",
    "label": "Label pendek (contoh: PRIMARY SWING BUY @ 86500)",
    "entry": "harga entry dalam string (contoh: 86500.0)",
    "sl": "harga stop loss",
    "tp1": "harga take profit 1",
    "tp2": "harga take profit 2", 
    "rr": "risk:reward ratio (contoh: 1:2.5)",
    "confidence": 75,
    "note": "Penjelasan singkat 1-2 kalimat Bahasa Indonesia",
    "reasoning": "Alasan detail kenapa entry ini dipilih"
  },
  "scalpTrend": { ...struktur sama, untuk scalp searah tren },
  "scalpCounter": { ...struktur sama, untuk scalp counter tren },
  "marketAnalysis": "Analisis komprehensif market saat ini dalam Bahasa Indonesia. Mencakup: macro bias, struktur market, level kunci, sentimen sesi, dan rekomendasi action sekarang. Format markdown dengan bullet points.",
  "tfDirections": {
    "H4": { "direction": "UP"|"DOWN"|"SIDEWAYS", "strength": 75 },
    "H1": { "direction": "UP"|"DOWN"|"SIDEWAYS", "strength": 60 },
    "M15": { "direction": "UP"|"DOWN"|"SIDEWAYS", "strength": 55 },
    "M5": { "direction": "UP"|"DOWN"|"SIDEWAYS", "strength": 50 }
  }
}
\`\`\`

**ATURAN WAJIB — BACA SEMUA SEBELUM MENJAWAB:**

PRIMARY ENTRY (Swing):
- Entry berdasarkan struktur H1/H4 — pullback ke S/R major atau breakout valid
- Jarak entry dari harga sekarang BOLEH jauh (swing = menunggu harga datang ke level)
- Jika tidak ada setup jelas → type: "WAIT"

SCALP TREND dan SCALP COUNTER — ATURAN JARAK KETAT:
- WAJIB: Entry scalp harus dalam radius maksimal 0.8% dari harga sekarang
- Radius 0.8% dari $${currentPrice.toLocaleString()} = range $${Math.round(currentPrice * 0.992).toLocaleString()} sampai $${Math.round(currentPrice * 1.008).toLocaleString()}
- Jika TIDAK ADA S/R dalam radius ini → WAJIB return type: "WAIT" dengan entry: "---"
- DILARANG KERAS memasukkan entry scalp di luar range tersebut

ATURAN UMUM:
- TP1 dan TP2 berdasarkan S/R nyata di chart, bukan angka random
- SL minimal 0.3% dari entry. RR minimal 1:1.5
- Confidence 0-100. Jika tidak yakin → confidence rendah (<50)
- ANALISIS PAKAI BAHASA INDONESIA
- Output HARUS JSON valid, tidak boleh ada teks sebelum/sesudah JSON`
}

export async function fetchAIAnalysis(
  currentPrice: number,
  kd: KlineData,
  apiKey: string,
  model: string
): Promise<AIAnalysisResult | null> {
  const prompt = buildPrompt(currentPrice, kd)

  try {
    const { data, usedFallback, usedModel } = await createOpenRouterChatCompletion({
      apiKey,
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.65,
      max_tokens: 4096,
    })
    if (usedFallback) {
      console.warn(`Primary model quota/balance issue, switched to free model: ${usedModel}`)
    }
    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      console.error('Empty response from OpenRouter')
      return null
    }

    const parsed = parseAIResponse(content, currentPrice)
    return parsed
  } catch (err) {
    console.error('fetchAIAnalysis error:', err)
    throw err
  }
}

// Guard: batalkan scalp entry jika terlalu jauh dari harga sekarang (max 0.8%)
function enforceScalpRadius(card: AISignalCard, currentPrice: number): AISignalCard {
  if (card.type === 'WAIT' || card.entry === '---') return card
  const entryNum = parseFloat(card.entry)
  if (!entryNum || !currentPrice) return card
  const distPct = Math.abs(entryNum - currentPrice) / currentPrice * 100
  if (distPct > 0.8) {
    return {
      type: 'WAIT', label: 'TIDAK ADA SCALP DALAM RADIUS',
      entry: '---', sl: '---', tp1: '---', tp2: '---', rr: '---',
      confidence: 0,
      note: `Level ${entryNum.toLocaleString()} terlalu jauh (${distPct.toFixed(1)}% dari harga). Tunggu harga mendekati S/R.`,
      reasoning: `Entry scalp harus dalam 0.8% dari harga sekarang ($${currentPrice.toLocaleString()}). Level ini di luar radius.`,
    }
  }
  return card
}

function parseAIResponse(content: string, currentPrice: number): AIAnalysisResult | null {
  let jsonStr = content.trim()

  // Try to extract JSON from markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  // Try to find JSON object boundaries
  const objMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (objMatch) {
    jsonStr = objMatch[0]
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // Validate and normalize
    const normalize = (card: any): AISignalCard => {
      const entryNum = parseFloat(card.entry || '0')
      const slNum = parseFloat(card.sl || '0')
      const tp1Num = parseFloat(card.tp1 || '0')
      const tp2Num = parseFloat(card.tp2 || '0')

      const risk = Math.abs(entryNum - slNum)
      const rr = risk > 0 ? `1:${(Math.abs(tp1Num - entryNum) / risk).toFixed(1)}` : card.rr || '---'

      return {
        type: card.type === 'BUY' || card.type === 'SELL' ? card.type : 'WAIT',
        label: card.label || 'MENUNGGU SINYAL',
        entry: entryNum > 0 ? entryNum.toFixed(1) : '---',
        sl: slNum > 0 ? slNum.toFixed(1) : '---',
        tp1: tp1Num > 0 ? tp1Num.toFixed(1) : '---',
        tp2: tp2Num > 0 ? tp2Num.toFixed(1) : '---',
        rr,
        confidence: typeof card.confidence === 'number' ? Math.round(Math.max(0, Math.min(100, card.confidence))) : 0,
        note: card.note || '',
        reasoning: card.reasoning || '',
      }
    }

    return {
      primaryEntry: normalize(parsed.primaryEntry || { type: 'WAIT' }),
      scalpTrend: enforceScalpRadius(normalize(parsed.scalpTrend || { type: 'WAIT' }), currentPrice),
      scalpCounter: enforceScalpRadius(normalize(parsed.scalpCounter || { type: 'WAIT' }), currentPrice),
      marketAnalysis: parsed.marketAnalysis || 'Analisis tidak tersedia.',
      tfDirections: parsed.tfDirections || {
        H4: { direction: 'SIDEWAYS', strength: 0 },
        H1: { direction: 'SIDEWAYS', strength: 0 },
        M15: { direction: 'SIDEWAYS', strength: 0 },
        M5: { direction: 'SIDEWAYS', strength: 0 },
      },
    }
  } catch (e) {
    console.error('Failed to parse AI response JSON:', e)
    console.error('Raw content:', content.slice(0, 500))
    return null
  }
}

export function aiResultToSuggestions(result: AIAnalysisResult): SignalResult[] {
  const toSignal = (card: AISignalCard, tier: number): SignalResult => ({
    type: card.type,
    tier,
    label: card.label,
    note: card.note,
    reasoning: card.reasoning,
    confidence: card.confidence,
    zone: card.entry,
    sl: card.sl,
    tp1: card.tp1,
    tp2: card.tp2,
    rr: card.rr,
  })

  const sigs: SignalResult[] = [
    toSignal(result.primaryEntry, 1),
    toSignal(result.scalpTrend, 2),
    toSignal(result.scalpCounter, 3),
  ]

  // Add advice signal from marketAnalysis
  sigs.push({
    type: 'WAIT',
    tier: 99,
    label: 'AI MARKET ANALYSIS',
    note: result.marketAnalysis,
    reasoning: '',
    confidence: 0,
    zone: '---',
    sl: '---',
    tp1: '---',
    tp2: '---',
    rr: '---',
    isAdvice: true,
  })

  return sigs
}
