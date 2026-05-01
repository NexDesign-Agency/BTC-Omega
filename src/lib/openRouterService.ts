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

function klinesToText(klines: any[], label: string, limit = 80): string {
  const data = klines.slice(-limit)
  const lines: string[] = [`## ${label} (${data.length} candles)`]
  lines.push('```')
  lines.push('Time(UTC)            Open      High      Low       Close     Volume')
  lines.push('─'.repeat(70))
  for (const k of data) {
    const time = new Date(k[0]).toISOString().replace('T', ' ').slice(0, 19)
    const o = parseFloat(k[1]).toFixed(1).padStart(9)
    const h = parseFloat(k[2]).toFixed(1).padStart(9)
    const l = parseFloat(k[3]).toFixed(1).padStart(9)
    const c = parseFloat(k[4]).toFixed(1).padStart(9)
    const v = Math.round(parseFloat(k[5])).toString().padStart(8)
    lines.push(`${time} ${o} ${h} ${l} ${c} ${v}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function buildPrompt(currentPrice: number, kd: KlineData): string {
  const h4Text = kd.h4?.length ? klinesToText(kd.h4, 'H4', 50) : '(data H4 tidak tersedia)'
  const h1Text = kd.h1?.length ? klinesToText(kd.h1, 'H1', 60) : '(data H1 tidak tersedia)'
  const m15Text = kd.m15?.length ? klinesToText(kd.m15, 'M15', 80) : '(data M15 tidak tersedia)'
  const m5Text = kd.m5?.length ? klinesToText(kd.m5, 'M5', 80) : '(data M5 tidak tersedia)'

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
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('OpenRouter API error:', res.status, errText)
      throw new Error(`OpenRouter API error ${res.status}: ${errText.slice(0, 200)}`)
    }

    const data = await res.json()
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
