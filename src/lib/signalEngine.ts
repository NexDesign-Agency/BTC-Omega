// Signal Engine — Deterministic entry suggestion based on multi-TF alignment

interface TfData {
  timeframe: string;
  trend: string;
  rsi: number;
  rsiState: string;
  structure: string;
}

export interface SignalResult {
  type: "BUY" | "SELL" | "WAIT";
  tier: number;
  confidence: number;
  zone: string;
  sl: string;
  tp1: string;
  tp2: string;
  rr: string;
  reasoning: string;
}

// ATR from H1 klines (closed candles only)
function calcATR(klines: any[], currentPrice: number, period = 14): number {
  // BUG 6 FIX: Cap fallback ATR — jangan lebih dari $800 atau 0.3% harga
  if (!klines || klines.length < period + 2) return Math.min(currentPrice * 0.003, 800);
  const closed = klines.slice(0, -1);
  const recent = closed.slice(-period - 1);
  const trs = recent.map((k: any, i: number, arr: any[]) => {
    if (i === 0) return parseFloat(k[2]) - parseFloat(k[3]);
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);
    const prevClose = parseFloat(arr[i - 1][4]);
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });
  return trs.reduce((a, b) => a + b, 0) / period;
}

// SL/TP config per tier — Tier 1 paling longgar, Tier 5 paling ketat
const TIER_CFG: Record<number, { sl: number; tp1: number; tp2: number; conf: number }> = {
  1: { sl: 2.0, tp1: 3.0, tp2: 5.0, conf: 92 },   // 4/4 TF searah
  2: { sl: 1.5, tp1: 2.0, tp2: 3.5, conf: 75 },   // 3/4 TF searah (H4 termasuk)
  3: { sl: 1.0, tp1: 1.5, tp2: 2.5, conf: 62 },   // H4+H1 searah
  4: { sl: 0.7, tp1: 1.0, tp2: 1.5, conf: 45 },   // M15+M5 saja, H4 sideways (scalp)
  5: { sl: 0.5, tp1: 0.8, tp2: 1.2, conf: 30 },   // Counter-trend — SANGAT ketat
};

export function computeSignal(
  timeframes: TfData[],
  currentPrice: number,
  h1RawKlines: any[]
): SignalResult {
  const h4 = timeframes.find(t => t.timeframe === 'H4');
  const h1 = timeframes.find(t => t.timeframe === 'H1');
  const m15 = timeframes.find(t => t.timeframe === 'M15');
  const m5 = timeframes.find(t => t.timeframe === 'M5');

  let type: "BUY" | "SELL" | "WAIT" = "WAIT";
  let reasoning = "Menunggu konfirmasi...";
  let tier = 0;

  if (h4 && h1 && m15 && m5) {
    const bull = (t: TfData) => t.trend.includes('BULL');
    const bear = (t: TfData) => t.trend.includes('BEAR');
    const avgRsi = (h1.rsi + m15.rsi) / 2;

    const h4B = bull(h4), h1B = bull(h1), m15B = bull(m15), m5B = bull(m5);
    const h4R = bear(h4), h1R = bear(h1), m15R = bear(m15), m5R = bear(m5);
    const h4S = !h4B && !h4R; // sideways

    // ── BUY TIERS ────────────────────────────────────
    if (h4B && h1B && m15B && m5B && avgRsi < 72) {
      type = "BUY"; tier = 1;
      reasoning = `✅ TIER 1 — 4/4 TF Bullish (H4+H1+M15+M5). RSI avg:${avgRsi.toFixed(0)}. Setup terkuat, SL/TP longgar.`;
    }
    else if (h4B && [h1B, m15B, m5B].filter(Boolean).length >= 2 && avgRsi < 70) {
      type = "BUY"; tier = 2;
      const who = [h1B ? 'H1' : '', m15B ? 'M15' : '', m5B ? 'M5' : ''].filter(Boolean).join('+');
      reasoning = `✅ TIER 2 — H4+${who} Bullish (3/4). RSI avg:${avgRsi.toFixed(0)}. Setup moderat.`;
    }
    else if (h4B && h1B && avgRsi < 68) {
      type = "BUY"; tier = 3;
      reasoning = `⚠️ TIER 3 — H4+H1 Bullish. M15/M5 belum konfirmasi. RSI avg:${avgRsi.toFixed(0)}. Tunggu M15 ikut.`;
    }
    else if (h4S && m15B && m5B && m15.rsi > 45) {
      type = "BUY"; tier = 4;
      reasoning = `⚠️ TIER 4 — M15+M5 Bullish, H4 Sideways. Scalp BUY, SL ketat. RSI M15:${m15.rsi}.`;
    }
    // NEW — Tier 5: counter-trend, H4 bearish tapi M15+M5 mulai reversal
    else if (h4R && m15B && m5B && m15.rsi > 50 && m15.rsi < 65) {
      type = "BUY"; tier = 5;
      reasoning = `🔴 TIER 5 — COUNTER-TREND. H4 Bearish tapi M15+M5 Bullish. RSI M15:${m15.rsi}. Lot MINIMAL, SL sangat ketat. Hanya untuk scalper berpengalaman.`;
    }

    // ── SELL TIERS ───────────────────────────────────
    else if (h4R && h1R && m15R && m5R && avgRsi > 35) {
      type = "SELL"; tier = 1;
      reasoning = `✅ TIER 1 — 4/4 TF Bearish (H4+H1+M15+M5). RSI avg:${avgRsi.toFixed(0)}. Setup terkuat, SL/TP longgar.`;
    }
    else if (h4R && [h1R, m15R, m5R].filter(Boolean).length >= 2 && avgRsi > 35) {
      type = "SELL"; tier = 2;
      const who = [h1R ? 'H1' : '', m15R ? 'M15' : '', m5R ? 'M5' : ''].filter(Boolean).join('+');
      reasoning = `✅ TIER 2 — H4+${who} Bearish (3/4). RSI avg:${avgRsi.toFixed(0)}. Setup moderat.`;
    }
    else if (h4R && h1R && avgRsi > 35) {
      type = "SELL"; tier = 3;
      reasoning = `⚠️ TIER 3 — H4+H1 Bearish. M15/M5 belum konfirmasi. RSI avg:${avgRsi.toFixed(0)}. Tunggu M15 ikut.`;
    }
    else if (h4S && m15R && m5R && m15.rsi < 55) {
      type = "SELL"; tier = 4;
      reasoning = `⚠️ TIER 4 — M15+M5 Bearish, H4 Sideways. Scalp SELL, SL ketat. RSI M15:${m15.rsi}.`;
    }
    // NEW — Tier 5: counter-trend, H4 bullish tapi M15+M5 mulai bearish
    else if (h4B && m15R && m5R && m15.rsi < 50 && m15.rsi > 35) {
      type = "SELL"; tier = 5;
      reasoning = `🔴 TIER 5 — COUNTER-TREND. H4 Bullish tapi M15+M5 Bearish. RSI M15:${m15.rsi}. Lot MINIMAL, SL sangat ketat. Hanya untuk scalper berpengalaman.`;
    }

    // ── WAIT ─────────────────────────────────────────
    else {
      const bc = [h4, h1, m15, m5].filter(bull).length;
      const rc = [h4, h1, m15, m5].filter(bear).length;
      if (h4S) {
        reasoning = `⛔ H4 SIDEWAYS (${h4.structure}). Tidak ada konfirmasi cukup. Tunggu H4 konfirmasi arah.`;
      } else {
        reasoning = `⛔ Alignment kurang. Bull:${bc}/4, Bear:${rc}/4. Tunggu setup lebih jelas.`;
      }
    }
  }

  // SL / TP / Confidence
  const atr = calcATR(h1RawKlines, currentPrice);
  const cfg = TIER_CFG[tier] || { sl: 1, tp1: 1, tp2: 2, conf: 0 };

  const isBuy = type === "BUY";
  // Entry zone: sedikit offset dari harga sekarang supaya tidak langsung market entry
  // Tier 1-2: tunggu pullback kecil (0.3x ATR). Tier 3-5: lebih aggressive (0.15x ATR)
  const entryOffset = atr * (tier <= 2 ? 0.3 : 0.15);
  const entryZone = isBuy
    ? (currentPrice - entryOffset)   // BUY: entry sedikit di bawah harga (pullback tipis)
    : (currentPrice + entryOffset);  // SELL: entry sedikit di atas harga (pullback tipis)

  const sl = isBuy ? (entryZone - atr * cfg.sl).toFixed(1) : (entryZone + atr * cfg.sl).toFixed(1);
  const tp1 = isBuy ? (entryZone + atr * cfg.tp1).toFixed(1) : (entryZone - atr * cfg.tp1).toFixed(1);
  const tp2 = isBuy ? (entryZone + atr * cfg.tp2).toFixed(1) : (entryZone - atr * cfg.tp2).toFixed(1);

  // Dynamic RR based on actual distances
  const slDist = atr * cfg.sl;
  const tp1Dist = atr * cfg.tp1;
  const rr = slDist > 0 ? `1:${(tp1Dist / slDist).toFixed(1)}` : "---";

  return { type, tier, confidence: cfg.conf, zone: type !== 'WAIT' ? entryZone.toFixed(1) : currentPrice.toFixed(1), sl, tp1, tp2, rr, reasoning };
}