// alertEngine.ts — Smart Alert System for Omega BTC
// Only fires on HIGH CONFIDENCE signals (reads threshold from ENGINE_CONFIG)

import { ENGINE_CONFIG } from '../constants';

export type AlertLevel = "CRITICAL" | "HIGH" | "MODERATE" | "NONE";

export interface SmartAlert {
  level: AlertLevel;
  shouldFire: boolean;
  reason: string;
}

// Determine alert level based on signal confidence & tier
export function getAlertLevel(confidence: number, tier: number): SmartAlert {
  const threshold = ENGINE_CONFIG.minConfidenceForAlert; // default 75
  if (tier === 1 && confidence >= threshold + 10) {
    return { level: "CRITICAL", shouldFire: true, reason: `TIER 1 — Confidence ${confidence}% (≥${threshold + 10}%)` };
  }
  if (tier <= 2 && confidence >= threshold) {
    return { level: "HIGH", shouldFire: true, reason: `TIER ${tier} — Confidence ${confidence}% (≥${threshold}%)` };
  }
  if (tier === 3 && confidence >= threshold - 17) {
    return { level: "MODERATE", shouldFire: false, reason: `TIER 3 — Confidence ${confidence}% (terlalu rendah untuk alert)` };
  }
  return { level: "NONE", shouldFire: false, reason: `Confidence ${confidence}% di bawah threshold alert (${threshold}%)` };
}

// Web Audio API — generate powerful alert sound
function createAlertSound(ctx: AudioContext, level: AlertLevel): void {
  const now = ctx.currentTime;

  if (level === "CRITICAL") {
    // 3x sharp beep — fast, loud, urgent
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(880, now + i * 0.25);
      osc.frequency.exponentialRampToValueAtTime(440, now + i * 0.25 + 0.15);
      gain.gain.setValueAtTime(0.8, now + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.2);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.2);
    }
  } else if (level === "HIGH") {
    // 2x smooth beep — clear but not panic
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, now + i * 0.35);
      gain.gain.setValueAtTime(0.6, now + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.35 + 0.28);
      osc.start(now + i * 0.35);
      osc.stop(now + i * 0.35 + 0.3);
    }
  }
}

let audioCtx: AudioContext | null = null;

export function playAlertSound(level: AlertLevel): void {
  if (level === "NONE" || level === "MODERATE") return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    createAlertSound(audioCtx, level);
  } catch (e) {
    console.warn("Alert sound failed:", e);
  }
}

// Smart voice alert — hanya bicara kalau worth it
export function speakSmartAlert(type: "BUY" | "SELL", zone: string, level: AlertLevel, confidence: number): void {
  if (!window.speechSynthesis || level === "NONE" || level === "MODERATE") return;

  const priority = level === "CRITICAL" ? "CRITICAL SIGNAL! " : "HIGH CONFIDENCE SIGNAL! ";
  const zoneSpoken = zone.split('').map(c => c === '.' ? ' point ' : c).join(', ');
  const msg = `${priority}${type} signal at ${zoneSpoken}. Confidence ${confidence} percent. Check terminal now.`;

  // Cancel previous speech
  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(msg);
  utt.lang = 'en-US';
  utt.rate = level === "CRITICAL" ? 0.9 : 0.85;
  utt.pitch = level === "CRITICAL" ? 1.2 : 1.0;
  utt.volume = 1.0;
  window.speechSynthesis.speak(utt);
}
