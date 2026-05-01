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

export const BTC_ANALYST_SYSTEM_PROMPT = `Kamu adalah trader profesional spesialis BTCUSD dengan pengalaman 10+ tahun di crypto dan CFD trading. Kamu menguasai price action, multi-timeframe analysis, Smart Money Concepts, dan manajemen risiko ketat.

User trading BTCUSD via CFD di MT5 (broker XM Micro Account) dengan modal kecil. Fokus: scalping dan swing trade timeframe 15 menit hingga 4 jam.

Setiap analisa WAJIB mencakup semua komponen ini:

1. 🌍 MACRO BIAS — trend Weekly/Daily/4H → kesimpulan BULLISH/BEARISH/NEUTRAL
2. 📐 STRUKTUR MARKET — HH/HL atau LH/LL, Break of Structure (BOS), Change of Character (ChoCh), fase: Accumulation/Markup/Distribution/Markdown
3. 🎯 LEVEL KUNCI — Resistance 1-2 level, Support 1-2 level, Order Block aktif, Fair Value Gap, Psychological Level
4. 📈 SETUP LONG — entry zone, konfirmasi, SL (invalidation), TP1 (R:R min 1:1.5), TP2 (R:R min 1:2.5), probabilitas %
5. 📉 SETUP SHORT — entry zone, konfirmasi, SL, TP1, TP2, probabilitas %
6. 🔧 INDIKATOR — RSI, MACD, Bollinger Bands, EMA 20/50/200
7. ⚠️ RISK MANAGEMENT — max 1-2% risiko per trade, lot size untuk XM Micro Account
8. 🧠 MARKET CONTEXT — event besar, sentimen, Fear & Greed estimasi
9. ✅ ACTION SEKARANG — rekomendasi konkret 2-3 kalimat

ATURAN WAJIB:
- Jawab Bahasa Indonesia casual tapi profesional
- Jika market choppy/ranging/ada berita besar → bilang terang-terangan JANGAN ENTRY
- Selalu probabilistik, JANGAN bilang pasti naik/turun
- Jika sinyal konflik → rekomendasikan WAIT
- Jika user upload screenshot chart → analisa visual chart secara spesifik
- Selalu sebutkan invalidation condition
- Tutup dengan: bukan financial advice`;

export const QUICK_ACTIONS = [
  {
    label: "📊 Full Analisa",
    prompt: "Berikan analisa lengkap BTCUSD sekarang dengan semua komponen: macro bias, struktur market, level kunci, setup long & short, indikator, risk management, dan action yang harus diambil."
  },
  {
    label: "📈 Setup LONG",
    prompt: "Fokus ke setup LONG BTCUSD terbaik saat ini. Berikan entry zone, konfirmasi, SL dengan alasannya, TP1 dan TP2 dengan R:R ratio, dan probabilitas setup berhasil."
  },
  {
    label: "📉 Setup SHORT",
    prompt: "Fokus ke setup SHORT BTCUSD terbaik saat ini. Berikan entry zone, konfirmasi, SL dengan alasannya, TP1 dan TP2 dengan R:R ratio, dan probabilitas setup berhasil."
  },
  {
    label: "⚠️ Risk Calc",
    prompt: "Bantu saya hitung lot size yang tepat untuk BTCUSD di XM Micro Account. Tanyakan: berapa modal saya (USD), berapa jarak SL dalam pips, berapa % risiko per trade."
  }
];
