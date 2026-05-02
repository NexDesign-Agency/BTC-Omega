// ── Signal Engine v3.1 Config (Tuneable — NO HARDCODED VALUES) ────────
export const ENGINE_CONFIG = {
  // ATR
  atrPeriod: 14,
  atrMaxPct: 2,           // Max ATR sebagai % dari harga (cap saat flash crash)
  atrMultiplier: {
    breakout: 1.5,        // SL = ATR × 1.5
    swing: 2.0,           // SL = ATR × 2.0 (lebih lebar untuk swing)
    scalp: 1.5,           // SL = ATR × 1.5
  },

  // Minimum SL sebagai % dari harga (floor agar TP tidak dimakan spread)
  // BTC $77k × 0.3% = $231 minimum SL → TP1 minimum $462
  minSlPct: 0.3,

  // Minimum RR ratio untuk TP1
  minRR: 1.5,

  // Confidence
  maxConfidence: 98,
  minConfidenceForAlert: 75,    // Voice/beep hanya di atas ini
  minConfidenceForRecord: 60,   // History record threshold

  // Volume
  volumeAvgPeriod: 20,
  volumeSpikeThreshold: 1.5,

  // ── Scalp Radius Config (dulu hardcoded, sekarang tuneable) ─────────
  // Radius dalam % dari harga saat ini
  scalp: {
    tier2MaxDistPct: 0.8,     // Tier 2 (searah tren) — dulu 0.5, naik jadi 0.8
    tier3MaxDistPct: 1.5,     // Tier 3 (counter tren) — dulu 1.5, tetap
    fallbackTier2MaxPct: 1.5, // Fallback tier 2 — dulu 1.0, naik jadi 1.5
    fallbackTier3MaxPct: 2.5, // Fallback tier 3 — dulu 2.0, naik jadi 2.5
  },

  // ── Level Engine Config ─────────────────────────────────────────────
  level: {
    pivotWindow: 4,            // Pivot lookback window kiri+kanan
    clusterThresholdPct: 0.2,  // S/R cluster merge threshold (% dari harga)
    maxLevelsPerSide: 3,       // Jumlah level support/resistance yang diambil
    recentCandles: 100,        // Candle yang dianalisa untuk struktur
  },

  // ── Breakout Detection ──────────────────────────────────────────────
  breakout: {
    minCompressionPct: 20,    // Min compression pattern sebelum breakout valid
    maxDistFromLinePct: 0.15, // Max jarak harga dari garis trendline (%)
  },

  // ── Confidence Modifiers ────────────────────────────────────────────
  confidence: {
    base: {
      breakout: 75,
      swing: 72,
      scalpVeryClose: 78,   // distPct <= 0.1%
      scalpClose: 72,       // distPct <= 0.2%
      scalpMid: 65,         // distPct <= 0.35%
      scalpFar: 55,         // distPct > 0.35%
      counterPenalty: 10,   // Counter tren base conf dikurangi ini
      fallbackTier2: 55,    // Base conf untuk fallback tier 2
      fallbackTier3: 45,    // Base conf untuk fallback tier 3
    },
    volumeSpike: 12,
    volumeHigh: 6,
    volumeLowPenaltyNormal: 10,
    volumeLowPenaltyCounter: 20,
    volumeNormalCounterPenalty: 5,
    patternMatchStrong: 10,   // pattern strength 3 searah
    patternMatchMid: 5,       // pattern strength 2 searah
    patternOpposePenaltyNormal: 8,
    patternOpposePenaltyCounter: 15,
    distScaleFactorFallback: 8,  // conf -= distPct * factor untuk fallback tier 2
    distScaleFactorCounter: 10,  // conf -= distPct * factor untuk fallback tier 3
  },
};

export const BTC_ANALYST_SYSTEM_PROMPT = `Lo adalah trading buddy spesialis BTCUSD — udah 10+ tahun di crypto dan CFD trading. Lo jagoan price action, SMC (Smart Money Concepts), multi-timeframe analysis, dan risk management.

User lo trading BTCUSD CFD di MT5, broker XM Micro Account, modal kecil. Fokus scalp dan swing di M15 sampai H4.

CARA LO NGOBROL:
- Casual, santai, kayak temen trader yang lebih berpengalaman — bukan robot
- Langsung to the point, gak perlu intro panjang
- Kalau ditanya "naik atau turun?" → jawab jujur dengan probabilitas, bukan ngeles
- Kalau market choppy/ranging → bilang terang-terangan "gak usah entry dulu bro"
- Pakai emoji seperlunya, jangan kebanyakan
- JANGAN format rigid 1-2-3-4-5-6-7-8-9 kecuali kalau emang diminta full analisa
- Kalau user nanya simpel → jawab simpel. Kalau nanya detail → jawab detail
- Bisa bercanda dikit, tapi tetap fokus ke trading

KEMAMPUAN LO:
- Baca struktur market: HH/HL, LH/LL, BOS, ChoCh, fase market
- Identifikasi level penting: S/R, Order Block, FVG, Psychological Level
- Setup entry: zone, konfirmasi, SL, TP, R:R ratio
- Hitung lot size buat XM Micro Account
- Baca indikator: RSI, MACD, EMA 20/50/200, Bollinger Bands
- Estimasi probabilitas setup berhasil secara jujur

YANG WAJIB LO LAKUIN:
- Selalu sebut invalidation condition kalau kasih setup
- Gunakan data market real-time yang dikasih di context — JANGAN karang harga sendiri
- Kalau sinyal konflik antar TF → rekomendasikan WAIT dengan alasan jelas
- Tutup singkat: "bukan financial advice" — jangan lebay`;

export const QUICK_ACTIONS = [
  {
    label: "📊 Full Analisa",
    prompt: "Kasih gue full analisa BTCUSD sekarang — macro bias, struktur, level kunci, setup long & short, dan action konkret."
  },
  {
    label: "📈 Setup LONG",
    prompt: "Setup LONG BTCUSD terbaik sekarang apa? Kasih entry zone, konfirmasi, SL, TP1, TP2, R:R ratio, dan probabilitas."
  },
  {
    label: "📉 Setup SHORT",
    prompt: "Setup SHORT BTCUSD terbaik sekarang apa? Kasih entry zone, konfirmasi, SL, TP1, TP2, R:R ratio, dan probabilitas."
  },
  {
    label: "⚠️ Risk Calc",
    prompt: "Bantu gue hitung lot size buat BTCUSD di XM Micro Account. Tanya dulu: modal gue berapa USD, jarak SL berapa pips, risiko per trade berapa %."
  }
];
