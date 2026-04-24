// Signal Engine — Multi-suggestion entry system based on multi-TF alignment
// Returns up to 3 suggestions: Primary, Scalp Reversal, SKIP + ADVICE

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
  label: string;
  note: string;
  isSkip?: boolean;
  isAdvice?: boolean;
}

function calcATR(klines: any[], currentPrice: number, period = 14): number {
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

const TIER_CFG: Record<number, { sl: number; tp1: number; tp2: number; baseConf: number }> = {
  1: { sl: 2.0, tp1: 3.0, tp2: 5.0, baseConf: 78 }, // FIX: turun dari 88 → 78, masih bisa dikurangi oleh penalti
  2: { sl: 1.5, tp1: 2.0, tp2: 3.5, baseConf: 65 },
  3: { sl: 1.0, tp1: 2.0, tp2: 3.0, baseConf: 52 },
  4: { sl: 0.7, tp1: 1.0, tp2: 1.5, baseConf: 40 },
  5: { sl: 0.5, tp1: 0.8, tp2: 1.2, baseConf: 30 },
};

// FIX: Hitung confidence secara dinamis, bukan hardcode
// Penalti diberikan berdasarkan kondisi pasar yang bertentangan
function calcDynamicConfidence(baseConf: number, timeframes: TfData[], type: "BUY" | "SELL", avgRsi: number): number {
  let conf = baseConf;
  const h4 = timeframes.find(t => t.timeframe === 'H4');
  const h1 = timeframes.find(t => t.timeframe === 'H1');
  const m15 = timeframes.find(t => t.timeframe === 'M15');

  // Penalti: ada BOS berlawanan di TF manapun
  if (type === "BUY") {
    if (h4?.structure === "BOS DOWN (LL)") conf -= 25; // BOS DOWN di H4 = penalti besar
    if (h1?.structure === "BOS DOWN (LL)") conf -= 15;
    if (m15?.structure === "BOS DOWN (LL)") conf -= 10;
    if (avgRsi > 65) conf -= 10; // RSI tinggi saat BUY = risiko tinggi
    if (avgRsi > 70) conf -= 10;
  } else {
    if (h4?.structure === "BOS UP (HH)") conf -= 25;
    if (h1?.structure === "BOS UP (HH)") conf -= 15;
    if (m15?.structure === "BOS UP (HH)") conf -= 10;
    if (avgRsi < 35) conf -= 10;
    if (avgRsi < 30) conf -= 10;
  }

  // Bonus: struktur searah semua TF
  const allStructBull = [h4, h1, m15].every(t => t?.structure === "BOS UP (HH)");
  const allStructBear = [h4, h1, m15].every(t => t?.structure === "BOS DOWN (LL)");
  if (type === "BUY" && allStructBull) conf += 8;
  if (type === "SELL" && allStructBear) conf += 8;

  return Math.max(10, Math.min(95, conf)); // clamp 10-95%
}

function buildSuggestion(
  type: "BUY" | "SELL",
  tier: number,
  label: string,
  note: string,
  reasoning: string,
  currentPrice: number,
  atr: number,
  timeframes: TfData[],
  avgRsi: number,
  waitPullback = false
): SignalResult {
  const cfg = TIER_CFG[tier] || { sl: 1, tp1: 1.5, tp2: 2.5, baseConf: 35 };
  const isBuy = type === "BUY";
  const entryOffset = atr * (waitPullback ? 0.5 : 0.15);
  const entryZone = isBuy ? currentPrice - entryOffset : currentPrice + entryOffset;
  const sl  = isBuy ? (entryZone - atr * cfg.sl).toFixed(1)  : (entryZone + atr * cfg.sl).toFixed(1);
  const tp1 = isBuy ? (entryZone + atr * cfg.tp1).toFixed(1) : (entryZone - atr * cfg.tp1).toFixed(1);
  const tp2 = isBuy ? (entryZone + atr * cfg.tp2).toFixed(1) : (entryZone - atr * cfg.tp2).toFixed(1);
  const rr  = `1:${(cfg.tp1 / cfg.sl).toFixed(1)}`;
  // FIX: Gunakan dynamic confidence, bukan hardcode
  const confidence = calcDynamicConfidence(cfg.baseConf, timeframes, type, avgRsi);
  return { type, tier, label, note, reasoning, confidence, zone: entryZone.toFixed(1), sl, tp1, tp2, rr, isSkip: false, isAdvice: false };
}

function buildSkip(reason: string, allLow: boolean): SignalResult {
  return {
    type: "WAIT", tier: 0, label: "SKIP",
    note: allLow ? "Semua confidence < 65%. Sangat disarankan SKIP dan tunggu konfirmasi." : "SKIP tetap pilihan valid jika ragu.",
    reasoning: reason, confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---",
    isSkip: true, isAdvice: false,
  };
}

function buildAdvice(timeframes: TfData[], suggestions: SignalResult[], atr: number, currentPrice: number): SignalResult {
  const h4  = timeframes.find(t => t.timeframe === 'H4');
  const h1  = timeframes.find(t => t.timeframe === 'H1');
  const m15 = timeframes.find(t => t.timeframe === 'M15');
  const avgRsi = h1 && m15 ? (h1.rsi + m15.rsi) / 2 : 50;
  const atrPct = ((atr / currentPrice) * 100).toFixed(2);
  const maxConf = suggestions.filter(s => !s.isSkip && !s.isAdvice).reduce((max, s) => Math.max(max, s.confidence), 0);
  const lines: string[] = [];

  const atrNum = parseFloat(atrPct);
  if (atrNum > 1.5) lines.push("Volatilitas TINGGI (ATR " + atrPct + "%). Gunakan lot lebih kecil dari biasanya.");
  else if (atrNum < 0.5) lines.push("Volatilitas RENDAH (ATR " + atrPct + "%). Market konsolidasi, spread bisa makan profit.");
  else lines.push("Volatilitas NORMAL (ATR " + atrPct + "%). Kondisi market cukup ideal.");

  if (avgRsi > 72) lines.push("RSI Overbought (" + avgRsi.toFixed(0) + "). Hindari BUY baru, potensi koreksi tinggi.");
  else if (avgRsi < 28) lines.push("RSI Oversold (" + avgRsi.toFixed(0) + "). Hindari SELL baru, potensi bounce tinggi.");
  else if (avgRsi > 60) lines.push("RSI mulai tinggi (" + avgRsi.toFixed(0) + "). BUY masih valid tapi waspadai reversal.");
  else if (avgRsi < 40) lines.push("RSI mulai rendah (" + avgRsi.toFixed(0) + "). SELL masih valid tapi waspadai bounce.");
  else lines.push("RSI Netral (" + avgRsi.toFixed(0) + "). Momentum belum berpihak ke salah satu arah.");

  if (maxConf >= 80) lines.push("Setup confidence TINGGI (" + maxConf + "%). Bisa full lot sesuai risk management.");
  else if (maxConf >= 60) lines.push("Setup confidence MODERAT (" + maxConf + "%). Gunakan 0.5x lot normal, SL ketat.");
  else if (maxConf > 0) lines.push("Setup confidence RENDAH (" + maxConf + "%). Lebih baik tunggu setup lebih jelas.");
  else lines.push("Tidak ada setup valid saat ini. Sabar dan tunggu konfirmasi market.");

  if (h4 && m15) {
    if (h4.structure === 'HH/HL' && m15.structure === 'HH/HL') lines.push("Structure BULLISH di H4 & M15. Prioritaskan BUY pada pullback.");
    else if (h4.structure === 'LH/LL' && m15.structure === 'LH/LL') lines.push("Structure BEARISH di H4 & M15. Prioritaskan SELL pada rally.");
    else if (h4.structure !== m15.structure) lines.push("Structure H4 dan M15 berlawanan. Market transisi, tunggu konfirmasi.");
  }

  const adviceText = lines.join('\n');
  return {
    type: "WAIT", tier: 0, label: "ADVICE",
    note: adviceText, reasoning: adviceText,
    confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---",
    isSkip: false, isAdvice: true,
  };
}

export function computeSignals(timeframes: TfData[], currentPrice: number, h1RawKlines: any[]): SignalResult[] {
  const h4  = timeframes.find(t => t.timeframe === 'H4');
  const h1  = timeframes.find(t => t.timeframe === 'H1');
  const m15 = timeframes.find(t => t.timeframe === 'M15');
  const m5  = timeframes.find(t => t.timeframe === 'M5');
  const suggestions: SignalResult[] = [];
  const atr = calcATR(h1RawKlines, currentPrice);

  if (!h4 || !h1 || !m15 || !m5) {
    suggestions.push(buildSkip("Data TF tidak lengkap. Tunggu fetch selesai.", true));
    return suggestions;
  }

  const bull = (t: TfData) => t.trend.includes('BULL');
  const bear = (t: TfData) => t.trend.includes('BEAR');
  const h4B = bull(h4), h1B = bull(h1), m15B = bull(m15), m5B = bull(m5);
  const h4R = bear(h4), h1R = bear(h1), m15R = bear(m15), m5R = bear(m5);
  const h4S = !h4B && !h4R;
  const avgRsi = (h1.rsi + m15.rsi) / 2;

  // Shorthand helper — pass timeframes & avgRsi ke semua buildSuggestion call
  const bs = (type: "BUY"|"SELL", tier: number, label: string, note: string, reasoning: string, wait=false) =>
    buildSuggestion(type, tier, label, note, reasoning, currentPrice, atr, timeframes, avgRsi, wait);

  // PRIMARY
  if (h4B && h1B && m15B && m5B && avgRsi < 72)
    suggestions.push(bs("BUY", 1, "BUY SETUP", "4/4 TF align. Setup terkuat, bisa entry sekarang.", "TIER 1 - H4+H1+M15+M5 Bullish. RSI avg:" + avgRsi.toFixed(0) + "."));
  else if (h4B && [h1B, m15B, m5B].filter(Boolean).length >= 2 && avgRsi < 70)
    suggestions.push(bs("BUY", 2, "BUY SETUP", "3/4 TF align. Setup moderat, bisa entry.", "TIER 2 - H4+" + [h1B?'H1':'',m15B?'M15':'',m5B?'M5':''].filter(Boolean).join('+') + " Bullish. RSI avg:" + avgRsi.toFixed(0) + "."));
  else if (h4B && h1B && avgRsi < 68)
    suggestions.push(bs("BUY", 3, "BUY SETUP", "Tunggu pullback ke entry zone. M15/M5 belum konfirmasi.", "TIER 3 - H4+H1 Bullish. M15/M5 belum ikut. RSI avg:" + avgRsi.toFixed(0) + ".", true));
  else if (h4R && h1R && m15R && m5R && avgRsi > 28)
    suggestions.push(bs("SELL", 1, "SELL SETUP", "4/4 TF align bearish. Setup terkuat, bisa entry sekarang.", "TIER 1 - H4+H1+M15+M5 Bearish. RSI avg:" + avgRsi.toFixed(0) + "."));
  else if (h4R && [h1R, m15R, m5R].filter(Boolean).length >= 2 && avgRsi > 30)
    suggestions.push(bs("SELL", 2, "SELL SETUP", "3/4 TF align bearish. Setup moderat, bisa entry.", "TIER 2 - H4+" + [h1R?'H1':'',m15R?'M15':'',m5R?'M5':''].filter(Boolean).join('+') + " Bearish. RSI avg:" + avgRsi.toFixed(0) + "."));
  else if (h4R && h1R && avgRsi > 32)
    suggestions.push(bs("SELL", 3, "SELL SETUP", "Tunggu pullback ke entry zone. M15/M5 belum konfirmasi.", "TIER 3 - H4+H1 Bearish. M15/M5 belum ikut. RSI avg:" + avgRsi.toFixed(0) + ".", true));

  // SCALP REVERSAL (lebih sensitif)
  if (h4B && h1B && (m15R || m5R) && m15.rsi < 60 && m15.rsi > 30)
    suggestions.push(bs("SELL", 5, "SCALP REVERSAL", "Hold max 1-3 candle M15. Lot kecil! Exit cepat jika M15 balik naik.", "SCALP SELL - HTF Bullish tapi M15/M5 mulai bearish. RSI M15:" + m15.rsi + ". Counter-trend."));
  else if (h4R && h1R && (m15B || m5B) && m15.rsi > 40 && m15.rsi < 68)
    suggestions.push(bs("BUY", 5, "SCALP REVERSAL", "Hold max 1-3 candle M15. Lot kecil! Exit cepat jika M15 balik turun.", "SCALP BUY - HTF Bearish tapi M15/M5 mulai bullish. RSI M15:" + m15.rsi + ". Counter-trend."));
  else if (h4S && m15B && m5B && m15.rsi > 42)
    suggestions.push(bs("BUY", 4, "SCALP BUY", "Hold max 2-4 candle M15. H4 sideways, jangan hold swing.", "TIER 4 - H4 Sideways, M15+M5 Bullish. RSI M15:" + m15.rsi + "."));
  else if (h4S && m15R && m5R && m15.rsi < 58)
    suggestions.push(bs("SELL", 4, "SCALP SELL", "Hold max 2-4 candle M15. H4 sideways, jangan hold swing.", "TIER 4 - H4 Sideways, M15+M5 Bearish. RSI M15:" + m15.rsi + "."));
  else if (m15.rsi > 75)
    suggestions.push(bs("SELL", 5, "SCALP REVERSAL", "RSI M15 Overbought! Scalp sell cepat, target 1x ATR. Lot mini.", "RSI EXTREME - M15 RSI:" + m15.rsi + " overbought. Potensi koreksi jangka pendek."));
  else if (m15.rsi < 25)
    suggestions.push(bs("BUY", 5, "SCALP REVERSAL", "RSI M15 Oversold! Scalp buy cepat, target 1x ATR. Lot mini.", "RSI EXTREME - M15 RSI:" + m15.rsi + " oversold. Potensi bounce jangka pendek."));

  // SKIP CARD
  const maxConf = suggestions.length > 0 ? Math.max(...suggestions.map(s => s.confidence)) : 0;
  const allLow = maxConf < 65;
  const bcCount = [h4,h1,m15,m5].filter(bull).length;
  const rcCount = [h4,h1,m15,m5].filter(bear).length;
  const skipReason = suggestions.length === 0
    ? (h4S ? "H4 SIDEWAYS (" + h4.structure + "). Tidak ada setup valid. Tunggu H4 konfirmasi arah." : "Alignment tidak jelas. Bull:" + bcCount + "/4, Bear:" + rcCount + "/4.")
    : (allLow ? "Semua setup confidence < 65%. Market belum memberikan sinyal yang jelas." : "Setup tersedia tapi SKIP tetap pilihan valid jika kamu ragu.");
  suggestions.push(buildSkip(skipReason, allLow));

  // ADVICE CARD
  suggestions.push(buildAdvice(timeframes, suggestions, atr, currentPrice));

  return suggestions;
}

export function computeSignal(timeframes: TfData[], currentPrice: number, h1RawKlines: any[]): SignalResult {
  const results = computeSignals(timeframes, currentPrice, h1RawKlines);
  return results.find(r => !r.isSkip && !r.isAdvice) || results[0];
}
