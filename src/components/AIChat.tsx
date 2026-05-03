import { useState, useRef, useEffect } from 'react'
import { Send, Bot, RefreshCw } from 'lucide-react'
import { BTC_ANALYST_SYSTEM_PROMPT, QUICK_ACTIONS } from '../constants'
import { AIAnalysisResult, createOpenRouterChatCompletion } from '../lib/openRouterService'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface MarketSnapshot {
  price: number
  session?: { label: string }
  tfDirections?: Record<string, { direction: string; strength: number }>
  signal?: {
    type: string; tier: number; confidence: number
    zone: string; sl: string; tp1: string; tp2: string; rr: string
  }
  suggestions?: Array<{
    type: string; tier: number; label: string
    zone: string; sl: string; tp1: string; tp2: string
    rr: string; confidence: number; note: string; reasoning: string
    isAdvice?: boolean; isSkip?: boolean
  }>
  aiAnalysis?: AIAnalysisResult | null
}

interface Props {
  apiKey: string
  model: string
  marketData?: MarketSnapshot | null
}

// ── Build real-time market context string ─────────────────────────────
function buildMarketContext(data: MarketSnapshot): string {
  const price = data.price
  if (!price) return ''

  const fmt = (n: string | number) => {
    const num = typeof n === 'string' ? parseFloat(n) : n
    return isNaN(num) ? String(n) : num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  }

  const dirIcon = (d: string) => d === 'UP' ? '▲ BULLISH' : d === 'DOWN' ? '▼ BEARISH' : '◆ SIDEWAYS'

  const lines: string[] = []
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('⚡ REAL-TIME MARKET DATA (diperbarui otomatis)')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push(`💰 HARGA BTC SEKARANG : $${fmt(price)}`)
  if (data.session?.label) {
    lines.push(`⏰ SESI TRADING       : ${data.session.label}`)
  }
  lines.push('')

  // TF Directions — prefer aiAnalysis.tfDirections, fallback to analysis.tfDirections
  const tfDirs = data.aiAnalysis?.tfDirections ?? data.tfDirections
  if (tfDirs && Object.keys(tfDirs).length > 0) {
    lines.push('📊 MULTI-TIMEFRAME BIAS:')
    for (const [tf, d] of Object.entries(tfDirs)) {
      const dir = typeof d === 'object' ? (d as any).direction : d
      const str = typeof d === 'object' ? (d as any).strength : 0
      lines.push(`  ${tf.padEnd(4)}: ${dirIcon(dir)}${str ? ` (${str}%)` : ''}`)
    }
    lines.push('')
  }

  // Signal Cards from aiAnalysis (most accurate — based on actual OHLCV)
  if (data.aiAnalysis) {
    const ai = data.aiAnalysis
    const renderCard = (card: any, label: string) => {
      if (!card || card.type === 'WAIT' || card.entry === '---') return
      const arrow = card.type === 'BUY' ? '📈' : '📉'
      lines.push(`${arrow} [${label}] ${card.label}`)
      lines.push(`   Entry : $${fmt(card.entry)} | SL: $${fmt(card.sl)}`)
      lines.push(`   TP1   : $${fmt(card.tp1)} | TP2: $${fmt(card.tp2)} | RR: ${card.rr}`)
      lines.push(`   Conf  : ${card.confidence}%`)
      if (card.note) lines.push(`   Note  : ${card.note}`)
      if (card.reasoning) lines.push(`   Basis : ${card.reasoning}`)
      lines.push('')
    }
    lines.push('🎯 SIGNAL AKTIF (AI-POWERED dari OHLCV nyata):')
    renderCard(ai.primaryEntry, 'PRIMARY SWING')
    renderCard(ai.scalpTrend, 'SCALP SEARAH')
    renderCard(ai.scalpCounter, 'SCALP COUNTER')

    if (ai.marketAnalysis) {
      lines.push('🧠 AI MARKET ANALYSIS TERKINI:')
      lines.push(ai.marketAnalysis)
      lines.push('')
    }
  } else if (data.suggestions) {
    // Fallback: pakai offline signal engine data
    const activeSigs = data.suggestions.filter(s => s.type !== 'WAIT' && !s.isAdvice && !s.isSkip)
    if (activeSigs.length > 0) {
      lines.push('🎯 SIGNAL AKTIF (offline engine):')
      for (const s of activeSigs) {
        const arrow = s.type === 'BUY' ? '📈' : '📉'
        const tierLabel = s.tier === 1 ? 'PRIMARY' : s.tier === 2 ? 'SCALP SEARAH' : 'SCALP COUNTER'
        lines.push(`${arrow} [${tierLabel}] ${s.label}`)
        lines.push(`   Entry: $${fmt(s.zone)} | SL: $${fmt(s.sl)} | TP1: $${fmt(s.tp1)} | TP2: $${fmt(s.tp2)} | RR: ${s.rr}`)
        lines.push(`   Conf: ${s.confidence}% | ${s.note}`)
        if (s.reasoning) lines.push(`   Basis: ${s.reasoning}`)
        lines.push('')
      }
    }
    const advice = data.suggestions.find(s => s.isAdvice)
    if (advice?.note) {
      lines.push('🧠 MARKET OVERVIEW:')
      lines.push(advice.note)
      lines.push('')
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('PENTING: Gunakan data di atas sebagai basis SEMUA analisa kamu.')
  lines.push('Jangan pernah mengarang harga atau level yang tidak ada di data ini.')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  return lines.join('\n')
}

export default function AIChat({ apiKey, model, marketData }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('omega_chat_messages')
    if (saved) {
      try { return JSON.parse(saved) } catch { /* ignore */ }
    }
    return []
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('omega_chat_messages', JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim()
    if (!content || loading) return
    if (!apiKey) return

    setInput('')
    const userMsg: Message = { role: 'user', content }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)

    setLoading(true)
    try {
      // Build system messages — inject real-time market data EVERY request
      const systemMessages: Message[] = [
        { role: 'system', content: BTC_ANALYST_SYSTEM_PROMPT },
      ]

      if (marketData?.price) {
        systemMessages.push({
          role: 'system',
          content: buildMarketContext(marketData),
        })
      }

      const { data, usedFallback, usedModel } = await createOpenRouterChatCompletion({
        apiKey,
        model,
        messages: [
          ...systemMessages,
          ...newMessages,
        ],
        temperature: 0.7,
        max_tokens: 2048,
      })
      const reply = data?.choices?.[0]?.message?.content

      if (reply) {
        setMessages(prev => [
          ...prev,
          ...(usedFallback
            ? [{
                role: 'assistant' as const,
                content: `Info: saldo model berbayar habis, otomatis pindah ke model free (${usedModel}).`,
              }]
            : []),
          { role: 'assistant', content: reply },
        ])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, AI tidak memberikan respon.' }])
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message || 'Gagal menghubungi AI'}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    setMessages([])
    localStorage.removeItem('omega_chat_messages')
  }

  const hasLiveData = !!(marketData?.price)

  return (
    <div className="h-full w-full flex flex-col bg-trading-panel min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-trading-border flex items-center justify-between bg-black/20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-accent" />
          <span className="text-[10px] font-black tracking-widest uppercase opacity-70">AI LIVE CHAT</span>
          {hasLiveData && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bull/10 border border-bull/20">
              <span className="w-1 h-1 rounded-full bg-bull animate-pulse" />
              <span className="text-[7px] font-black text-bull">LIVE DATA</span>
            </span>
          )}
        </div>
        <button
          onClick={clearChat}
          className="text-[8px] font-bold text-slate-500 hover:text-bear px-1.5 py-0.5 rounded border border-trading-border hover:border-bear/30 transition-colors"
        >
          CLEAR
        </button>
      </div>

      {/* Price ticker bar */}
      {hasLiveData && (
        <div className="px-3 py-1 border-b border-trading-border bg-bull/5 flex items-center gap-3 flex-shrink-0">
          <span className="text-[9px] font-black text-bull font-mono">
            BTC ${marketData!.price.toLocaleString()}
          </span>
          {marketData?.session?.label && (
            <span className="text-[8px] text-slate-500">• {marketData.session.label}</span>
          )}
          {marketData?.aiAnalysis && (
            <span className="text-[8px] text-accent ml-auto">⚡ AI data ready</span>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="px-2 py-1.5 border-b border-trading-border flex items-center gap-1 overflow-x-auto no-scrollbar flex-shrink-0">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => sendMessage(action.prompt)}
            disabled={loading || !apiKey}
            className="flex-shrink-0 px-2 py-1 rounded border border-trading-border bg-white/5 hover:bg-accent/10 hover:border-accent/30 text-[8px] font-bold text-slate-400 hover:text-accent transition-all disabled:opacity-40"
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 py-2 space-y-3">
        {!apiKey && (
          <div className="text-[10px] text-slate-500 text-center py-8">
            Setup AI di tombol <span className="text-accent font-bold">AI SETUP</span> untuk mulai chat.
          </div>
        )}
        {apiKey && messages.length === 0 && (
          <div className="text-[10px] text-slate-500 text-center py-8 space-y-2">
            <Bot size={24} className="mx-auto text-slate-600" />
            <p>AI Chat siap{hasLiveData ? ' dengan data market live' : ''}.</p>
            <p className="text-slate-600">Gunakan quick action atau ketik pertanyaan.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-accent/20 border border-accent/30 text-slate-200'
                : 'bg-white/5 border border-trading-border text-slate-300'
            }`}>
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1 mb-1 opacity-50">
                  <Bot size={10} />
                  <span className="text-[7px] font-bold uppercase tracking-widest">AI</span>
                </div>
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-trading-border rounded-lg px-2.5 py-1.5 flex items-center gap-2">
              <RefreshCw size={10} className="animate-spin text-accent" />
              <span className="text-[9px] text-slate-500">Mengetik...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-2 py-2 border-t border-trading-border bg-black/10 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? 'Ketik pesan...' : 'Setup API key dulu...'}
            disabled={!apiKey || loading}
            className="flex-1 bg-trading-bg border border-trading-border rounded-md px-2.5 py-1.5 text-[10px] text-slate-200 placeholder-slate-600 outline-none focus:border-accent/40 transition-colors disabled:opacity-40"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading || !apiKey}
            className="p-1.5 rounded-md bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
