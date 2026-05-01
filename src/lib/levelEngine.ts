// Level Engine v1.2 — Auto-detect S&R + Trendlines + Triangle/Wedge
// FIX: Lebih banyak level dikembalikan (slice(-3) bukan slice(-2)) agar tier 2/3 tidak selalu kosong
// Metode: pivot high/low + linear regression for diagonals + compression check

export interface KeyLevel {
  price: number;
  type: "SUPPORT" | "RESISTANCE" | "KEY ZONE";
  strength: number;   // 1-3
  label: string;
}

export interface Trendline {
  startPrice: number;
  endPrice: number;
  slope: number;
  currentValue: number; // Projected price at the current candle
  type: "DESCENDING" | "ASCENDING";
  id: string;
}

export interface MarketPattern {
  type: "TRIANGLE" | "WEDGE" | "CHANNEL" | "NONE";
  upperLine: Trendline | null;
  lowerLine: Trendline | null;
  compressionPct: number; // seberapa sempit jepitannya (0-100)
}

// ── Pivot Detection (Fondasi untuk semua garis) ───────────────────────
export function findPivots(highs: number[], lows: number[], window = 5): { ph: {p:number, i:number}[], pl: {p:number, i:number}[] } {
  const ph: {p:number, i:number}[] = [];
  const pl: {p:number, i:number}[] = [];
  for (let i = window; i < highs.length - window; i++) {
    const sliceH = highs.slice(i - window, i + window + 1);
    const sliceL = lows.slice(i - window, i + window + 1);
    if (highs[i] === Math.max(...sliceH)) ph.push({p: highs[i], i});
    if (lows[i]  === Math.min(...sliceL)) pl.push({p: lows[i], i});
  }
  return { ph, pl };
}

// ── Trendline Calculation (Garis Miring) ──────────────────────────────
function calculateTrendline(pivots: {p:number, i:number}[], type: "RES" | "SUP", currentIndex: number): Trendline | null {
  if (pivots.length < 2) return null;
  const p2 = pivots[pivots.length - 1];
  const p1 = pivots[pivots.length - 2];
  
  const slope = (p2.p - p1.p) / (p2.i - p1.i);
  const currentValue = p2.p + slope * (currentIndex - p2.i);

  return {
    startPrice: p1.p,
    endPrice: p2.p,
    slope: slope,
    currentValue: currentValue,
    type: slope > 0 ? "ASCENDING" : "DESCENDING",
    id: `${type}-${Date.now()}`
  };
}

// ── Cluster nearby levels (Horizontal) ────────────────────────────────
function clusterLevels(levels: number[], currentPrice: number): { price: number; strength: number }[] {
  // FIX: threshold diperlebar sedikit agar level yang berdekatan tidak terlalu dipecah
  const threshold = currentPrice * 0.002;
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: { price: number; strength: number }[] = [];
  for (const lvl of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(lvl - last.price) < threshold) {
      last.price = (last.price * last.strength + lvl) / (last.strength + 1);
      last.strength++;
    } else {
      clusters.push({ price: lvl, strength: 1 });
    }
  }
  return clusters;
}

// ── Main API ──────────────────────────────────────────────────────────
export function analyzeMarketStructure(klines: any[], currentPrice: number) {
  if (!klines || klines.length < 50) return { 
    levels: [], 
    pattern: { type: "NONE" as const, upperLine: null, lowerLine: null, compressionPct: 0 } 
  };

  const recent = klines.slice(-100);
  const highs = recent.map(k => parseFloat(k[2]));
  const lows = recent.map(k => parseFloat(k[3]));

  const { ph, pl } = findPivots(highs, lows, 4);

  // 1. Horizontal Levels
  const resClusters = clusterLevels(ph.map(p => p.p), currentPrice);
  const supClusters = clusterLevels(pl.map(p => p.p), currentPrice);
  
  const levels: KeyLevel[] = [];

  // FIX BUG #1: Ambil 3 level (bukan 2) di atas dan di bawah harga
  // agar tier 2 scalp punya lebih banyak peluang menemukan level dalam radius
  resClusters.filter(c => c.price > currentPrice).slice(-3).forEach(c => {
    levels.push({
      price: c.price,
      type: "RESISTANCE",
      strength: Math.min(3, c.strength),
      label: `RES ${Math.round(c.price)}`
    });
  });
  supClusters.filter(c => c.price < currentPrice).slice(0, 3).forEach(c => {
    levels.push({
      price: c.price,
      type: "SUPPORT",
      strength: Math.min(3, c.strength),
      label: `SUP ${Math.round(c.price)}`
    });
  });

  // 2. Trendlines (Garis Miring)
  const currentIndex = recent.length - 1;
  const upperLine = calculateTrendline(ph, "RES", currentIndex);
  const lowerLine = calculateTrendline(pl, "SUP", currentIndex);

  // 3. Pattern Detection (Triangle/Wedge)
  let patternType: "TRIANGLE" | "WEDGE" | "CHANNEL" | "NONE" = "NONE";
  let compression = 0;

  if (upperLine && lowerLine) {
    const isUpperDown = upperLine.slope < 0;
    const isLowerUp = lowerLine.slope > 0;

    if (isUpperDown && isLowerUp) patternType = "TRIANGLE";
    else if (isUpperDown && !isLowerUp && upperLine.slope < lowerLine.slope) patternType = "WEDGE";
    else if (!isUpperDown && isLowerUp && upperLine.slope < lowerLine.slope) patternType = "WEDGE";

    const currentSpread = Math.abs(upperLine.currentValue - lowerLine.currentValue);
    const startSpread = Math.abs(upperLine.startPrice - lowerLine.startPrice);
    if (startSpread > 0) {
      compression = Math.max(0, Math.min(100, (1 - currentSpread / startSpread) * 100));
    }
  }

  return {
    levels,
    pattern: {
      type: patternType,
      upperLine,
      lowerLine,
      compressionPct: compression
    }
  };
}

// ── Legacy Support ────────────────────────────────────────────────────
export function detectKeyLevels(klines: any[], currentPrice: number, maxLevels = 4): KeyLevel[] {
  const { levels } = analyzeMarketStructure(klines, currentPrice);
  return levels;
}

export function getNearestSupport(levels: KeyLevel[]): KeyLevel | null {
  return levels.find(l => l.type === "SUPPORT") || null;
}

export function getNearestResistance(levels: KeyLevel[]): KeyLevel | null {
  return levels.find(l => l.type === "RESISTANCE") || null;
}
