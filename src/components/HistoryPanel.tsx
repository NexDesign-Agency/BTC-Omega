import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, TrendingUp, TrendingDown, Clock, Trash2, X, BarChart3, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import {
  loadHistory, updateOutcome, deleteEntry, clearHistory, calcWinRate,
  HistoryEntry, SignalOutcome, WinRateStats
} from "../lib/historyEngine";

interface Props {
  onClose: () => void;
  refreshTrigger: number;
}

const OUTCOME_OPTS: { value: SignalOutcome; label: string; color: string }[] = [
  { value: "TP1",    label: "TP1 ✓",   color: "text-emerald-400" },
  { value: "TP2",    label: "TP2 ✓✓",  color: "text-bull" },
  { value: "SL",     label: "SL ✗",    color: "text-bear" },
  { value: "MANUAL", label: "Manual",   color: "text-warning" },
  { value: "PENDING",label: "Pending",  color: "text-slate-400" },
];

function outcomeIcon(o: SignalOutcome) {
  if (o === "TP1" || o === "TP2") return <CheckCircle2 size={12} className="text-bull" />;
  if (o === "SL") return <XCircle size={12} className="text-bear" />;
  if (o === "MANUAL") return <MinusCircle size={12} className="text-warning" />;
  return <Clock size={12} className="text-slate-500" />;
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-3 bg-trading-bg rounded-lg border border-trading-border">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-black font-mono text-white leading-none">{value}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function HistoryPanel({ onClose, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<WinRateStats | null>(null);
  const [filterType, setFilterType] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = () => {
    const h = loadHistory();
    setEntries(h);
    setStats(calcWinRate(h));
  };

  useEffect(() => { reload(); }, [refreshTrigger]);

  const handleOutcome = (id: string, outcome: SignalOutcome) => {
    updateOutcome(id, outcome);
    reload();
  };

  const handleDelete = (id: string) => {
    deleteEntry(id);
    reload();
  };

  const handleClear = () => {
    if (confirmClear) { clearHistory(); reload(); setConfirmClear(false); }
    else setConfirmClear(true);
  };

  const filtered = entries.filter(e => filterType === "ALL" || e.type === filterType);
  const winColor = (stats?.winRate ?? 0) >= 60 ? "text-bull" : (stats?.winRate ?? 0) >= 45 ? "text-warning" : "text-bear";

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      className="fixed inset-0 z-[100] flex justify-end"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-trading-panel border-l border-trading-border flex flex-col h-full overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-trading-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-bull/10 rounded-lg border border-bull/20">
              <Trophy size={16} className="text-bull" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-widest uppercase">Signal History</h2>
              <p className="text-[9px] text-slate-500">{entries.length} signals recorded</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Stats */}
        {stats && stats.total > 0 && (
          <div className="p-4 border-b border-trading-border flex-shrink-0">
            <div className="grid grid-cols-4 gap-2 mb-3">
              <StatBox label="Win Rate" value={`${stats.winRate}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
              <StatBox label="TP1" value={`${stats.tp1Rate}%`} />
              <StatBox label="TP2" value={`${stats.tp2Rate}%`} />
              <StatBox label="Avg RR" value={`1:${stats.avgRR}`} />
            </div>
            <div className="relative h-2 bg-trading-bg rounded-full overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${stats.winRate}%` }} transition={{ duration: 0.8 }}
                className={`h-full rounded-full ${stats.winRate >= 60 ? 'bg-bull' : stats.winRate >= 45 ? 'bg-warning' : 'bg-bear'}`} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] text-slate-500">0%</span>
              <span className={`text-[9px] font-black ${winColor}`}>{stats.winRate}% Win Rate</span>
              <span className="text-[8px] text-slate-500">100%</span>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-trading-border flex-shrink-0">
          {(["ALL", "BUY", "SELL"] as const).map(f => (
            <button key={f} onClick={() => setFilterType(f)}
              className={`px-3 py-1 rounded text-[10px] font-black tracking-widest transition-all ${filterType === f ? 'bg-bull/20 text-bull border border-bull/30' : 'text-slate-500 hover:text-slate-300'}`}>
              {f}
            </button>
          ))}
          <button onClick={handleClear}
            className={`ml-auto flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-all ${confirmClear ? 'bg-bear/20 text-bear border border-bear/30' : 'text-slate-600 hover:text-slate-400'}`}>
            <Trash2 size={10} />
            {confirmClear ? "CONFIRM?" : "Clear"}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-slate-600">
              <BarChart3 size={32} className="mb-3 opacity-30" />
              <p className="text-xs font-bold">No signals recorded yet</p>
              <p className="text-[10px] mt-1 opacity-60">Signals ≥75% confidence akan otomatis tercatat</p>
            </div>
          )}
          <AnimatePresence>
            {filtered.map((entry) => {
              const isBuy = entry.type === "BUY";
              const color = entry.outcome === "PENDING" ? (isBuy ? "#00ff88" : "#ff4466") : entry.outcome === "SL" ? "#ff4466" : "#00ff88";
              const ts = new Date(entry.timestamp);
              const timeStr = ts.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + " " + ts.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

              return (
                <motion.div key={entry.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                  className={`rounded-lg border p-3 transition-all ${
                    entry.outcome === "TP1" || entry.outcome === "TP2" 
                    ? "border-bull/40 bg-bull/5 shadow-[0_0_15px_rgba(0,255,136,0.1)]" 
                    : "border-trading-border bg-trading-bg"
                  }`}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      {isBuy ? <TrendingUp size={12} style={{ color }} /> : <TrendingDown size={12} style={{ color }} />}
                      <span className="text-xs font-black" style={{ color }}>{entry.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-white/5 rounded font-mono text-slate-400">T{entry.tier}</span>
                      <span className="text-[9px] font-bold text-slate-400">{entry.confidence}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(entry.outcome === "TP1" || entry.outcome === "TP2") && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-1 px-1.5 py-0.5 bg-bull/20 rounded-full border border-bull/30">
                          <Trophy size={10} className="text-bull" />
                          <span className="text-[8px] font-black text-bull uppercase">Champion</span>
                        </motion.div>
                      )}
                      <span className="text-[9px] text-slate-600 font-mono">{timeStr}</span>
                      <button onClick={() => handleDelete(entry.id)} className="p-0.5 hover:text-bear transition-colors text-slate-700">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1 mb-2 text-[9px] font-mono">
                    <div><p className="text-slate-600 mb-0.5">Entry</p><p className="text-white font-bold">{entry.zone}</p></div>
                    <div><p className="text-bear/70 mb-0.5">SL</p><p className="text-bear font-bold">{entry.sl}</p></div>
                    <div><p className="mb-0.5" style={{ color, opacity: 0.7 }}>TP1</p><p style={{ color }}>{entry.tp1}</p></div>
                    <div className="relative">
                      <p className="mb-0.5" style={{ color, opacity: 0.7 }}>TP2</p>
                      <p className="font-black" style={{ color }}>{entry.tp2}</p>
                      {entry.pnlPips !== undefined && (
                        <div className="absolute -top-1 -right-2 bg-bull/20 text-bull px-1 rounded border border-bull/30 text-[8px]">
                          {entry.pnlPips > 0 ? "+" : ""}{Math.round(entry.pnlPips)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] text-slate-600 mr-1">Outcome:</span>
                      {OUTCOME_OPTS.map(opt => (
                        <button key={opt.value} onClick={() => handleOutcome(entry.id, opt.value)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-all border ${entry.outcome === opt.value ? 'bg-white/10 border-white/20 ' + opt.color : 'border-transparent text-slate-600 hover:text-slate-400'}`}>
                          {outcomeIcon(opt.value)}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {entry.outcome === "PENDING" && (
                      <div className="flex items-center gap-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-bull opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-bull"></span>
                        </span>
                        <span className="text-[8px] font-black text-bull uppercase tracking-tighter">Live Tracking</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
