// ── Signal Engine v3.0 Config (Tuneable) ──────────────────────────────
export const ENGINE_CONFIG = {
  // ATR
  atrPeriod: 14,
  atrMaxPct: 2, // Max ATR sebagai % dari harga (cap saat flash crash)
  atrMultiplier: {
    breakout: 1.5,  // SL = ATR × 1.5
    swing: 2.0,     // SL = ATR × 2.0 (lebih lebar untuk swing)
    scalp: 1.5,     // SL = ATR × 1.5 (was 0.8 — terlalu kecil, dimakan spread)
  },

  // Minimum SL sebagai % dari harga (floor agar TP tidak dimakan spread)
  // BTC $77k × 0.3% = $231 minimum SL → TP1 minimum $462
  minSlPct: 0.3,

  // Confidence
  maxConfidence: 98,
  minConfidenceForAlert: 75,  // Voice/beep hanya di atas ini
  minConfidenceForRecord: 60, // History record threshold

  // Volume
  volumeAvgPeriod: 20,
  volumeSpikeThreshold: 1.5,

  // Scalp distance
  scalpMaxDistPct: 0.5, // Max jarak S/R untuk scalp (% dari harga)
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
