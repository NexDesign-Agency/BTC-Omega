// Signal Engine v3.0 — Data-Driven Price Action Engine
// Logic: Breakouts + Rejections + ATR SL/TP + Volume + Multi-TF + Candle Patterns + Session
// ATURAN UTAMA: Signal SELALU tampil. Filter hanya ubah confidence, bukan hapus signal.

import { analyzeMarketStructure } from './levelEngine';
import {
  calculateATR, analyzeVolume, detectCandlePattern,
  getSessionInfo, calculateConfluence,
  type VolumeInfo, type CandlePattern, type SessionInfo, type ConfluenceResult
} from './analysisUtils';
import { ENGINE_CONFIG } from '../constants';

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

export interface KlineData {
  m5: any[];
  m15: any[];
  h1: any[];
  h4: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────

function clampConfidence(c: number): number {
  return Math.max(10, Math.min(ENGINE_CONFIG.maxConfidence, Math.round(c)));
}

function calcRR(entry: number, sl: number, tp: number): string {
  const risk = Math.abs(entry - sl);
  if (risk === 0) return "---";
  const reward = Math.abs(tp - entry);
  return `1:${(reward / risk).toFixed(1)}`;
}

function capATR(atr: number, price: number): number {
  const maxATR = price * (ENGINE_CONFIG.atrMaxPct / 100);
  return Math.min(atr, maxATR);
}

// ── Main Signal Computation ───────────────────────────────────────────

export function computeSignals(currentPrice: number, klineData: KlineData): SignalResult[] {
  const suggestions: SignalResult[] = [];
  const { m5, m15, h1, h4 } = klineData;

  // Guard: minimal M15 + H1 harus ada
  if (!m15 || m15.length < 50 || !h1 || h1.length < 20) {
    return [
      { type: "WAIT", tier: 1, label: "MENUNGGU DATA...", note: "Data M15/H1 belum cukup.", reasoning: "Sistem butuh minimal 50 candle M15 dan 20 candle H1.", confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---", isAdvice: true },
    ];
  }

  // ── Hitung semua analisis ────────────────────────────────────────
  const structure = analyzeMarketStructure(m15, currentPrice);
  const atrM15 = capATR(calculateATR(m15, ENGINE_CONFIG.atrPeriod), currentPrice);
  const atrH1 = capATR(calculateATR(h1, ENGINE_CONFIG.atrPeriod), currentPrice);
  const volume = analyzeVolume(m15);
  const pattern = detectCandlePattern(m15);
  const session = getSessionInfo();

  // Multi-TF confluence (pakai data yang tersedia)
  const tfData: Record<string, any[]> = {};
  if (h4 && h4.length >= 52) tfData.h4 = h4;
  if (h1 && h1.length >= 52) tfData.h1 = h1;
  if (m15 && m15.length >= 52) tfData.m15 = m15;
  if (m5 && m5.length >= 52) tfData.m5 = m5;

  const confluence = Object.keys(tfData).length >= 2
    ? calculateConfluence(tfData, currentPrice)
    : null;

  const localTrend = confluence?.dominantTrend ?? "SIDEWAYS";

  // ── Deteksi Lokal H1 Range ──────────────────────────────────────
  const h1Recent = h1.slice(-20);
  const h1Highs = h1Recent.map((k: any) => parseFloat(k[2]));
  const h1Lows = h1Recent.map((k: any) => parseFloat(k[3]));
  const h1Highest = Math.max(...h1Highs);
  const h1Lowest = Math.min(...h1Lows);

  // ── Helper: Apply modifiers ke confidence ───────────────────────
  function applyModifiers(baseConf: number, signalDir: "BUY" | "SELL", isCounter = false): { confidence: number; modNotes: string[] } {
    let conf = baseConf;
    const notes: string[] = [];

    // Volume modifier — counter tren dihukum lebih berat
    if (volume.label === "SPIKE") { conf += 12; notes.push(`Vol SPIKE (${volume.volumeRatio.toFixed(1)}x)`); }
    else if (volume.label === "HIGH") { conf += 6; notes.push(`Vol HIGH (${volume.volumeRatio.toFixed(1)}x)`); }
    else if (volume.label === "LOW") { conf -= isCounter ? 20 : 10; notes.push(`Vol LOW${isCounter ? ' ⛔' : ' ⚠️'}`); }
    else if (volume.label === "NORMAL" && isCounter) { conf -= 5; notes.push(`Vol NORMAL (counter penalty)`); }

    // Confluence modifier
    if (confluence) {
      conf += confluence.confidenceBonus;
      const aligned = Math.max(confluence.bullCount, confluence.bearCount);
      notes.push(`TF ${aligned}/4 aligned`);
    }

    // Pattern modifier — counter tren dihukum lebih berat kalau pattern berlawanan
    if (pattern) {
      const patDir = pattern.direction === "BULL" ? "BUY" : pattern.direction === "BEAR" ? "SELL" : null;
      if (patDir === signalDir && pattern.strength === 3) { conf += 10; notes.push(`${pattern.pattern} ✓`); }
      else if (patDir === signalDir && pattern.strength === 2) { conf += 5; notes.push(`${pattern.pattern}`); }
      else if (patDir && patDir !== signalDir && pattern.strength >= 2) {
        conf -= isCounter ? 15 : 8;
        notes.push(`${pattern.pattern} berlawanan${isCounter ? ' ⛔' : ' ⚠️'}`);
      }
    }

    // Session modifier (multiply, bukan add — supaya efeknya proporsional)
    conf = conf * session.volatilityFactor;
    notes.push(session.label);

    return { confidence: clampConfidence(conf), modNotes: notes };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. TIER 1: PRIMARY ENTRY (Swing Extreme atau Explosive Breakout)
  // ═══════════════════════════════════════════════════════════════════
  let primaryAdded = false;

  // Cek Breakout — Pattern compression + harga menembus garis
  if (structure.pattern && structure.pattern.type !== "NONE" && structure.pattern.upperLine && structure.pattern.lowerLine) {
    const upper = structure.pattern.upperLine;
    const lower = structure.pattern.lowerLine;

    if (structure.pattern.compressionPct > 20) {
      const distUpper = (Math.abs(currentPrice - upper.currentValue) / currentPrice) * 100;
      const distLower = (Math.abs(currentPrice - lower.currentValue) / currentPrice) * 100;

      if (currentPrice > upper.currentValue && distUpper < 0.15) {
        const slDist = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.breakout : currentPrice * 0.002;
        const entry = currentPrice;
        const sl = entry - slDist;
        const tp1 = entry + slDist * 2;
        const tp2 = entry + slDist * 4;

        const baseConf = 75;
        const { confidence, modNotes } = applyModifiers(baseConf, "BUY");

        suggestions.push({
          type: "BUY", tier: 1,
          label: `EXPLOSIVE ${structure.pattern.type} BREAKOUT`,
          note: confidence >= 70 ? "Breakout Atas terkonfirmasi! Eksekusi Market." : "Breakout terdeteksi, tapi konfirmasi lemah. Hati-hati.",
          reasoning: `Harga memotong diagonal ${Math.round(upper.currentValue)}. Compression ${structure.pattern.compressionPct.toFixed(0)}%. | ${modNotes.join(' | ')}`,
          confidence, zone: entry.toFixed(1),
          sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
          rr: calcRR(entry, sl, tp2)
        });
        primaryAdded = true;
      } else if (currentPrice < lower.currentValue && distLower < 0.15) {
        const slDist = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.breakout : currentPrice * 0.002;
        const entry = currentPrice;
        const sl = entry + slDist;
        const tp1 = entry - slDist * 2;
        const tp2 = entry - slDist * 4;

        const baseConf = 75;
        const { confidence, modNotes } = applyModifiers(baseConf, "SELL");

        suggestions.push({
          type: "SELL", tier: 1,
          label: `EXPLOSIVE ${structure.pattern.type} BREAKOUT`,
          note: confidence >= 70 ? "Breakout Bawah terkonfirmasi! Eksekusi Market." : "Breakout terdeteksi, konfirmasi lemah. Hati-hati.",
          reasoning: `Harga memotong diagonal ${Math.round(lower.currentValue)}. Compression ${structure.pattern.compressionPct.toFixed(0)}%. | ${modNotes.join(' | ')}`,
          confidence, zone: entry.toFixed(1),
          sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
          rr: calcRR(entry, sl, tp2)
        });
        primaryAdded = true;
      }
    }
  }

  // Jika tidak ada breakout → TREND-FOLLOWING pullback entry (SELALU tampil)
  // Trader pro IKUT TREN: tren UP → BUY di pullback, tren DOWN → SELL di pullback
  if (!primaryAdded) {
    // Tentukan direction mengikuti tren (BUKAN melawan!)
    const h1Mid = (h1Highest + h1Lowest) / 2;
    const type: "BUY" | "SELL" = localTrend === "UP" ? "BUY" : localTrend === "DOWN" ? "SELL" : (currentPrice < h1Mid ? "BUY" : "SELL");

    // Entry point: pullback ke area support (uptrend) atau resistance (downtrend)
    // Uptrend  → BUY di recent swing low / support area (bukan di puncak!)
    // Downtrend → SELL di recent swing high / resistance area (bukan di dasar!)
    let entry: number;
    if (type === "BUY") {
      // Cari swing low terbaru dari 10 candle terakhir H1 sebagai pullback zone
      const recentLows = h1Lows.slice(-10);
      const recentSwingLow = Math.min(...recentLows);
      // Entry di antara swing low dan midpoint (area value)
      entry = (recentSwingLow + h1Mid) / 2;
    } else {
      const recentHighs = h1Highs.slice(-10);
      const recentSwingHigh = Math.max(...recentHighs);
      entry = (recentSwingHigh + h1Mid) / 2;
    }

    const slDist = atrH1 > 0 ? atrH1 * ENGINE_CONFIG.atrMultiplier.swing : entry * 0.003;
    const sl = type === "BUY" ? entry - slDist : entry + slDist;
    const tp1 = type === "BUY" ? entry + slDist * 3 : entry - slDist * 3;
    const tp2 = type === "BUY" ? entry + slDist * 6 : entry - slDist * 6;

    const baseConf = 72;
    const { confidence, modNotes } = applyModifiers(baseConf, type);

    const trendLabel = localTrend === "UP" ? "PULLBACK BUY" : localTrend === "DOWN" ? "PULLBACK SELL" : "SWING LIMIT";

    suggestions.push({
      type, tier: 1,
      label: `PRIMARY ${trendLabel} @ ${Math.round(entry)}`,
      note: type === "BUY"
        ? "Ikut tren naik. Tunggu pullback ke area support untuk BUY."
        : "Ikut tren turun. Tunggu pullback ke area resistance untuk SELL.",
      reasoning: `Tren dominan: ${localTrend}. Entry pullback di area value H1. ATR H1: $${Math.round(atrH1)}. | ${modNotes.join(' | ')}`,
      confidence, zone: entry.toFixed(1),
      sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
      rr: calcRR(entry, sl, tp2)
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. TIER 2 & 3: SCALP (Searah & Counter Tren)
  // ═══════════════════════════════════════════════════════════════════
  let tier2Added = false;
  let tier3Added = false;

  if (structure.levels && structure.levels.length > 0) {
    // Sort levels by distance to current price (closest first)
    const sortedLevels = [...structure.levels].sort(
      (a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price)
    );

    for (const lvl of sortedLevels) {
      const exactEntry = lvl.price;
      const distPct = (Math.abs(currentPrice - exactEntry) / currentPrice) * 100;

      const type: "BUY" | "SELL" = lvl.type === "SUPPORT" ? "BUY" : "SELL";

      // Tentukan tier dulu sebelum filter radius
      let tier = 3;
      if (localTrend === "UP" && type === "BUY") tier = 2;
      if (localTrend === "DOWN" && type === "SELL") tier = 2;
      if (localTrend === "SIDEWAYS") tier = 2;

      // BUG 2 FIX: Radius berbeda per tier — searah tren lebih lebar
      const maxDist = tier === 2 ? 0.8 : 0.5;
      if (distPct > maxDist) continue;

      // Skip jika tier ini sudah ada (ambil yang terdekat saja)
      if (tier === 2 && tier2Added) continue;
      if (tier === 3 && tier3Added) continue;

      const slDist = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.scalp : exactEntry * 0.0015;
      const sl = type === "BUY" ? exactEntry - slDist : exactEntry + slDist;
      const tp1 = type === "BUY" ? exactEntry + slDist * 2 : exactEntry - slDist * 2;
      const tp2 = type === "BUY" ? exactEntry + slDist * 3.5 : exactEntry - slDist * 3.5;

      // Base confidence berdasarkan jarak
      let baseConf = 65;
      if (distPct <= 0.1) baseConf = 78;
      else if (distPct <= 0.2) baseConf = 72;
      else if (distPct <= 0.35) baseConf = 65;
      else baseConf = 55;

      // BUG 3 FIX: Counter tren mulai dari confidence lebih rendah
      if (tier === 3) baseConf -= 10;

      // BUG 1 FIX: Counter tren pakai modifier lebih ketat
      const isCounter = tier === 3;
      const { confidence, modNotes } = applyModifiers(baseConf, type, isCounter);

      suggestions.push({
        type, tier,
        label: `LIMIT SCALP @ ${Math.round(exactEntry)}`,
        note: confidence >= 70
          ? (distPct <= 0.15 ? "Harga sangat dekat! Jaring sekarang." : "Pasang Limit Order di S/R.")
          : "Pantau level ini. Konfirmasi masih lemah.",
        reasoning: `Pantulan ${tier === 2 ? 'searah' : 'counter'} tren. Jarak: ${distPct.toFixed(2)}%. ATR M15: $${Math.round(atrM15)}. | ${modNotes.join(' | ')}`,
        confidence, zone: exactEntry.toFixed(1),
        sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
        rr: calcRR(exactEntry, sl, tp2)
      });

      if (tier === 2) tier2Added = true;
      if (tier === 3) tier3Added = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SAFEGUARD: Jika Tier 2 atau Tier 3 kosong, buat fallback
  // App TIDAK BOLEH "gagu" — selalu tampilkan sesuatu
  // ═══════════════════════════════════════════════════════════════════
  if (!tier2Added) {
    const type: "BUY" | "SELL" = localTrend === "UP" ? "BUY" : localTrend === "DOWN" ? "SELL" : "BUY";
    suggestions.push({
      type: "WAIT", tier: 2,
      label: "MENUNGGU LEVEL TERDEKAT",
      note: `Menunggu harga mendekati Support/Resistance searah tren (${localTrend}).`,
      reasoning: `Tidak ada S/R dalam radius 0.5% dari harga saat ini. ${session.label}`,
      confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---"
    });
  }

  if (!tier3Added) {
    suggestions.push({
      type: "WAIT", tier: 3,
      label: "MENUNGGU PELUANG COUNTER",
      note: "Menunggu harga menyentuh level counter-tren untuk scalp pantulan.",
      reasoning: `Tidak ada level counter dalam jangkauan. ${session.label}`,
      confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---"
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADVICE: Ringkasan kondisi market (SELALU tampil)
  // ═══════════════════════════════════════════════════════════════════
  const adviceLines: string[] = [];
  adviceLines.push(`📊 Tren Dominan: ${localTrend}${confluence ? ` (${Math.max(confluence.bullCount, confluence.bearCount)}/4 TF aligned)` : ''}`);
  adviceLines.push(`📈 Volume: ${volume.label} (${volume.volumeRatio.toFixed(1)}x avg)`);
  if (pattern) adviceLines.push(`🕯️ Candle: ${pattern.pattern} (${pattern.direction}, strength ${pattern.strength})`);
  adviceLines.push(`⏰ Sesi: ${session.label}`);
  adviceLines.push(`📐 ATR M15: $${Math.round(atrM15)} | ATR H1: $${Math.round(atrH1)}`);

  suggestions.push({
    type: "WAIT", tier: 99,
    label: "MARKET OVERVIEW",
    note: adviceLines.join('\n'),
    reasoning: "",
    confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---",
    isAdvice: true
  });

  // Sort: tier ascending, lalu distance
  return suggestions.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return 0;
  });
}

export function computeSignal(currentPrice: number, klineData: KlineData): SignalResult {
  const sigs = computeSignals(currentPrice, klineData);
  return sigs.find(s => s.tier > 0 && s.tier < 99 && s.type !== "WAIT") || sigs[0];
}
