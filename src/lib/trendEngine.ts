// Hybrid EMA + ADX + RSI Trend Engine
// Deterministic classification with anti flip-flop (2-candle confirmation)

export type TrendLabel = "STRONG BULL" | "BULLISH" | "SIDEWAYS" | "BEARISH" | "STRONG BEAR";

export interface TrendResult {
  trend: TrendLabel;
  rsi: number;
  rsiState: string;
  structure: string;
  adx: number;
}

export interface TfConfig {
  adxMinTrend: number;
  emaFlatPct: number;
}

const TF_CONFIGS: Record<string, TfConfig> = {
  H4:  { adxMinTrend: 20, emaFlatPct: 0.12 },
  H1:  { adxMinTrend: 22, emaFlatPct: 0.10 },
  M15: { adxMinTrend: 23, emaFlatPct: 0.08 },
  M5:  { adxMinTrend: 25, emaFlatPct: 0.06 },
};

// ── EMA ──────────────────────────────────────────────────────────────
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ── RSI (Wilder smoothing) ───────────────────────────────────────────
export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── ADX (Wilder smoothing, 14-period) ────────────────────────────────
function calcADX(highs: number[], lows: number[], closes: number[], period = 14): number {
  const len = highs.length;
  if (len < period * 2 + 1) return 0;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < len; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const upMove = h - highs[i - 1];
    const downMove = lows[i - 1] - l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const wilderSmooth = (arr: number[], p: number): number[] => {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += arr[i];
    out.push(sum);
    for (let i = p; i < arr.length; i++) {
      out.push(out[out.length - 1] - out[out.length - 1] / p + arr[i]);
    }
    return out;
  };

  const smoothTR = wilderSmooth(tr, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);

  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    const sTR = smoothTR[i];
    if (sTR === 0) { dx.push(0); continue; }
    const pDI = (smoothPlusDM[i] / sTR) * 100;
    const mDI = (smoothMinusDM[i] / sTR) * 100;
    const diSum = pDI + mDI;
    dx.push(diSum === 0 ? 0 : (Math.abs(pDI - mDI) / diSum) * 100);
  }

  if (dx.length < period) return 0;

  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// ── Market Structure ─────────────────────────────────────────────────
function getStructure(closes: number[]): string {
  if (closes.length < 10) return "Ranging";
  const last5 = closes.slice(-5);
  const prev5 = closes.slice(-10, -5);
  const lastHigh = Math.max(...last5), lastLow = Math.min(...last5);
  const prevHigh = Math.max(...prev5), prevLow = Math.min(...prev5);
  if (lastHigh > prevHigh && lastLow > prevLow) return "BOS UP (HH)";
  if (lastHigh < prevHigh && lastLow < prevLow) return "BOS DOWN (LL)";
  if (lastHigh > prevHigh && lastLow < prevLow) return "Expansion";
  if (lastHigh < prevHigh && lastLow > prevLow) return "Consolidating";
  return "Ranging";
}

// ── RSI state label ──────────────────────────────────────────────────
function rsiStateLabel(rsi: number): string {
  if (rsi > 70) return "Overbought";
  if (rsi < 30) return "Oversold";
  if (rsi > 55) return "Bullish";
  if (rsi < 45) return "Bearish";
  return "Neutral";
}

// ── Anti flip-flop state ─────────────────────────────────────────────
interface FlipFlopState {
  confirmed: TrendLabel;
  candidate: TrendLabel | null;
  candidateCount: number;
  lastUpdated: number; // timestamp ms — FIX BUG 5: TTL reset
}
const flipFlopMap: Record<string, FlipFlopState> = {};
const FLIP_FLOP_TTL_MS = 30 * 60 * 1000; // 30 menit

// FIX BUG 5 — Export reset function, bisa dipanggil dari runAnalysis()
export function resetFlipFlopMap(): void {
  for (const key in flipFlopMap) {
    delete flipFlopMap[key];
  }
}

function applyAntiFlipFlop(tfLabel: string, raw: TrendLabel): TrendLabel {
  const now = Date.now();

  // FIX BUG 5 — TTL: kalau state sudah > 30 menit, hapus dan mulai fresh
  if (flipFlopMap[tfLabel] && (now - flipFlopMap[tfLabel].lastUpdated) > FLIP_FLOP_TTL_MS) {
    delete flipFlopMap[tfLabel];
  }

  if (!flipFlopMap[tfLabel]) {
    flipFlopMap[tfLabel] = { confirmed: raw, candidate: null, candidateCount: 0, lastUpdated: now };
    return raw;
  }
  const state = flipFlopMap[tfLabel];
  state.lastUpdated = now;

  if (raw === state.confirmed) {
    state.candidate = null;
    state.candidateCount = 0;
    return state.confirmed;
  }

  const sameDir = (a: TrendLabel, b: TrendLabel) =>
    (a.includes("BULL") && b.includes("BULL")) || (a.includes("BEAR") && b.includes("BEAR"));

  if (sameDir(raw, state.confirmed)) {
    state.confirmed = raw;
    state.candidate = null;
    state.candidateCount = 0;
    return raw;
  }

  if (state.candidate === raw || (state.candidate && sameDir(state.candidate, raw))) {
    state.candidateCount++;
  } else {
    state.candidate = raw;
    state.candidateCount = 1;
  }

  if (state.candidateCount >= 2) {
    state.confirmed = raw;
    state.candidate = null;
    state.candidateCount = 0;
    return raw;
  }

  return state.confirmed;
}

// ── Main classification ──────────────────────────────────────────────
function classifyRaw(
  ema21: number, ema50: number, close: number,
  adx: number, rsi: number, cfg: TfConfig
): TrendLabel {
  if (adx < cfg.adxMinTrend) return "SIDEWAYS";

  const emaSpread = Math.abs(ema21 - ema50) / ema50 * 100;
  if (emaSpread < cfg.emaFlatPct) return "SIDEWAYS";

  const bull = ema21 > ema50 && close > ema21;
  const bear = ema21 < ema50 && close < ema21;
  if (!bull && !bear) return "SIDEWAYS";

  if (bull) return (adx >= 25 && rsi >= 55) ? "STRONG BULL" : "BULLISH";
  return (adx >= 25 && rsi <= 45) ? "STRONG BEAR" : "BEARISH";
}

// ── Public API: analyze klines for one timeframe ─────────────────────
export function analyzeTimeframe(
  klines: any[],
  tfLabel: string
): TrendResult {
  const closed = klines.slice(0, -1);

  const closes = closed.map((k: any) => parseFloat(k[4]));
  const highs  = closed.map((k: any) => parseFloat(k[2]));
  const lows   = closed.map((k: any) => parseFloat(k[3]));

  const rsi = Math.round(calcRSI(closes, 14));
  const adx = Math.round(calcADX(highs, lows, closes, 14) * 10) / 10;
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const lastEma21 = ema21[ema21.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastClose = closes[closes.length - 1];

  const cfg = TF_CONFIGS[tfLabel] || TF_CONFIGS.M5;
  const rawLabel = classifyRaw(lastEma21, lastEma50, lastClose, adx, rsi, cfg);
  const trend = applyAntiFlipFlop(tfLabel, rawLabel);

  return {
    trend,
    rsi,
    rsiState: rsiStateLabel(rsi),
    structure: getStructure(closes),
    adx,
  };
}
