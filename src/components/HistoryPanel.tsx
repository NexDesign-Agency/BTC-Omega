import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Trophy, TrendingUp, TrendingDown, Clock, Trash2, X, CheckCircle2, XCircle, MinusCircle } from "lucide-react"
import {
  loadHistory, updateOutcome, deleteEntry, clearHistory, calcWinRate,
  HistoryEntry, SignalOutcome, WinRateStats
} from "../lib/historyEngine"

interface Props {
  onClose: () => void
  refreshTrigger: number
}

const OUTCOME_OPTS: { value: SignalOutcome; label: string }[] = [
  { value: "TP1", label: "TP1" },
  { value: "TP2", label: "TP2" },
  { value: "SL", label: "SL" },
  { value: "MANUAL", label: "BE" },
  { value: "PENDING", label: "?" },
]

const outcomeStyle = (o: SignalOutcome) => {
  if (o === "TP1") return "bg-emerald-400/15 text-emerald-400 border-emerald-400/30"
  if (o === "TP2") return "bg-bull/15 text-bull border-bull/30"
  if (o === "SL") return "bg-bear/15 text-bear border-bear/30"
  if (o === "MANUAL") return "bg-warning/15 text-warning border-warning/30"
  return "bg-slate-700/50 text-slate-400 border-slate-700"
}

const outcomeIcon = (o: SignalOutcome, s = 10) => {
  if (o === "TP1" || o === "TP2") return <CheckCircle2 size={s} className="text-bull" />
  if (o === "SL") return <XCircle size={s} className="text-bear" />
  if (o === "MANUAL") return <MinusCircle size={s} className="text-warning" />
  return <Clock size={s} className="text-slate-500" />
}

type SortKey = "NEWEST" | "OLDEST" | "BUY" | "SELL" | "WIN" | "LOSS"

export default function HistoryPanel({ onClose, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState<WinRateStats | null>(null)
  const [filterType, setFilterType] = useState<"ALL" | "BUY" | "SELL" | "WIN" | "LOSS" | "PENDING">("ALL")
  const [confirmClear, setConfirmClear] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("NEWEST")
  const [expandedOutcome, setExpandedOutcome] = useState<string | null>(null)

  const reload = () => {
    const h = loadHistory()
    setEntries(h)
    setStats(calcWinRate(h))
  }

  useEffect(() => { reload() }, [refreshTrigger])

  const handleOutcome = (id: string, outcome: SignalOutcome) => {
    updateOutcome(id, outcome)
    setExpandedOutcome(null)
    reload()
  }

  const handleDelete = (id: string) => {
    deleteEntry(id)
    reload()
  }

  const handleClear = () => {
    if (confirmClear) { clearHistory(); reload(); setConfirmClear(false) }
    else setConfirmClear(true)
  }

  let filtered = entries.filter(e => {
    if (filterType === "BUY") return e.type === "BUY"
    if (filterType === "SELL") return e.type === "SELL"
    if (filterType === "WIN") return e.outcome === "TP1" || e.outcome === "TP2"
    if (filterType === "LOSS") return e.outcome === "SL"
    if (filterType === "PENDING") return e.outcome === "PENDING"
    return true
  })

  if (sortKey === "NEWEST") filtered = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
  if (sortKey === "OLDEST") filtered = [...filtered].sort((a, b) => a.timestamp - b.timestamp)
  if (sortKey === "BUY") filtered = [...filtered].filter(e => e.type === "BUY")
  if (sortKey === "SELL") filtered = [...filtered].filter(e => e.type === "SELL")
  if (sortKey === "WIN") filtered = [...filtered].filter(e => e.outcome === "TP1" || e.outcome === "TP2")
  if (sortKey === "LOSS") filtered = [...filtered].filter(e => e.outcome === "SL")

  const winColor = (stats?.winRate ?? 0) >= 55 ? "text-bull" : (stats?.winRate ?? 0) >= 40 ? "text-warning" : "text-bear"

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      className="fixed inset-0 z-[100] flex justify-end"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-trading-panel border-l border-trading-border flex flex-col h-full overflow-hidden shadow-2xl">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-trading-border flex-shrink-0 bg-black/20">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-bull/10 rounded border border-bull/20">
              <Trophy size={14} className="text-bull" />
            </div>
            <div>
              <h2 className="text-xs font-black text-white tracking-widest uppercase">Signal History</h2>
              <p className="text-[9px] text-slate-500">{entries.length} entries</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded transition-colors">
            <X size={14} className="text-slate-400" />
          </button>
        </div>

        {/* ── Summary Stats ──────────────────────────────── */}
        {stats && stats.total > 0 && (
          <div className="px-4 py-3 border-b border-trading-border flex-shrink-0 space-y-2">
            <div className="grid grid-cols-5 gap-1.5 text-center">
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Total</p>
                <p className="text-xs font-black text-white">{stats.total}</p>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Win</p>
                <p className="text-xs font-black text-bull">{stats.wins}</p>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Loss</p>
                <p className="text-xs font-black text-bear">{stats.losses}</p>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Pend</p>
                <p className="text-xs font-black text-slate-400">{stats.pending}</p>
              </div>
              <div>
                <p className="text-[9px] text-slate-500 uppercase tracking-wide">Rate</p>
                <p className={`text-xs font-black ${winColor}`}>{stats.winRate}%</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="flex h-1.5 rounded-full overflow-hidden bg-trading-bg">
              <div style={{ width: `${stats.tp1Rate || 0}%` }} className="bg-emerald-400" />
              <div style={{ width: `${stats.tp2Rate || 0}%` }} className="bg-bull" />
              <div style={{ width: `${stats.slRate || 0}%` }} className="bg-bear" />
              <div style={{ flex: 1 }} className="bg-slate-800" />
            </div>
            <div className="flex gap-2 text-[8px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-emerald-400" />TP1 {stats.tp1Rate}%</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-bull" />TP2 {stats.tp2Rate}%</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-bear" />SL {stats.slRate}%</span>
              <span className="ml-auto">RR {stats.avgRR}</span>
            </div>
          </div>
        )}

        {/* ── Filters ────────────────────────────────────── */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-trading-border flex-shrink-0 overflow-x-auto no-scrollbar">
          {(["ALL", "BUY", "SELL", "WIN", "LOSS", "PENDING"] as const).map(f => (
            <button key={f} onClick={() => setFilterType(f)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wide transition-all flex-shrink-0 ${filterType === f ? 'bg-accent/20 text-accent border border-accent/30' : 'text-slate-500 hover:text-slate-300'}`}>
              {f}
            </button>
          ))}
          <div className="w-px h-3 bg-trading-border mx-1 flex-shrink-0" />
          {(["NEWEST", "OLDEST"] as const).map(k => (
            <button key={k} onClick={() => setSortKey(k)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wide transition-all flex-shrink-0 ${sortKey === k ? 'bg-white/10 text-white border border-white/20' : 'text-slate-500 hover:text-slate-300'}`}>
              {k === "NEWEST" ? "↓ New" : "↑ Old"}
            </button>
          ))}
          <button onClick={handleClear}
            className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-all flex-shrink-0 ${confirmClear ? 'bg-bear/20 text-bear border border-bear/30' : 'text-slate-600 hover:text-slate-400'}`}>
            <Trash2 size={10} />
            {confirmClear ? "CONFIRM?" : "Clear"}
          </button>
        </div>

        {/* ── Signal List ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
              <Trophy size={24} className="opacity-20" />
              <p className="text-xs font-bold">No signals</p>
              <p className="text-[9px] opacity-50">
                {filterType !== "ALL" ? "No matching signals for this filter" : "Signals akan muncul setelah entry ter-trigger"}
              </p>
            </div>
          )}
          <AnimatePresence>
            {filtered.map((entry) => {
              const isBuy = entry.type === "BUY"
              const ts = new Date(entry.timestamp)
              const dateStr = ts.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
              const timeStr = ts.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
              const expanding = expandedOutcome === entry.id

              return (
                <motion.div key={entry.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-b border-trading-border last:border-b-0"
                >
                  {/* Main row */}
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors">
                    {/* Direction + entry */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className={`flex-shrink-0 ${isBuy ? "text-bull" : "text-bear"}`}>
                        {isBuy ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      </span>
                      <span className={`text-[10px] font-black font-mono ${isBuy ? "text-bull" : "text-bear"}`}>
                        {entry.zone}
                      </span>
                      <span className="text-[8px] text-slate-600 font-mono flex-shrink-0">T{entry.tier}</span>
                      <span className="text-[8px] text-slate-500 flex-shrink-0 ml-auto">{entry.confidence}%</span>
                    </div>

                    {/* Outcome badge */}
                    <button
                      onClick={() => setExpandedOutcome(expanding ? null : entry.id)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${outcomeStyle(entry.outcome)}`}
                    >
                      {outcomeIcon(entry.outcome, 9)}
                      <span>{entry.outcome === "MANUAL" ? "BE" : entry.outcome}</span>
                    </button>

                    {/* Delete */}
                    <button onClick={() => handleDelete(entry.id)} className="p-0.5 text-slate-700 hover:text-bear transition-colors flex-shrink-0">
                      <Trash2 size={9} />
                    </button>
                  </div>

                  {/* Detail + outcome selector (expand) */}
                  <AnimatePresence>
                    {expanding && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-2.5 space-y-2">
                          {/* Date + SL/TP info */}
                          <div className="flex items-center justify-between text-[9px] text-slate-500">
                            <span>{dateStr} {timeStr}</span>
                            <div className="flex gap-3 font-mono">
                              <span>SL <span className="text-bear">{entry.sl}</span></span>
                              <span>TP1 <span className={isBuy ? "text-emerald-400" : "text-bear"}>{entry.tp1}</span></span>
                              <span>TP2 <span className={isBuy ? "text-bull" : "text-bear"}>{entry.tp2}</span></span>
                            </div>
                          </div>

                          {/* PnL if available */}
                          {entry.pnlPips !== undefined && entry.pnlPips !== 0 && (
                            <div className={`text-[9px] font-bold ${entry.pnlPips > 0 ? "text-bull" : "text-bear"}`}>
                              PnL: {entry.pnlPips > 0 ? "+" : ""}{Math.round(entry.pnlPips)} pips
                            </div>
                          )}

                          {/* Outcome buttons */}
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[9px] text-slate-600 mr-1">Mark:</span>
                            {OUTCOME_OPTS.map(opt => (
                              <button key={opt.value} onClick={() => handleOutcome(entry.id, opt.value)}
                                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${entry.outcome === opt.value ? outcomeStyle(opt.value) : "border-transparent text-slate-600 hover:text-slate-400 hover:border-slate-700"}`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}