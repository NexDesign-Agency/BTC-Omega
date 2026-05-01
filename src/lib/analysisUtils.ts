// analysisUtils.ts — Fondasi analisis: ATR, Volume, Candle Pattern, Session, TF Direction
// Pure functions, no state. Dipakai oleh signalEngine.ts

// ── ATR (Average True Range) ──────────────────────────────────────────
export function calculateATR(klines: any[], period = 14): number {
  if (!klines || klines.length < period + 2) return 0;

  // Buang candle terakhir (masih open)
  const closed = klines.slice(0, -1);
  const trValues: number[] = [];

  for (let i = 1; i < closed.length; i++) {
    const high = parseFloat(closed[i][2]);
    const low = parseFloat(closed[i][3]);
    const prevClose = parseFloat(closed[i - 1][4]);
    if (isNaN(high) || isNaN(low) || isNaN(prevClose)) continue;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trValues.push(tr);
  }

  if (trValues.length < period) return 0;

  // SMA of last `period` TR values
  const recent = trValues.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ── Volume Analysis ───────────────────────────────────────────────────
export interface VolumeInfo {
  currentVolume: number;
  avgVolume20: number;
  volumeRatio: number;
  isSpike: boolean;
  label: "SPIKE" | "HIGH" | "NORMAL" | "LOW";
}

export function analyzeVolume(klines: any[]): VolumeInfo {
  const fallback: VolumeInfo = { currentVolume: 0, avgVolume20: 0, volumeRatio: 1, isSpike: false, label: "NORMAL" };
  if (!klines || klines.length < 22) return fallback;

  // Pakai closed candles, buang yang masih open
  const closed = klines.slice(0, -1);
  const volumes = closed.map(k => parseFloat(k[5]));

  const current = volumes[volumes.length - 1];
  const avgSlice = volumes.slice(-21, -1); // 20 candle sebelum current
  if (avgSlice.length === 0) return fallback;

  const avg = avgSlice.reduce((a, b) => a + b, 0) / avgSlice.length;
  const ratio = avg > 0 ? current / avg : 1;

  let label: VolumeInfo["label"] = "NORMAL";
  if (ratio >= 2.0) label = "SPIKE";
  else if (ratio >= 1.5) label = "HIGH";
  else if (ratio < 0.7) label = "LOW";

  return {
    currentVolume: current,
    avgVolume20: avg,
    volumeRatio: ratio,
    isSpike: ratio >= 1.5,
    label
  };
}

// ── Candle Pattern Detection ──────────────────────────────────────────
export interface CandlePattern {
  pattern: string;
  direction: "BULL" | "BEAR" | "NEUTRAL";
  strength: 1 | 2 | 3;
}

function parseCandle(k: any) {
  const open = parseFloat(k[1]);
  const high = parseFloat(k[2]);
  const low = parseFloat(k[3]);
  const close = parseFloat(k[4]);
  const body = Math.abs(close - open);
  const range = high - low;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const isBullish = close > open;
  return { open, high, low, close, body, range, upperWick, lowerWick, isBullish };
}

export function detectCandlePattern(klines: any[]): CandlePattern | null {
  if (!klines || klines.length < 4) return null;

  // Pakai 3 candle terakhir yang sudah closed
  const closed = klines.slice(0, -1);
  if (closed.length < 3) return null;

  const prev2 = parseCandle(closed[closed.length - 3]);
  const prev1 = parseCandle(closed[closed.length - 2]);
  const curr = parseCandle(closed[closed.length - 1]);

  // Guard: skip jika range terlalu kecil (flat market noise)
  if (curr.range < 1) return null;

  // 1. Bullish Engulfing (strength 3)
  if (!prev1.isBullish && curr.isBullish && curr.body > prev1.body * 1.2 && curr.close > prev1.open && curr.open <= prev1.close) {
    return { pattern: "BULLISH_ENGULFING", direction: "BULL", strength: 3 };
  }

  // 2. Bearish Engulfing (strength 3)
  if (prev1.isBullish && !curr.isBullish && curr.body > prev1.body * 1.2 && curr.close < prev1.open && curr.open >= prev1.close) {
    return { pattern: "BEARISH_ENGULFING", direction: "BEAR", strength: 3 };
  }

  // 3. Pin Bar Bull / Hammer (strength 2)
  if (curr.lowerWick > curr.body * 2.5 && curr.upperWick < curr.body * 0.5 && curr.body > 0) {
    return { pattern: "PIN_BAR_BULL", direction: "BULL", strength: 2 };
  }

  // 4. Pin Bar Bear / Shooting Star (strength 2)
  if (curr.upperWick > curr.body * 2.5 && curr.lowerWick < curr.body * 0.5 && curr.body > 0) {
    return { pattern: "PIN_BAR_BEAR", direction: "BEAR", strength: 2 };
  }

  // 5. Morning Star (3-candle bullish reversal, strength 3)
  if (!prev2.isBullish && prev1.body < prev2.body * 0.3 && curr.isBullish && curr.close > prev2.open) {
    return { pattern: "MORNING_STAR", direction: "BULL", strength: 3 };
  }

  // 6. Evening Star (3-candle bearish reversal, strength 3)
  if (prev2.isBullish && prev1.body < prev2.body * 0.3 && !curr.isBullish && curr.close < prev2.open) {
    return { pattern: "EVENING_STAR", direction: "BEAR", strength: 3 };
  }

  // 7. Doji (strength 1 — indecision)
  if (curr.body < curr.range * 0.1 && curr.range > 0) {
    return { pattern: "DOJI", direction: "NEUTRAL", strength: 1 };
  }

  return null;
}

// ── Session Awareness ─────────────────────────────────────────────────
export interface SessionInfo {
  name: "ASIA" | "LONDON" | "OVERLAP" | "NEW_YORK" | "OFF";
  volatilityFactor: number;
  label: string;
}

export function getSessionInfo(utcHour?: number): SessionInfo {
  const h = utcHour ?? new Date().getUTCHours();

  if (h >= 0 && h < 7)   return { name: "ASIA",     volatilityFactor: 0.90, label: "🌏 Asia (Low Vol)" };
  if (h >= 7 && h < 8)   return { name: "OVERLAP",  volatilityFactor: 0.95, label: "🔄 Asia/London Overlap" };
  if (h >= 8 && h < 12)  return { name: "LONDON",   volatilityFactor: 1.00, label: "🇬🇧 London" };
  if (h >= 12 && h < 16) return { name: "OVERLAP",  volatilityFactor: 1.08, label: "🔥 London/NY Overlap" };
  if (h >= 16 && h < 21) return { name: "NEW_YORK", volatilityFactor: 1.03, label: "🇺🇸 New York" };
  return                         { name: "OFF",      volatilityFactor: 0.85, label: "🌙 Off-Hours" };
}

// ── Timeframe Direction Analysis (EMA-based) ──────────────────────────
export interface TFDirection {
  direction: "UP" | "DOWN" | "SIDEWAYS";
  strength: number;  // 0-100
  ema20: number;
  ema50: number;
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function analyzeTFDirection(klines: any[], currentPrice?: number): TFDirection {
  const fallback: TFDirection = { direction: "SIDEWAYS", strength: 0, ema20: 0, ema50: 0 };
  if (!klines || klines.length < 52) return fallback;

  // Pakai closed candles
  const closed = klines.slice(0, -1);
  const closes = closed.map(k => parseFloat(k[4]));
  const price = currentPrice ?? closes[closes.length - 1];

  const ema20 = calcEMA(closes, 20); // pakai semua data untuk warmup akurat
  const ema50 = calcEMA(closes, 50);

  // Direction
  let direction: TFDirection["direction"] = "SIDEWAYS";
  if (ema20 > ema50 && price > ema20) direction = "UP";
  else if (ema20 < ema50 && price < ema20) direction = "DOWN";

  // Strength = separation antara EMA20 dan EMA50 (basis points, capped 100)
  const strength = Math.min(100, Math.round(Math.abs(ema20 - ema50) / ema50 * 10000));

  return { direction, strength, ema20, ema50 };
}

// ── Multi-TF Confluence Score ─────────────────────────────────────────
export interface ConfluenceResult {
  bullCount: number;
  bearCount: number;
  sidewaysCount: number;
  dominantTrend: "UP" | "DOWN" | "SIDEWAYS";
  alignmentScore: number; // 0-4
  confidenceBonus: number; // -15 to +15
  details: Record<string, TFDirection>;
}

const TF_WEIGHTS: Record<string, number> = { h4: 4, h1: 3, m15: 2, m5: 1 };
const ALIGNMENT_BONUS: Record<number, number> = { 4: 15, 3: 8, 2: 0, 1: -8, 0: -15 };

export function calculateConfluence(
  tfData: Record<string, any[]>,
  currentPrice: number
): ConfluenceResult {
  const details: Record<string, TFDirection> = {};
  let bullCount = 0, bearCount = 0, sidewaysCount = 0;
  let weightedBull = 0, weightedBear = 0;

  for (const [tf, klines] of Object.entries(tfData)) {
    const dir = analyzeTFDirection(klines, currentPrice);
    details[tf] = dir;

    const w = TF_WEIGHTS[tf] || 1;
    if (dir.direction === "UP") { bullCount++; weightedBull += w; }
    else if (dir.direction === "DOWN") { bearCount++; weightedBear += w; }
    else { sidewaysCount++; }
  }

  const alignmentScore = Math.max(bullCount, bearCount);
  const dominantTrend: "UP" | "DOWN" | "SIDEWAYS" =
    weightedBull > weightedBear + 2 ? "UP" :
    weightedBear > weightedBull + 2 ? "DOWN" : "SIDEWAYS";

  return {
    bullCount, bearCount, sidewaysCount,
    dominantTrend,
    alignmentScore,
    confidenceBonus: ALIGNMENT_BONUS[alignmentScore] ?? 0,
    details
  };
}
