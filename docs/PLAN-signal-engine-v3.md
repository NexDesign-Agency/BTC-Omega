# PLAN: Signal Engine v3.0 — Intelligence Upgrade (Fase 2)

> **Status:** DRAFT — Menunggu approval user
> **Scope:** Upgrade otak signal engine dari hardcoded ke data-driven
> **Files terdampak:** 4 modify, 2 new
> **Estimasi:** ~25 menit implementasi

---

## Dependency Graph (Urutan Implementasi)

```
[1] analysisUtils.ts (NEW)        ← Fondasi: ATR, Volume, Session, Candle
      │
      ├──► [2] signalEngine.ts (MODIFY)  ← Integrasi semua utils ke signal logic
      │
      └──► [3] levelEngine.ts (MODIFY)   ← Minor: export tambahan untuk multi-TF
      
[4] App.tsx (MODIFY)              ← Fetch 4 TF + pass ke engine + TF strip UI
      │
      └──► [5] constants.ts (MODIFY)     ← Config values (ATR multiplier, session hours, dll)
```

**Aturan:** Implementasi HARUS urut 1→5. Setiap langkah testable secara independen.

---

## STEP 1: Buat `analysisUtils.ts` [NEW]

**File:** `src/lib/analysisUtils.ts`

Modul utilitas murni (pure functions, no state). Berisi 4 fungsi utama:

### 1A. `calculateATR(klines, period)`
```
Input:  klines (Binance format), period (default 14)
Output: number (rata-rata True Range dalam USD)

Logic:
  - True Range = max(high-low, |high-prevClose|, |low-prevClose|)  
  - ATR = SMA of TR over `period` candles
  - Hanya pakai closed candles (buang candle terakhir yang masih open)
```

**Kenapa dipisah:** Dipakai di signalEngine untuk SL/TP, tapi juga bisa dipakai di UI untuk display volatility indicator nanti.

### 1B. `analyzeVolume(klines)`
```
Input:  klines (Binance format, volume ada di index [5])
Output: {
  currentVolume: number,
  avgVolume20: number,     // rata-rata 20 candle
  volumeRatio: number,     // current / avg (1.0 = normal)
  isSpike: boolean,        // ratio >= 1.5
  label: string            // "HIGH" | "NORMAL" | "LOW" | "SPIKE"
}

Logic:
  - avg = mean of volumes[-21..-2] (exclude current open candle)
  - current = volumes[-2] (last closed candle)
  - ratio = current / avg
  - spike = ratio >= 1.5
  - label: >=2.0 "SPIKE", >=1.5 "HIGH", >=0.7 "NORMAL", <0.7 "LOW"
```

### 1C. `detectCandlePattern(klines)`
```
Input:  klines (minimal 3 candle terakhir)
Output: {
  pattern: string,         // "BULLISH_ENGULFING" | "PIN_BAR_BULL" | "DOJI" | ...
  direction: "BULL" | "BEAR" | "NEUTRAL",
  strength: 1 | 2 | 3,    // 1=lemah, 3=kuat
} | null

Pola yang dideteksi (7 total):
  1. BULLISH_ENGULFING  (strength 3) — body hijau > 1.2x body merah sebelumnya
  2. BEARISH_ENGULFING  (strength 3) — kebalikan
  3. PIN_BAR_BULL       (strength 2) — lower wick > 2.5x body, upper wick < 0.3x body
  4. PIN_BAR_BEAR       (strength 2) — kebalikan  
  5. HAMMER             (strength 2) — pin bar bull di downtrend
  6. SHOOTING_STAR      (strength 2) — pin bar bear di uptrend
  7. DOJI               (strength 1) — body < 10% dari total range

Catatan: Fungsi ini MENGGANTIKAN checkRejection() yang sekarang terlalu sederhana.
```

### 1D. `getSessionInfo(utcHour)`
```
Input:  UTC hour (0-23)
Output: {
  name: "ASIA" | "LONDON" | "NEW_YORK" | "OVERLAP_LN" | "OFF",
  volatilityFactor: number,  // 0.85 - 1.10
  label: string               // "🌏 Asia (Low Vol)" dll
}

Mapping (UTC):
  00:00-07:00 → ASIA         (factor: 0.85)
  07:00-08:00 → OVERLAP_LN   (factor: 0.95) — Asia/London overlap
  08:00-12:00 → LONDON       (factor: 1.00)
  12:00-16:00 → OVERLAP_LN   (factor: 1.10) — London/NY overlap (HIGHEST)
  16:00-21:00 → NEW_YORK     (factor: 1.05)
  21:00-00:00 → OFF          (factor: 0.80)
```

### 1E. `analyzeTFDirection(klines)`
```
Input:  klines (any timeframe)
Output: {
  direction: "UP" | "DOWN" | "SIDEWAYS",
  strength: number,  // 0-100
  ema20: number,
  ema50: number
}

Logic:
  - Hitung EMA20 dan EMA50 dari closes
  - UP: EMA20 > EMA50 DAN price > EMA20
  - DOWN: EMA20 < EMA50 DAN price < EMA20
  - SIDEWAYS: selainnya
  - strength = abs(EMA20 - EMA50) / EMA50 * 10000 (basis points, capped 100)
```

---

## STEP 2: Upgrade `signalEngine.ts` [MODIFY]

**Perubahan signature:**
```typescript
// SEBELUM
export function computeSignals(currentPrice, h1Klines, m15Klines): SignalResult[]

// SESUDAH — terima 4 TF + metadata
export function computeSignals(
  currentPrice: number,
  klineData: {
    m5: any[], m15: any[], h1: any[], h4: any[]
  }
): SignalResult[]
```

### 2A. Ganti Fixed SL/TP → ATR-based

```
SEBELUM:
  Breakout SL = price * 0.002       (fixed 0.2%)
  Swing SL   = entry * 0.003       (fixed 0.3%)
  Scalp SL   = entry * 0.0015      (fixed 0.15%)

SESUDAH:
  atrM15 = calculateATR(m15Klines, 14)
  atrH1  = calculateATR(h1Klines, 14)
  
  Breakout SL = atrM15 * 1.5        (dynamic)
  Swing SL    = atrH1 * 2.0         (wider, karena swing)
  Scalp SL    = atrM15 * 0.8        (tight, karena scalp)
  
  TP1 = SL * 2    (selalu 1:2 minimum)
  TP2 = SL * 3.5  (extended target)
  RR  = dihitung real, bukan hardcoded "1:4.0"
```

### 2B. Tambah Volume Filter ke Breakout

```
SEBELUM (line 80-93):
  if (currentPrice > upper && distUpper < 0.15) {
    confidence = 88;  // SELALU 88% 😬
  }

SESUDAH:
  const vol = analyzeVolume(m15Klines);
  
  if (currentPrice > upper && distUpper < 0.15) {
    let confidence = 75; // base
    
    if (vol.isSpike)          confidence += 15;  // Volume spike = strong
    else if (vol.label === "HIGH") confidence += 8;
    else if (vol.label === "LOW")  confidence -= 20; // Likely fake
    
    // Skip jika confidence < 55 (fake breakout)
    if (confidence < 55) { /* don't push, add to advice instead */ }
  }
```

### 2C. Multi-TF Confluence Score

```
SEBELUM:
  localTrend = price > h1Mid ? "UP" : "DOWN"  // 1 faktor, biner

SESUDAH:
  const tfScores = {
    h4:  analyzeTFDirection(h4Klines),
    h1:  analyzeTFDirection(h1Klines),
    m15: analyzeTFDirection(m15Klines),
    m5:  analyzeTFDirection(m5Klines),
  };
  
  // Hitung alignment
  const bullCount = Object.values(tfScores).filter(s => s.direction === "UP").length;
  const bearCount = Object.values(tfScores).filter(s => s.direction === "DOWN").length;
  
  // Alignment modifier untuk confidence
  const alignmentBonus = {
    4: +15,   // 4/4 aligned = very strong
    3: +8,    // 3/4 = strong
    2: 0,     // 2/4 = netral
    1: -10,   // 1/4 = weak
    0: -20    // 0/4 = counter semua TF
  };
  
  confidence += alignmentBonus[Math.max(bullCount, bearCount)];
  
  // JUGA: Tentukan dominant trend dari weighted score
  // H4 weight=4, H1 weight=3, M15 weight=2, M5 weight=1
  // Total score menentukan localTrend yang lebih akurat
```

### 2D. Integrasikan Candle Pattern

```
SEBELUM (line 151):
  const isReject = checkRejection(lastCandle, ...);
  // Cuma boolean true/false

SESUDAH:
  const pattern = detectCandlePattern(m15Klines);
  
  // Pattern modifier
  if (pattern) {
    if (pattern.direction === signalDirection && pattern.strength === 3) {
      confidence += 12;  // Engulfing searah = sangat kuat
      note += ` ${pattern.pattern} terkonfirmasi!`;
    } else if (pattern.direction === signalDirection && pattern.strength === 2) {
      confidence += 6;   // Pin bar searah
    } else if (pattern.direction !== signalDirection && pattern.strength >= 2) {
      confidence -= 10;  // Pattern berlawanan = red flag
    }
  }
```

### 2E. Session Awareness

```
SESUDAH (di awal computeSignals):
  const session = getSessionInfo(new Date().getUTCHours());
  
  // Apply di akhir sebelum push signal:
  finalConfidence = Math.round(rawConfidence * session.volatilityFactor);
  
  // Tambah info sesi ke reasoning
  reasoning += ` | Sesi: ${session.label}`;
```

### 2F. Confidence Capping & Advice Generation

```
// Final confidence formula:
confidence = baseConfidence 
  + volumeModifier      // -20 to +15
  + alignmentBonus      // -20 to +15  
  + patternModifier     // -10 to +12
  * sessionFactor       // 0.80 to 1.10

// Cap
confidence = Math.max(0, Math.min(98, confidence));

// Generate market advice berdasarkan gabungan semua data
// Advice sekarang jadi JAUH lebih informatif:
advice = `📊 TF Alignment: ${bullCount}/4 Bullish | Volume: ${vol.label} (${vol.volumeRatio.toFixed(1)}x) | Pattern: ${pattern?.pattern || 'None'} | Sesi: ${session.name}`
```

---

## STEP 3: Update `levelEngine.ts` [MODIFY — Minor]

Perubahan kecil: export fungsi helper `findPivots()` supaya bisa dipakai juga oleh multi-TF analysis di signalEngine.

```typescript
// Tambah export
export function findPivots(...) { ... }  // sudah ada, tinggal tambah export
```

---

## STEP 4: Update `App.tsx` [MODIFY]

### 4A. Fetch 4 Timeframe (bukan 2)

```typescript
// SEBELUM
await Promise.all([fetchTF('15m'), fetchTF('1h')]);

// SESUDAH
const h4KlinesRef = useRef<any[]>([]);   // NEW
const m5KlinesRef = useRef<any[]>([]);    // NEW

await Promise.all([
  fetchTF('5m'),   // NEW
  fetchTF('15m'),
  fetchTF('1h'),
  fetchTF('4h')    // NEW
]);
```

### 4B. Update pemanggilan computeSignal

```typescript
// SEBELUM
const sig = computeSignal(currentPrice, h1RawKlines, m15RawKlines);

// SESUDAH
const sig = computeSignal(currentPrice, {
  m5: m5KlinesRef.current,
  m15: m15KlinesRef.current,
  h1: h1KlinesRef.current,
  h4: h4KlinesRef.current
});
```

### 4C. Timeframe Indicator Strip [NEW UI]

Kembalikan bar indikator di atas chart:
```
┌──────────┬──────────┬──────────┬──────────┐
│ H4 [EMA] │ H1 [EMA] │ M15[EMA] │ M5 [EMA] │
│ BULLISH  │ BULLISH  │ SIDEWAYS │ BEARISH  │
│ EMA↑ 82% │ EMA↑ 65% │ RSI: 48  │ RSI: 35  │
│ HH/HL    │ HH/HL    │ FLAT     │ LH/LL    │
└──────────┴──────────┴──────────┴──────────┘
```

Data diambil dari `analyzeTFDirection()` per timeframe.

### 4D. Session Badge di Header

Tampilkan sesi saat ini di header bar:
```
🌏 ASIA (Low Vol) | 🔥 LONDON/NY Overlap (High Vol)
```

---

## STEP 5: Update `constants.ts` [MODIFY]

Tambahkan config values yang bisa di-tune:

```typescript
export const ENGINE_CONFIG = {
  // ATR
  atrPeriod: 14,
  atrMultiplier: { breakout: 1.5, swing: 2.0, scalp: 0.8 },
  
  // Volume
  volumeAvgPeriod: 20,
  volumeSpikeThreshold: 1.5,
  volumeLowThreshold: 0.7,
  
  // Multi-TF weights
  tfWeights: { h4: 4, h1: 3, m15: 2, m5: 1 },
  alignmentBonus: { 4: 15, 3: 8, 2: 0, 1: -10, 0: -20 },
  
  // Confidence
  minConfidenceForSignal: 55,
  minConfidenceForAlert: 75,
  maxConfidence: 98,
  
  // Session (UTC hours)
  sessions: {
    asia:    { start: 0,  end: 7,  factor: 0.85 },
    london:  { start: 8,  end: 12, factor: 1.00 },
    overlap: { start: 12, end: 16, factor: 1.10 },
    ny:      { start: 16, end: 21, factor: 1.05 },
    off:     { start: 21, end: 24, factor: 0.80 },
  }
};
```

---

## File Summary

| File | Action | Lines Est. | Deskripsi |
|------|--------|------------|-----------|
| `src/lib/analysisUtils.ts` | **NEW** | ~180 | ATR, Volume, Candle, Session, TF Direction |
| `src/lib/signalEngine.ts` | **MODIFY** | ~250 (dari 184) | Integrasi semua utils, confidence formula baru |
| `src/lib/levelEngine.ts` | **MODIFY** | ~155 (dari 150) | Minor: export findPivots |
| `src/App.tsx` | **MODIFY** | ~680 (dari 601) | 4 TF fetch, TF strip UI, session badge |
| `src/constants.ts` | **MODIFY** | ~80 (dari ~50) | ENGINE_CONFIG tuneable values |

---

## Verification Plan

### Test 1: ATR Calculation
- Ambil 14 candle M15 manual dari Binance
- Hitung ATR manual di spreadsheet
- Bandingkan dengan output `calculateATR()`
- **Pass criteria:** Selisih < 0.5%

### Test 2: Volume Filter
- Jalankan app saat market aktif (sesi London/NY)
- Breakout signal harus punya info volume di reasoning
- Signal dengan volume rendah harus confidence < 55 (filtered)

### Test 3: Multi-TF Alignment
- Lihat TF strip: pastikan 4 TF update setiap 3 detik
- Confidence harus berubah saat alignment berubah (bukan konstan 88%)
- Log di console: `TF Alignment: 3/4 BULL (+8 bonus)`

### Test 4: Candle Pattern
- Tunggu pattern terbentuk (atau gunakan historical data)
- Cek reasoning harus menyebut nama pattern
- Confidence harus naik/turun sesuai pattern

### Test 5: Session
- Cek session badge di header menampilkan sesi yang benar
- Confidence harus berbeda antara sesi Asia vs NY overlap

### Test 6: Regresi
- Pastikan semua 3 signal cards masih render dengan benar
- History recording masih berfungsi
- Voice/audio alerts masih fire pada threshold yang benar
- Mobile layout tidak rusak

---

## Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Binance API rate limit (4 TF = 4 req/3s) | Kena block sementara | Binance limit = 1200 req/min. 4 req/3s = 80/min. Aman. |
| ATR terlalu lebar saat flash crash | SL kejauhan | Cap ATR max = 2% dari harga |
| Volume data Binance = quote volume, bukan real | Kurang akurat | Tetap berguna sebagai proxy relatif |
| Candle pattern false positive | Signal salah | Pattern hanya modifier (+/-), bukan trigger utama |
