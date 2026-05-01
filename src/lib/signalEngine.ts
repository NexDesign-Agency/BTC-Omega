// Signal Engine v3.0 — Data-Driven Price Action Engine
// Logic: Breakouts + Rejections + ATR SL/TP + Volume + Multi-TF + Candle Patterns + Session
// ATURAN UTAMA: Signal SELALU tampil. Filter hanya ubah confidence, bukan hapus signal.

import { analyzeMarketStructure } from './levelEngine';
import {
  calculateATR, analyzeVolume, detectCandlePattern,
  getSessionInfo, calculateConfluence
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
  // DUAL STRUCTURE: H1 untuk Primary (level major), M15 untuk Scalp/Counter (level minor)
  const structureH1 = analyzeMarketStructure(h1, currentPrice);
  const structureM15 = analyzeMarketStructure(m15, currentPrice);
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
  if (structureM15.pattern && structureM15.pattern.type !== "NONE" && structureM15.pattern.upperLine && structureM15.pattern.lowerLine) {
    const upper = structureM15.pattern.upperLine;
    const lower = structureM15.pattern.lowerLine;

    if (structureM15.pattern.compressionPct > 20) {
      const distUpper = (Math.abs(currentPrice - upper.currentValue) / currentPrice) * 100;
      const distLower = (Math.abs(currentPrice - lower.currentValue) / currentPrice) * 100;

      if (currentPrice > upper.currentValue && distUpper < 0.15) {
        const slDist = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.breakout : currentPrice * 0.002;
        const entry = currentPrice;
        const sl = entry - slDist;

        // Breakout TP: cari resistance di atas, fallback ke ATR
        let tp1 = entry + slDist * 2, tp2 = entry + slDist * 4;
        if (structureH1.levels && structureH1.levels.length > 0) {
          const targets = structureH1.levels.filter(l => l.price > entry + slDist).sort((a, b) => a.price - b.price);
          if (targets[0]) tp1 = targets[0].price;
          if (targets[1]) tp2 = targets[1].price;
        }

        const baseConf = 75;
        const { confidence, modNotes } = applyModifiers(baseConf, "BUY");

        suggestions.push({
          type: "BUY", tier: 1,
          label: `EXPLOSIVE ${structureM15.pattern.type} BREAKOUT`,
          note: confidence >= 70 ? "Breakout Atas terkonfirmasi! Eksekusi Market." : "Breakout terdeteksi, tapi konfirmasi lemah. Hati-hati.",
          reasoning: `Harga memotong diagonal ${Math.round(upper.currentValue)} | Compression ${structureM15.pattern.compressionPct.toFixed(0)}% | ${modNotes.join(' | ')}`,
          confidence, zone: entry.toFixed(1),
          sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
          rr: calcRR(entry, sl, tp2)
        });
        primaryAdded = true;
      } else if (currentPrice < lower.currentValue && distLower < 0.15) {
        const slDist = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.breakout : currentPrice * 0.002;
        const entry = currentPrice;
        const sl = entry + slDist;

        // Breakout TP: cari support di bawah, fallback ke ATR
        let tp1 = entry - slDist * 2, tp2 = entry - slDist * 4;
        if (structureH1.levels && structureH1.levels.length > 0) {
          const targets = structureH1.levels.filter(l => l.price < entry - slDist).sort((a, b) => b.price - a.price);
          if (targets[0]) tp1 = targets[0].price;
          if (targets[1]) tp2 = targets[1].price;
        }

        const baseConf = 75;
        const { confidence, modNotes } = applyModifiers(baseConf, "SELL");

        suggestions.push({
          type: "SELL", tier: 1,
          label: `EXPLOSIVE ${structureM15.pattern.type} BREAKOUT`,
          note: confidence >= 70 ? "Breakout Bawah terkonfirmasi! Eksekusi Market." : "Breakout terdeteksi, konfirmasi lemah. Hati-hati.",
          reasoning: `Harga memotong diagonal ${Math.round(lower.currentValue)} | Compression ${structureM15.pattern.compressionPct.toFixed(0)}% | ${modNotes.join(' | ')}`,
          confidence, zone: entry.toFixed(1),
          sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
          rr: calcRR(entry, sl, tp2)
        });
        primaryAdded = true;
      }
    }
  }

  // Jika tidak ada breakout → TREND-FOLLOWING pullback entry dari H1 structure
  // PRIMARY pakai H1 S/R levels (level major, lebih jauh dari harga)
  if (!primaryAdded) {
    const h1Mid = (h1Highest + h1Lowest) / 2;
    const type: "BUY" | "SELL" = localTrend === "UP" ? "BUY" : localTrend === "DOWN" ? "SELL" : (currentPrice < h1Mid ? "BUY" : "SELL");

    // Entry dari H1 S/R level (bukan rumus rata-rata!)
    let entry: number | null = null;
    let entrySource = "H1 S/R";

    if (structureH1.levels && structureH1.levels.length > 0) {
      if (type === "BUY") {
        // Cari SUPPORT H1 terdekat di BAWAH harga (pullback zone)
        const h1Supports = structureH1.levels
          .filter(l => (l.type === "SUPPORT" || l.type === "KEY ZONE") && l.price < currentPrice)
          .sort((a, b) => b.price - a.price); // terdekat dulu
        if (h1Supports[0]) entry = h1Supports[0].price;
      } else {
        // Cari RESISTANCE H1 terdekat di ATAS harga (pullback zone untuk SELL)
        const h1Resists = structureH1.levels
          .filter(l => (l.type === "RESISTANCE" || l.type === "KEY ZONE") && l.price > currentPrice)
          .sort((a, b) => a.price - b.price); // terdekat dulu
        if (h1Resists[0]) entry = h1Resists[0].price;
      }
    }

    // Fallback ke H1 swing math jika tidak ada level
    if (entry === null) {
      entrySource = "H1 swing";
      if (type === "BUY") {
        const recentSwingLow = Math.min(...h1Lows.slice(-10));
        entry = (recentSwingLow + h1Mid) / 2;
      } else {
        const recentSwingHigh = Math.max(...h1Highs.slice(-10));
        entry = (recentSwingHigh + h1Mid) / 2;
      }
    }

    const slDist = atrH1 > 0 ? atrH1 * ENGINE_CONFIG.atrMultiplier.swing : entry * 0.003;
    const sl = type === "BUY" ? entry - slDist : entry + slDist;

    // TP dari H1 levels (level major)
    let tp1: number, tp2: number;
    const fbTp1 = type === "BUY" ? entry + slDist * 2 : entry - slDist * 2;
    const fbTp2 = type === "BUY" ? entry + slDist * 3.5 : entry - slDist * 3.5;

    if (structureH1.levels && structureH1.levels.length > 0) {
      if (type === "BUY") {
        const targets = structureH1.levels
          .filter(l => (l.type === "RESISTANCE" || l.type === "KEY ZONE") && l.price > entry! + slDist)
          .sort((a, b) => a.price - b.price);
        tp1 = targets[0]?.price ?? fbTp1;
        tp2 = targets[1]?.price ?? (targets[0] ? targets[0].price + slDist : fbTp2);
      } else {
        const targets = structureH1.levels
          .filter(l => (l.type === "SUPPORT" || l.type === "KEY ZONE") && l.price < entry! - slDist)
          .sort((a, b) => b.price - a.price);
        tp1 = targets[0]?.price ?? fbTp1;
        tp2 = targets[1]?.price ?? (targets[0] ? targets[0].price - slDist : fbTp2);
      }
    } else {
      tp1 = fbTp1;
      tp2 = fbTp2;
    }

    // Minimum RR 1:1.5
    const minTp1Dist = slDist * 1.5;
    if (type === "BUY" && tp1 - entry < minTp1Dist) tp1 = entry + minTp1Dist;
    if (type === "SELL" && entry - tp1 < minTp1Dist) tp1 = entry - minTp1Dist;

    const baseConf = 72;
    const { confidence, modNotes } = applyModifiers(baseConf, type);
    const distPct = ((Math.abs(currentPrice - entry) / currentPrice) * 100).toFixed(2);

    const trendLabel = localTrend === "UP" ? "PULLBACK BUY" : localTrend === "DOWN" ? "PULLBACK SELL" : "SWING LIMIT";

    suggestions.push({
      type, tier: 1,
      label: `PRIMARY ${trendLabel} @ ${Math.round(entry)}`,
      note: type === "BUY"
        ? "Ikut tren naik. Tunggu pullback ke H1 support untuk BUY."
        : "Ikut tren turun. Tunggu pullback ke H1 resistance untuk SELL.",
      reasoning: `Tren: ${localTrend} | Entry: ${entrySource} (${distPct}%) | ATR H1: $${Math.round(atrH1)} | ${modNotes.join(' | ')}`,
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

  if (structureM15.levels && structureM15.levels.length > 0) {
    // Sort levels by distance to current price (closest first)
    const sortedLevels = [...structureM15.levels].sort(
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

      // Scalp (M15): radius 1.0%, Counter: radius 1.5%
      const maxDist = tier === 2 ? 1.0 : 1.5;
      if (distPct > maxDist) continue;

      // Skip jika tier ini sudah ada (ambil yang terdekat saja)
      if (tier === 2 && tier2Added) continue;
      if (tier === 3 && tier3Added) continue;

      // SL dengan floor minimum agar TP tidak dimakan spread
      const atrSl = atrM15 > 0 ? atrM15 * ENGINE_CONFIG.atrMultiplier.scalp : exactEntry * 0.003;
      const minSl = exactEntry * (ENGINE_CONFIG.minSlPct / 100);
      const slDist = Math.max(atrSl, minSl);
      const sl = type === "BUY" ? exactEntry - slDist : exactEntry + slDist;

      // TP berdasarkan S/R level real — bukan sekadar SL × multiplier
      let tp1: number, tp2: number;
      const fbTp1 = type === "BUY" ? exactEntry + slDist * 2 : exactEntry - slDist * 2;
      const fbTp2 = type === "BUY" ? exactEntry + slDist * 3.5 : exactEntry - slDist * 3.5;

      if (structureM15.levels && structureM15.levels.length > 1) {
        const otherLevels = structureM15.levels.filter(l => l.price !== exactEntry);
        if (type === "BUY") {
          // BUY → TP di RESISTANCE/KEY ZONE di atas entry
          const targets = otherLevels
            .filter(l => (l.type === "RESISTANCE" || l.type === "KEY ZONE") && l.price > exactEntry + slDist * 0.5)
            .sort((a, b) => a.price - b.price);
          tp1 = targets[0]?.price ?? fbTp1;
          tp2 = targets[1]?.price ?? fbTp2;
        } else {
          // SELL → TP di SUPPORT/KEY ZONE di bawah entry
          const targets = otherLevels
            .filter(l => (l.type === "SUPPORT" || l.type === "KEY ZONE") && l.price < exactEntry - slDist * 0.5)
            .sort((a, b) => b.price - a.price);
          tp1 = targets[0]?.price ?? fbTp1;
          tp2 = targets[1]?.price ?? fbTp2;
        }
      } else {
        tp1 = fbTp1;
        tp2 = fbTp2;
      }

      // Pastikan minimum RR 1:1.5
      if (type === "BUY" && tp1 - exactEntry < slDist * 1.5) tp1 = exactEntry + slDist * 1.5;
      if (type === "SELL" && exactEntry - tp1 < slDist * 1.5) tp1 = exactEntry - slDist * 1.5;

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
        note: confidence >= 55
          ? (distPct <= 0.3 ? "Harga dekat level! Siapkan Limit Order." : "Pasang Limit Order di S/R. Tunggu harga mendekati.")
          : "Pantau level ini. Konfirmasi masih lemah.",
        reasoning: `Pantulan ${tier === 2 ? 'searah' : 'counter'} tren | Jarak: ${distPct.toFixed(2)}% | ATR M15: ${Math.round(atrM15)} | ${modNotes.join(' | ')}`,
        confidence, zone: exactEntry.toFixed(1),
        sl: sl.toFixed(1), tp1: tp1.toFixed(1), tp2: tp2.toFixed(1),
        // FIX BUG #5: Tampilkan RR ke TP1 (lebih relevan untuk scalper), bukan TP2
        rr: calcRR(exactEntry, sl, tp1)
      });

      if (tier === 2) tier2Added = true;
      if (tier === 3) tier3Added = true;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SAFEGUARD: Jika Tier 2 kosong, pakai level H1 terdekat sebagai scalp
  // Jika tidak ada level sama sekali, tampilkan WAIT
  // ═══════════════════════════════════════════════════════════════════
  if (!tier2Added) {
    const t2type: "BUY" | "SELL" = localTrend === "UP" ? "BUY" : localTrend === "DOWN" ? "SELL" : "BUY";

    // Coba ambil level H1 terdekat (searah tren) sebagai fallback scalp
    if (structureM15.levels && structureM15.levels.length > 0) {
      const fallbackLevels = structureM15.levels
        .filter(l => t2type === "BUY" ? l.type === "SUPPORT" : l.type === "RESISTANCE")
        .sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));

      const fb = fallbackLevels[0];
      if (fb) {
        const fbEntry = fb.price;
        const fbDistPct = (Math.abs(currentPrice - fbEntry) / currentPrice) * 100;

        // Fallback scalp max 1.5%
        if (fbDistPct <= 1.5) {
          const fbSlDist = Math.max(atrM15 * ENGINE_CONFIG.atrMultiplier.scalp, fbEntry * (ENGINE_CONFIG.minSlPct / 100));
          const fbSl = t2type === "BUY" ? fbEntry - fbSlDist : fbEntry + fbSlDist;
          const fbTp1 = t2type === "BUY" ? fbEntry + fbSlDist * 2 : fbEntry - fbSlDist * 2;
          const fbTp2 = t2type === "BUY" ? fbEntry + fbSlDist * 3.5 : fbEntry - fbSlDist * 3.5;
          const fbConf = Math.max(10, 55 - Math.round(fbDistPct * 8));
          const { confidence: fbFinalConf, modNotes: fbMods } = applyModifiers(fbConf, t2type, false);

          suggestions.push({
            type: t2type, tier: 2,
            label: `LIMIT SCALP @ ${Math.round(fbEntry)}`,
            note: `Pasang limit order di ${t2type === "BUY" ? "support" : "resistance"} terdekat. Jarak ${fbDistPct.toFixed(1)}% dari harga.`,
            reasoning: `Pantulan searah tren (fallback) | Jarak: ${fbDistPct.toFixed(2)}% | ATR M15: ${Math.round(atrM15)} | ${fbMods.join(' | ')}`,
            confidence: fbFinalConf,
            zone: fbEntry.toFixed(1),
            sl: fbSl.toFixed(1), tp1: fbTp1.toFixed(1), tp2: fbTp2.toFixed(1),
            rr: calcRR(fbEntry, fbSl, fbTp1)
          });
          tier2Added = true;
        }
      }
    }

    // Jika benar-benar tidak ada level sama sekali
    if (!tier2Added) {
      suggestions.push({
        type: "WAIT", tier: 2,
        label: "MENUNGGU LEVEL TERDEKAT",
        note: `Menunggu harga mendekati Support/Resistance searah tren (${localTrend}).`,
        reasoning: `Tidak ada S/R terdeteksi saat ini. ${session.label}`,
        confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---"
      });
    }
  }

  if (!tier3Added) {
    // Coba pakai level counter-tren terdekat sebagai fallback
    if (structureM15.levels && structureM15.levels.length > 0) {
      const t3type: "BUY" | "SELL" = localTrend === "UP" ? "SELL" : "BUY";
      const fallbackCounter = structureM15.levels
        .filter(l => t3type === "BUY" ? l.type === "SUPPORT" : l.type === "RESISTANCE")
        .sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));

      const fb3 = fallbackCounter[0];
      if (fb3) {
        const fb3Entry = fb3.price;
        const fb3DistPct = (Math.abs(currentPrice - fb3Entry) / currentPrice) * 100;

        // Counter fallback max 2.0%
        if (fb3DistPct <= 2.0) {
          const fb3SlDist = Math.max(atrM15 * ENGINE_CONFIG.atrMultiplier.scalp, fb3Entry * (ENGINE_CONFIG.minSlPct / 100));
          const fb3Sl = t3type === "BUY" ? fb3Entry - fb3SlDist : fb3Entry + fb3SlDist;
          const fb3Tp1 = t3type === "BUY" ? fb3Entry + fb3SlDist * 2 : fb3Entry - fb3SlDist * 2;
          const fb3Tp2 = t3type === "BUY" ? fb3Entry + fb3SlDist * 3 : fb3Entry - fb3SlDist * 3;
          const fb3Conf = Math.max(10, 45 - Math.round(fb3DistPct * 10));
          const { confidence: fb3FinalConf, modNotes: fb3Mods } = applyModifiers(fb3Conf, t3type, true);

          suggestions.push({
            type: t3type, tier: 3,
            label: `LIMIT SCALP @ ${Math.round(fb3Entry)}`,
            note: "Pantau level ini. Konfirmasi masih lemah.",
            reasoning: `Counter tren (fallback) | Jarak: ${fb3DistPct.toFixed(2)}% | ATR M15: ${Math.round(atrM15)} | ${fb3Mods.join(' | ')}`,
            confidence: fb3FinalConf,
            zone: fb3Entry.toFixed(1),
            sl: fb3Sl.toFixed(1), tp1: fb3Tp1.toFixed(1), tp2: fb3Tp2.toFixed(1),
            rr: calcRR(fb3Entry, fb3Sl, fb3Tp1)
          });
          tier3Added = true;
        }
      }
    }

    if (!tier3Added) {
      suggestions.push({
        type: "WAIT", tier: 3,
        label: "MENUNGGU PELUANG COUNTER",
        note: "Menunggu harga menyentuh level counter-tren untuk scalp pantulan.",
        reasoning: `Tidak ada level counter terdeteksi. ${session.label}`,
        confidence: 0, zone: "---", sl: "---", tp1: "---", tp2: "---", rr: "---"
      });
    }
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
