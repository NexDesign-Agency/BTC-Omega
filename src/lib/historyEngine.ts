// historyEngine.ts — Signal History & Win Rate Tracker for Omega BTC
// Stores signals to localStorage, tracks outcomes (TP1/TP2/SL/Manual Close)

export type SignalOutcome = "TP1" | "TP2" | "SL" | "MANUAL" | "PENDING";

export interface HistoryEntry {
  id: string;
  timestamp: number;        // Unix ms
  type: "BUY" | "SELL";
  tier: number;
  confidence: number;
  label: string;
  zone: string;
  sl: string;
  tp1: string;
  tp2: string;
  rr: string;
  outcome: SignalOutcome;
  pnlPips?: number;         // filled after close
  note?: string;
}

const STORAGE_KEY = "omega_signal_history";
const MAX_ENTRIES = 200;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (e) {
    console.warn("History save failed:", e);
  }
}

export function addSignalToHistory(signal: Omit<HistoryEntry, "id" | "timestamp" | "outcome">): { id: string, isDupe: boolean } {
  const timestamp = Date.now();
  const id = `omega_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
  const entry: HistoryEntry = {
    ...signal,
    id,
    timestamp,
    outcome: "PENDING",
  };

  const existing = loadHistory();
  // Avoid duplicate if same type+zone within 10 minutes
  const tenMin = 10 * 60 * 1000;
  const dupe = existing.find(
    e => e.type === entry.type && e.zone === entry.zone && (timestamp - e.timestamp) < tenMin
  );

  if (!dupe) {
    saveHistory([entry, ...existing]);
    return { id, isDupe: false };
  }
  return { id: dupe.id, isDupe: true };
}

export function updateOutcome(id: string, outcome: SignalOutcome, pnlPips?: number, note?: string): void {
  const entries = loadHistory();
  const idx = entries.findIndex(e => e.id === id);
  if (idx !== -1) {
    entries[idx].outcome = outcome;
    if (pnlPips !== undefined) entries[idx].pnlPips = pnlPips;
    if (note) entries[idx].note = note;
    saveHistory(entries);
  }
}

export function deleteEntry(id: string): void {
  const entries = loadHistory().filter(e => e.id !== id);
  saveHistory(entries);
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Win rate stats calculation
export interface WinRateStats {
  total: number;
  wins: number;       // TP1 or TP2
  losses: number;     // SL
  pending: number;
  winRate: number;    // percentage
  tp1Rate: number;
  tp2Rate: number;
  slRate: number;
  avgRR: number;
  byTier: Record<number, { total: number; wins: number; winRate: number }>;
}

export function calcWinRate(entries: HistoryEntry[]): WinRateStats {
  const closed = entries.filter(e => e.outcome !== "PENDING");
  const wins = closed.filter(e => e.outcome === "TP1" || e.outcome === "TP2").length;
  const losses = closed.filter(e => e.outcome === "SL").length;
  const tp1 = closed.filter(e => e.outcome === "TP1").length;
  const tp2 = closed.filter(e => e.outcome === "TP2").length;
  const total = closed.length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const tp1Rate = total > 0 ? Math.round((tp1 / total) * 100) : 0;
  const tp2Rate = total > 0 ? Math.round((tp2 / total) * 100) : 0;
  const slRate = total > 0 ? Math.round((losses / total) * 100) : 0;

  // Avg RR from rr string e.g. "1:1.5"
  const rrNums = closed.filter(e => e.rr && e.rr !== "---").map(e => parseFloat(e.rr.split(":")[1] || "1"));
  const avgRR = rrNums.length > 0 ? parseFloat((rrNums.reduce((a, b) => a + b, 0) / rrNums.length).toFixed(2)) : 0;

  // By tier
  const byTier: Record<number, { total: number; wins: number; winRate: number }> = {};
  for (const e of closed) {
    if (!byTier[e.tier]) byTier[e.tier] = { total: 0, wins: 0, winRate: 0 };
    byTier[e.tier].total++;
    if (e.outcome === "TP1" || e.outcome === "TP2") byTier[e.tier].wins++;
  }
  for (const t of Object.keys(byTier)) {
    const tier = byTier[Number(t)];
    tier.winRate = tier.total > 0 ? Math.round((tier.wins / tier.total) * 100) : 0;
  }

  return { total, wins, losses, pending: entries.filter(e => e.outcome === "PENDING").length, winRate, tp1Rate, tp2Rate, slRate, avgRR, byTier };
}
