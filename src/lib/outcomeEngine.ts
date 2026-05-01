import { HistoryEntry, SignalOutcome, updateOutcome } from './historyEngine';

/**
 * Memeriksa apakah harga menyentuh zona Entry
 */
export function checkEntryTrigger(currentPrice: number, suggestions: any[]): any[] {
  const triggered: any[] = [];
  for (const s of suggestions) {
    const entry = parseFloat(s.zone);
    const isBuy = s.type === "BUY";
    const threshold = entry * 0.001; // 0.1% tolerance

    if (isBuy) {
      if (currentPrice <= entry + threshold && currentPrice >= entry - threshold * 2) {
        triggered.push(s);
      }
    } else {
      if (currentPrice >= entry - threshold && currentPrice <= entry + threshold * 2) {
        triggered.push(s);
      }
    }
  }
  return triggered;
}

/**
 * Outcome Engine v1.0
 * Membandingkan harga saat ini dengan signal yang berstatus PENDING.
 * Menghasilkan daftar update untuk disimpan ke history.
 */
export function checkSignalOutcomes(currentPrice: number, history: HistoryEntry[]): { id: string, outcome: SignalOutcome, pnl: number }[] {
  const updates: { id: string, outcome: SignalOutcome, pnl: number }[] = [];
  
  // Hanya cek yang masih PENDING
  const pendingSignals = history.filter(s => s.outcome === "PENDING");
  
  for (const sig of pendingSignals) {
    const entry = parseFloat(sig.zone);
    const sl = parseFloat(sig.sl);
    const tp1 = parseFloat(sig.tp1);
    const tp2 = parseFloat(sig.tp2);
    const isBuy = sig.type === "BUY";

    if (isNaN(entry) || isNaN(sl) || isNaN(tp1)) continue;

    let hit: SignalOutcome | null = null;
    let pnl = 0;

    if (isBuy) {
      if (currentPrice >= tp2) {
        hit = "TP2";
        pnl = tp2 - entry;
      } else if (currentPrice >= tp1) {
        hit = "TP1";
        pnl = tp1 - entry;
      } else if (currentPrice <= sl) {
        hit = "SL";
        pnl = sl - entry;
      }
    } else {
      // SELL logic
      if (currentPrice <= tp2) {
        hit = "TP2";
        pnl = entry - tp2;
      } else if (currentPrice <= tp1) {
        hit = "TP1";
        pnl = entry - tp1;
      } else if (currentPrice >= sl) {
        hit = "SL";
        pnl = entry - sl;
      }
    }

    if (hit) {
      updates.push({ id: sig.id, outcome: hit, pnl });
      // Langsung update di localStorage
      updateOutcome(sig.id, hit, pnl);
    }
  }

  return updates;
}
