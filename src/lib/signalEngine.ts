// Signal Engine v2.1 — Pure Price Action & Structure (Robust Version)
// Logic: Breakouts (Trendline) + Rejections (Horizontal) + Pattern Compression

import { analyzeMarketStructure } from './levelEngine';

export interface SignalResult {
  type: "BUY" | "SELL" | "WAIT";
  tier: number;
  label: string;
  note: string;
  reasoning: string;
  confidence: number;
  zone: string;
  sl: string;
  tp1: string;
  tp2: string;
  rr: string;
  isSkip?: boolean;
  isAdvice?: boolean;
}

// Default Fallback Signal
const DEFAULT_SIGNAL: SignalResult = {
  type: "WAIT", tier: 0, label: "ANALYZING...",
  note: "Menunggu data pasar...",
  reasoning: "Sistem sedang memproses struktur market M15/H1.",
  confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---",
  isAdvice: true
};

function checkRejection(candle: any, type: "RES" | "SUP"): boolean {
  if (!candle || !Array.isArray(candle)) return false;
  const high = parseFloat(candle[2]);
  const low = parseFloat(candle[3]);
  const open = parseFloat(candle[1]);
  const close = parseFloat(candle[4]);
  if (isNaN(high) || isNaN(low)) return false;

  const bodySize = Math.abs(open - close);
  if (type === "RES") {
    const upperWick = high - Math.max(open, close);
    return upperWick > bodySize * 1.5;
  } else {
    const lowerWick = Math.min(open, close) - low;
    return lowerWick > bodySize * 1.5;
  }
}

export function computeSignals(currentPrice: number, h1Klines: any[], m15Klines: any[]): SignalResult[] {
  const suggestions: SignalResult[] = [];
  
  if (!m15Klines || m15Klines.length < 50 || !h1Klines || h1Klines.length < 20) return [DEFAULT_SIGNAL];

  const structure = analyzeMarketStructure(m15Klines, currentPrice);
  const lastCandle = m15Klines[m15Klines.length - 1];
  
  // Deteksi Lokal Tren dari H1 (20 candle terakhir = ~1 hari)
  const h1Recent = h1Klines.slice(-20);
  const h1Highs = h1Recent.map(k => parseFloat(k[2]));
  const h1Lows = h1Recent.map(k => parseFloat(k[3]));
  const h1Highest = Math.max(...h1Highs);
  const h1Lowest = Math.min(...h1Lows);
  const h1Mid = (h1Highest + h1Lowest) / 2;
  
  const localTrend: "UP" | "DOWN" | "SIDEWAYS" = currentPrice > h1Mid * 1.002 ? "UP" : currentPrice < h1Mid * 0.998 ? "DOWN" : "SIDEWAYS";

  // 1. PRIMARY ENTRY (Tier 1) - Extreme H1 Levels or Explosive Breakout
  let primaryAdded = false;
  
  // Cek Breakout dulu (Hanya jika benar-benar baru terjadi / FRESH Breakout)
  if (structure.pattern && structure.pattern.type !== "NONE" && structure.pattern.upperLine && structure.pattern.lowerLine) {
    const upper = structure.pattern.upperLine;
    const lower = structure.pattern.lowerLine;
    
    if (structure.pattern.compressionPct > 20) {
      const distUpper = (Math.abs(currentPrice - upper.currentValue) / currentPrice) * 100;
      const distLower = (Math.abs(currentPrice - lower.currentValue) / currentPrice) * 100;

      // Harus fresh breakout (harga tidak boleh lari terlalu jauh, maks 0.15% dari garis)
      if (currentPrice > upper.currentValue && distUpper < 0.15) {
        const slDist = currentPrice * 0.002; // 0.2% SL
        suggestions.push({
          type: "BUY", tier: 1, label: `EXPLOSIVE ${structure.pattern.type} BREAKOUT`,
          note: "Breakout Atas terkonfirmasi! Eksekusi Market.",
          reasoning: `Harga memotong garis tren diagonal di ${Math.round(upper.currentValue)}. Compression: ${structure.pattern.compressionPct.toFixed(0)}%.`,
          confidence: 88, zone: currentPrice.toFixed(1),
          sl: (currentPrice - slDist).toFixed(1),
          tp1: (currentPrice + slDist * 2).toFixed(1),
          tp2: (currentPrice + slDist * 4).toFixed(1),
          rr: "1:4.0",
          dist: distUpper
        });
        primaryAdded = true;
      } else if (currentPrice < lower.currentValue && distLower < 0.15) {
        const slDist = currentPrice * 0.002;
        suggestions.push({
          type: "SELL", tier: 1, label: `EXPLOSIVE ${structure.pattern.type} BREAKOUT`,
          note: "Breakout Bawah terkonfirmasi! Eksekusi Market.",
          reasoning: `Harga memotong garis tren diagonal di ${Math.round(lower.currentValue)}. Compression: ${structure.pattern.compressionPct.toFixed(0)}%.`,
          confidence: 88, zone: currentPrice.toFixed(1),
          sl: (currentPrice + slDist).toFixed(1),
          tp1: (currentPrice - slDist * 2).toFixed(1),
          tp2: (currentPrice - slDist * 4).toFixed(1),
          rr: "1:4.0",
          dist: distLower
        });
        primaryAdded = true;
      }
    }
  }

  // Jika tidak ada breakout, buat Primary Entry berbasis Swing Limit di ekstrem
  if (!primaryAdded) {
    const type = localTrend === "DOWN" ? "BUY" : "SELL"; // Swing melawan ekstrem
    const entry = type === "BUY" ? h1Lowest : h1Highest;
    const slDist = entry * 0.003; // 0.3% SL untuk swing
    suggestions.push({
      type: type, tier: 1, label: `PRIMARY SWING LIMIT @ ${Math.round(entry)}`,
      note: "Posisi swing utama. Pasang jaring di ekstrem struktur H1.",
      reasoning: `Harga ekstrem H1 (${localTrend} trend). Reversal probabilitas tinggi.`,
      confidence: 90, zone: entry.toFixed(1),
      sl: (type === "BUY" ? entry - slDist : entry + slDist).toFixed(1),
      tp1: (type === "BUY" ? entry + slDist * 3 : entry - slDist * 3).toFixed(1),
      tp2: (type === "BUY" ? entry + slDist * 6 : entry - slDist * 6).toFixed(1),
      rr: "1:6.0",
      dist: 0 // Priority
    });
  }

  // 2. SCALP LOGIC (Tier 2: Searah, Tier 3: Counter)
  if (structure.levels) {
    structure.levels.forEach(lvl => {
      const exactEntry = lvl.price;
      const distPct = (Math.abs(currentPrice - exactEntry) / currentPrice) * 100;
      
      // Hanya masukkan ke suggestion jika jaraknya masuk akal untuk dipantau (misal < 0.4%)
      if (distPct < 0.4) {
        const type = lvl.type === "SUPPORT" ? "BUY" : "SELL";
        
        let tier = 3; // Default Counter
        if (localTrend === "UP" && type === "BUY") tier = 2; // Buy support di uptrend
        if (localTrend === "DOWN" && type === "SELL") tier = 2; // Sell resistance di downtrend
        if (localTrend === "SIDEWAYS") tier = 2; // Sideways = bebas scalp atas bawah

        const slDist = exactEntry * 0.0015; // Sangat ketat (0.15%)
        
        const sl = type === "BUY" ? exactEntry - slDist : exactEntry + slDist;
        const tp1 = type === "BUY" ? exactEntry + slDist * 2 : exactEntry - slDist * 2;
        const tp2 = type === "BUY" ? exactEntry + slDist * 3 : exactEntry - slDist * 3;

        const isReject = checkRejection(lastCandle, lvl.type === "SUPPORT" ? "SUP" : "RES");

        suggestions.push({
          type: type,
          tier: tier,
          label: `LIMIT SCALP @ ${Math.round(exactEntry)}`,
          note: isReject && distPct <= 0.2 ? "Rejection terlihat. Jaring sekarang!" : "Pasang Limit Order di S/R.",
          reasoning: `Pantulan ${tier === 2 ? 'searah' : 'counter'} tren. Jarak: ${distPct.toFixed(2)}%.`,
          confidence: distPct <= 0.2 ? (isReject ? 85 : 75) : 60, // Confidence turun jika jauh
          zone: exactEntry.toFixed(1),
          sl: sl.toFixed(1),
          tp1: tp1.toFixed(1),
          tp2: tp2.toFixed(1),
          rr: "1:3.0",
          dist: distPct
        });
      }
    });
  }

  if (suggestions.length === 0) suggestions.push(DEFAULT_SIGNAL);
  
  // Sort by distance first so the closest level is picked, then by tier
  return suggestions.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return (a as any).dist - (b as any).dist;
  });
}

export function computeSignal(currentPrice: number, h1Klines: any[], m15Klines: any[]): SignalResult {
  const sigs = computeSignals(currentPrice, h1Klines, m15Klines);
  return sigs.find(s => s.tier > 0) || DEFAULT_SIGNAL;
}
