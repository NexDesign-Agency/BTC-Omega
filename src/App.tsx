import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SignalResult, KlineData } from "./lib/signalEngine";
import { getAlertLevel, playAlertSound, speakSmartAlert } from "./lib/alertEngine";
import { addSignalToHistory, loadHistory, calcWinRate } from "./lib/historyEngine";
import { analyzeTFDirection, getSessionInfo, type TFDirection, type SessionInfo } from "./lib/analysisUtils";
import { checkSignalOutcomes } from "./lib/outcomeEngine";
import { ENGINE_CONFIG } from "./constants";
import { fetchAIAnalysis, aiResultToSuggestions, type AIAnalysisResult } from "./lib/openRouterService";
import HistoryPanel from "./components/HistoryPanel";
import SettingsModal from "./components/SettingsModal";
import AIChat from "./components/AIChat";
import {
  TrendingUp,
  Zap,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Settings,
  Bot
} from "lucide-react";

// TradingView widget script loader
const useTradingView = (containerId: string, isActive: boolean, hideToolbar: boolean) => {
  useEffect(() => {
    if (!isActive) return;

    const initWidget = () => {
      const container = document.getElementById(containerId);
      if (container && window.TradingView) {
        container.innerHTML = '';
        try {
          new window.TradingView.widget({
            autosize: true,
            symbol: "BINANCE:BTCUSDT",
            interval: "15",
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "en",
            toolbar_bg: "#05070a",
            enable_publishing: false,
            hide_side_toolbar: hideToolbar,
            allow_symbol_change: false,
            save_image: false,
            header_widget_buttons_mode: "adaptive",
            container_id: containerId,
          });
        } catch (e) {
          console.error("TradingView widget init error:", e);
        }
      }
    };

    if (window.TradingView) {
      initWidget();
    } else {
      const existingScript = document.getElementById("tradingview-widget-script");
      if (!existingScript) {
        const script = document.createElement("script");
        script.id = "tradingview-widget-script";
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initWidget;
        document.head.appendChild(script);
      } else {
        const interval = setInterval(() => {
          if (window.TradingView) {
            initWidget();
            clearInterval(interval);
          }
        }, 500);
        return () => clearInterval(interval);
      }
    }
  }, [containerId, isActive, hideToolbar]);
};

interface MarketAnalysis {
  price: number;
  signal: {
    type: "BUY" | "SELL" | "WAIT";
    tier: number;
    confidence: number;
    zone: string;
    sl: string;
    tp1: string;
    tp2: string;
    rr: string;
  };
  suggestions: SignalResult[];
  reasoning: string;
  tfDirections?: Record<string, TFDirection>;
  session?: SessionInfo;
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showChartToolbar, setShowChartToolbar] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [highlightTrigger, setHighlightTrigger] = useState(0);
  const [mobileActiveTab, setMobileActiveTab] = useState<"CHART" | "SIGNAL" | "CHAT">("SIGNAL");
  const [showHistory, setShowHistory] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [quickWinRate, setQuickWinRate] = useState<number | null>(null);
  const [showLevelLines, setShowLevelLines] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState(() => localStorage.getItem('omega_openrouter_key') || '');
  const [openRouterModel, setOpenRouterModel] = useState(() => localStorage.getItem('omega_openrouter_model') || 'deepseek/deepseek-r1:free');
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const h4KlinesRef = useRef<any[]>([]);
  const h1KlinesRef = useRef<any[]>([]);
  const m15KlinesRef = useRef<any[]>([]);
  const m5KlinesRef = useRef<any[]>([]);
  const lastSignalKeyRef = useRef<string>("");
  const alertReadyRef = useRef(false); // Cooldown: no alerts until 10s after app start

  useTradingView("tv_chart_container", !showSplash, !showChartToolbar);

  const enterTerminal = () => {
    setShowSplash(false);
    speakSmartAlert("BUY", "0", "NONE", 0); // warm up
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance("Welcome to BTC USD Signal Omega. Pure Price Action mode active."), { lang: 'en-US', rate: 0.85 }));
    const h = loadHistory();
    const s = calcWinRate(h);
    if (s.total > 0) setQuickWinRate(s.winRate);
    // Enable alerts after 10s cooldown
    setTimeout(() => { alertReadyRef.current = true; }, 10000);
  };

  useEffect(() => {
    if (!showSplash) return;
    if (countdown <= 0) {
      enterTerminal();
      return;
    }
    const timer = setInterval(() => setCountdown(p => p - 1), 1000);
    return () => clearInterval(timer);
  }, [showSplash, countdown]);

  const fireSmartAlert = (type: "BUY" | "SELL", zone: string, confidence: number, tier: number) => {
    if (!alertReadyRef.current) return; // Cooldown belum selesai
    const { shouldFire, level } = getAlertLevel(confidence, tier);
    if (!shouldFire) return;
    playAlertSound(level);
    speakSmartAlert(type, zone, level, confidence);
  };

  const runAnalysis = async () => {
    setLoading(true);
    setAiLoading(true);
    try {
      let currentPrice = 0;
      let h4Raw: any[] = [], h1Raw: any[] = [], m15Raw: any[] = [], m5Raw: any[] = [];

      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (binanceRes.ok) {
          const d = await binanceRes.json();
          currentPrice = parseFloat(d.price);
        }

        const fetchTF = async (interval: string, limit = 150) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
          if (res.ok) return await res.json();
          return [];
        };

        [m5Raw, m15Raw, h1Raw, h4Raw] = await Promise.all([
          fetchTF('5m', 200), fetchTF('15m', 150), fetchTF('1h', 150), fetchTF('4h', 150)
        ]);
      } catch (e) {
        console.warn("Failed to fetch from Binance", e);
      }

      h4KlinesRef.current = h4Raw;
      h1KlinesRef.current = h1Raw;
      m15KlinesRef.current = m15Raw;
      m5KlinesRef.current = m5Raw;

      const kd: KlineData = { m5: m5Raw, m15: m15Raw, h1: h1Raw, h4: h4Raw };

      // TF directions for strip (offline - tetap dibutuhkan)
      const tfDirs: Record<string, TFDirection> = {};
      if (h4Raw.length >= 52) tfDirs.H4 = analyzeTFDirection(h4Raw, currentPrice);
      if (h1Raw.length >= 52) tfDirs.H1 = analyzeTFDirection(h1Raw, currentPrice);
      if (m15Raw.length >= 52) tfDirs.M15 = analyzeTFDirection(m15Raw, currentPrice);
      if (m5Raw.length >= 52) tfDirs.M5 = analyzeTFDirection(m5Raw, currentPrice);
      const session = getSessionInfo();

      if (openRouterKey && currentPrice) {
        // ── AI MODE: Gunakan OpenRouter untuk analisis ────────────
        try {
          const aiResult = await fetchAIAnalysis(currentPrice, kd, openRouterKey, openRouterModel);
          if (aiResult) {
            setAiAnalysis(aiResult);
            const aiSugs = aiResultToSuggestions(aiResult);
            setAnalysis({
              price: currentPrice,
              signal: {
                type: aiSugs[0]?.type ?? 'WAIT',
                tier: 1,
                confidence: aiResult.primaryEntry.confidence,
                zone: aiResult.primaryEntry.entry,
                sl: aiResult.primaryEntry.sl,
                tp1: aiResult.primaryEntry.tp1,
                tp2: aiResult.primaryEntry.tp2,
                rr: aiResult.primaryEntry.rr,
              },
              suggestions: aiSugs,
              reasoning: aiResult.primaryEntry.reasoning,
              tfDirections: Object.fromEntries(
                Object.entries(aiResult.tfDirections).map(([k, v]) => [k, v as TFDirection])
              ),
              session,
            });
            setHighlightTrigger(prev => prev + 1);

            // Record AI signals to history
            const history = loadHistory();
            const updates = checkSignalOutcomes(currentPrice, history);
            if (updates.length > 0) {
              setHistoryRefresh(prev => prev + 1);
              setQuickWinRate(calcWinRate(loadHistory()).winRate || null);
            }
            aiSugs.forEach(s => {
              if (s.type !== "WAIT" && s.confidence >= ENGINE_CONFIG.minConfidenceForRecord) {
                const result = addSignalToHistory({
                  type: s.type as 'BUY' | 'SELL',
                  tier: s.tier,
                  confidence: s.confidence,
                  label: s.label,
                  zone: s.zone,
                  sl: s.sl,
                  tp1: s.tp1,
                  tp2: s.tp2,
                  rr: s.rr
                });
                if (!result.isDupe) {
                  fireSmartAlert(s.type as 'BUY' | 'SELL', s.zone, s.confidence, s.tier);
                  setHistoryRefresh(prev => prev + 1);
                }
              }
            });
          }
        } catch (aiErr) {
          console.error("AI analysis failed:", aiErr);
          setAiAnalysis(null);
          setAnalysis({
            price: currentPrice,
            signal: { type: 'WAIT', tier: 0, confidence: 0, zone: '---', sl: '---', tp1: '---', tp2: '---', rr: '---' },
            suggestions: [],
            reasoning: `AI Error: ${aiErr instanceof Error ? aiErr.message : 'Gagal menghubungi AI. Coba lagi.'}`,
            tfDirections: tfDirs,
            session,
          });
        }
      } else {
        // ── NO API KEY: Tampilkan placeholder ─────────────────────
        setAiAnalysis(null);
        setAnalysis({
          price: currentPrice,
          signal: { type: 'WAIT', tier: 0, confidence: 0, zone: '---', sl: '---', tp1: '---', tp2: '---', rr: '---' },
          suggestions: [],
          reasoning: 'Setup OpenRouter API key di tombol AI SETUP untuk mulai analisis.',
          tfDirections: tfDirs,
          session,
        });
      }
    } catch (err) {
      console.error("Analysis Error:", err);
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();

    const fetchBackgroundData = async () => {
      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        let newPrice = 0;
        if (binanceRes.ok) {
          const d = await binanceRes.json();
          newPrice = parseFloat(d.price);
        }

        const fetchTF = async (interval: string, limit = 150) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
          if (res.ok) return await res.json();
          return [];
        };

        const [m5, m15, h1, h4] = await Promise.all([
          fetchTF('5m', 200), fetchTF('15m', 150), fetchTF('1h', 150), fetchTF('4h', 150)
        ]);
        h4KlinesRef.current = h4;
        h1KlinesRef.current = h1;
        m15KlinesRef.current = m15;
        m5KlinesRef.current = m5;

        if (newPrice && m15.length > 0) {
          const tfDirs: Record<string, TFDirection> = {};
          if (h4.length >= 52) tfDirs.H4 = analyzeTFDirection(h4, newPrice);
          if (h1.length >= 52) tfDirs.H1 = analyzeTFDirection(h1, newPrice);
          if (m15.length >= 52) tfDirs.M15 = analyzeTFDirection(m15, newPrice);
          if (m5.length >= 52) tfDirs.M5 = analyzeTFDirection(m5, newPrice);

          setAnalysis(prev => ({
            ...prev,
            price: newPrice,
            tfDirections: tfDirs,
            session: getSessionInfo(),
          }) as MarketAnalysis);
        }
      } catch (err) {}
    };

    // FIX BUG #4: Gunakan setTimeout rekursif bukan setInterval
    // agar fetch berikutnya BARU dimulai setelah fetch sebelumnya selesai
    let bgTimeoutId: ReturnType<typeof setTimeout>;
    const scheduleBg = () => { bgTimeoutId = setTimeout(async () => { await fetchBackgroundData(); scheduleBg(); }, 3000); };
    scheduleBg();
    return () => clearTimeout(bgTimeoutId);
  }, []);

  if (showSplash) {
    return (
      <div className="min-h-[100dvh] w-screen bg-[#05070a] text-white flex flex-col relative overflow-hidden font-sans select-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(0,255,136,0.08),transparent_70%)] opacity-60 pointer-events-none" />
        <div className="relative z-10 flex flex-col flex-1 max-w-7xl mx-auto px-6 md:px-16 py-8 md:py-24">
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-10 duration-1000">
            <h1 className="text-4xl md:text-8xl font-black italic tracking-tighter leading-[0.85] mb-8">
              PURE PRICE ACTION <br />
              <span className="text-bull text-glow uppercase">SIGNAL OMEGA</span>
            </h1>
            <button
              onClick={enterTerminal}
              className="px-8 md:px-12 py-5 border-2 border-bull text-bull hover:bg-bull hover:text-black font-black text-lg md:text-xl italic tracking-widest rounded-xl transition-all active:scale-95 shadow-[0_0_30px_rgba(0,255,136,0.2)] mb-8"
            >
              ENTER TERMINAL
            </button>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">Auto-redirecting in</span>
              <span className="w-5 h-5 flex items-center justify-center bg-bull/20 rounded border border-bull/30 text-bull font-mono text-xs font-bold">{countdown}s</span>
              </div>
            </div>
          </div>

          {/* Right: AI Live Chat Panel */}
          <div className={`
              ${mobileActiveTab === 'CHAT' ? 'col-span-12 flex' : 'hidden'}
              lg:flex lg:col-span-3 flex-col h-full w-full
            `}>
            <AIChat apiKey={openRouterKey} model={openRouterModel} />
          </div>
        </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-trading-bg text-slate-300 flex flex-col font-sans overflow-hidden">
      {/* Header Bar */}
      <header className="h-14 border-b border-trading-border bg-trading-panel/80 backdrop-blur-md flex items-center justify-between px-3 md:px-4 z-50">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="bg-bull/10 p-2 rounded-md border border-bull/30 shadow-[0_0_10px_rgba(0,255,136,0.2)]">
            <TrendingUp size={16} className="text-bull md:w-5 md:h-5" />
          </div>
          <div>
            <h1 className="font-black text-white tracking-widest text-[11px] md:text-sm italic uppercase italic">BTCUSD <span className="text-bull underline decoration-bull/40 decoration-wavy">SIGNAL OMEGA</span></h1>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-8">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] uppercase tracking-widest font-bold opacity-40">BTC PRICE</p>
            <p className="text-sm md:text-xl font-mono font-black text-white tracking-tighter">
              {analysis?.price ? `$${analysis.price.toLocaleString()}` : "---"}
            </p>
          </div>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="flex items-center gap-2 px-3 md:px-4 py-2 bg-bull hover:bg-bull/90 border border-bull rounded-md text-[10px] md:text-xs font-black text-black transition-all active:scale-95 disabled:opacity-50 shadow-[0_0_20px_rgba(0,255,136,0.4)]"
          >
            {aiLoading ? <RefreshCw size={12} className="animate-spin md:w-3.5 md:h-3.5" /> : <Bot size={12} className="md:w-3.5 md:h-3.5" />}
            <span className="hidden sm:inline">{aiLoading ? "AI ANALYZING..." : openRouterKey ? "AI ANALYZE" : "SCAN MARKET"}</span>
            <span className="inline sm:hidden">{aiLoading ? "AI" : openRouterKey ? "AI" : "SCAN"}</span>
          </button>
          {/* ── AI SETTINGS BUTTON ── */}
          <button
            onClick={() => setShowSettings(true)}
            className={`relative flex items-center gap-1.5 px-3 py-2 border rounded-md text-[10px] font-black transition-all ${
              openRouterKey
                ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                : 'bg-white/5 hover:bg-white/10 border-trading-border text-slate-400 hover:text-white'
            }`}
            title="AI Configuration"
          >
            <Settings size={12} />
            <span className="hidden sm:inline">AI SETUP</span>
            {openRouterKey && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent animate-pulse" />
            )}
          </button>
          {/* ── PLOT LEVELS BUTTON ── */}
          {analysis && (
            <button
              onClick={() => setShowLevelLines(v => !v)}
              className={`relative flex items-center gap-1.5 px-3 py-2 border rounded-md text-[10px] font-black transition-all ${
                showLevelLines
                  ? 'bg-bull/20 border-bull/60 text-bull shadow-[0_0_12px_rgba(0,255,136,0.3)]'
                  : 'bg-white/5 hover:bg-white/10 border-trading-border text-slate-400 hover:text-white'
              }`}
              title="Toggle Signal Level Lines on Chart"
            >
              {showLevelLines ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6h8M1 3h10M1 9h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M10 2L2 10" stroke="#ff4466" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6h8M1 3h10M1 9h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
              <span className="hidden sm:inline">{showLevelLines ? 'HIDE LINES' : 'PLOT LEVELS'}</span>
            </button>
          )}
          <button
            onClick={() => setShowHistory(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-trading-border rounded-md text-[10px] font-black text-slate-400 hover:text-white transition-all"
            title="Signal History & Win Rate"
          >
            <Trophy size={12} className="text-warning" />
            <span className="hidden sm:inline">HISTORY</span>
            {quickWinRate !== null && (
              <span className="absolute -top-1 -right-1 text-[8px] font-black bg-bull text-black rounded-full px-1 leading-4">
                {quickWinRate}%
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <main className="flex-1 flex flex-col overflow-hidden relative pb-16 lg:pb-0">

        {/* ── TF Indicator Strip + Session Badge ──────────────── */}
        <div className="h-[52px] border-b border-trading-border flex items-stretch bg-trading-panel/30 flex-shrink-0 overflow-x-auto no-scrollbar">
          {['H4','H1','M15','M5'].map(tf => {
            const dir = analysis?.tfDirections?.[tf];
            const dirLabel = dir?.direction ?? '...';
            const strength = dir?.strength ?? 0;
            const trendColor = dirLabel === 'UP' ? 'text-bull' : dirLabel === 'DOWN' ? 'text-bear' : 'text-warning';
            return (
              <div key={tf} className="min-w-[120px] flex-1 px-3 py-1.5 border-r border-trading-border flex flex-col justify-center">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded tracking-widest">{tf}</span>
                  <span className="text-[8px] font-mono text-slate-600">{strength > 0 ? `${strength}%` : dir ? '' : ''}</span>
                </div>
                <p className={`text-[11px] font-black tracking-tight mt-0.5 ${trendColor}`}>
                  {dirLabel === 'UP' ? '▲ BULLISH' : dirLabel === 'DOWN' ? '▼ BEARISH' : '◆ SIDEWAYS'}
                </p>
              </div>
            );
          })}
          {/* Session Badge */}
          <div className="min-w-[140px] px-3 py-1.5 flex flex-col justify-center bg-black/20">
            <span className="text-[8px] font-bold text-slate-600 tracking-widest">SESSION</span>
            <p className="text-[10px] font-black text-white/80 mt-0.5">{analysis?.session?.label ?? '...'}</p>
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 grid grid-cols-12 overflow-hidden relative">
          {/* Left: Chart Area */}
          <div className={`
              ${mobileActiveTab === 'CHART' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-5 border-r border-trading-border flex-col relative h-full w-full
            `}>
            {/* Drawing Toolbar Toggle */}
            <button
              onClick={() => setShowChartToolbar(!showChartToolbar)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-[60] w-4 h-12 bg-warning flex items-center justify-center rounded-r-sm shadow-lg border border-black/20 text-black transition-all hover:w-5 active:scale-95 group"
              title={showChartToolbar ? "Hide Drawing Tools" : "Show Drawing Tools"}
            >
              {showChartToolbar ? <ChevronLeft size={14} className="font-bold" /> : <ChevronRight size={14} className="font-bold" />}
            </button>

            {/* TRADING VIEW CHART CONTAINER */}
            <div className="flex-1 w-full bg-trading-bg relative overflow-hidden">
              <div id="tv_chart_container" className="h-full w-full" />

              {/* ── SIGNAL LEVEL LINES OVERLAY ── */}
              {showLevelLines && analysis && (() => {
                const sugs = analysis.suggestions || [];
                const p1 = sugs.find(s => s.tier === 1 && s.type !== 'WAIT');
                const p2 = sugs.find(s => s.tier === 2 && s.type !== 'WAIT');
                const p3 = sugs.find(s => s.tier === 3 && s.type !== 'WAIT');

                const rawPrices = [
                  p1?.zone, p1?.sl, p1?.tp1, p1?.tp2,
                  p2?.zone, p2?.sl, p2?.tp1,
                  p3?.zone, p3?.sl, p3?.tp1,
                  String(analysis.price)
                ].map(v => parseFloat(v || '0')).filter(v => v > 0);

                if (!rawPrices.length) return null;

                const hi = Math.max(...rawPrices) * 1.002;
                const lo = Math.min(...rawPrices) * 0.998;
                const rng = hi - lo;
                const pct = (price: number) => `${((hi - price) / rng) * 100}%`;

                type L = { price: number; lbl: string; clr: string; dash?: string; w?: number };
                const ls: L[] = [];

                const push = (sig: typeof p1, clr: string, tag: string) => {
                  if (!sig) return;
                  const e = parseFloat(sig.zone);
                  if (e > 0) ls.push({ price: e, lbl: `${tag}  $${e.toLocaleString(undefined,{maximumFractionDigits:0})}`, clr, w: 2 });
                };

                push(p1, '#00ff88', 'PRIMARY');
                push(p2, '#f59e0b', 'SCALP  ');
                push(p3, '#f43f5e', 'COUNTER');
                ls.push({ price: analysis.price, lbl: `NOW   $${analysis.price.toLocaleString(undefined,{maximumFractionDigits:0})}`, clr: '#ffffff', w: 1, dash: '2 2' });

                return (
                  <div className="absolute inset-0 z-20" style={{ pointerEvents: 'none' }}>
                    {/* X button */}
                    <button
                      style={{ pointerEvents: 'auto' }}
                      className="absolute top-2 right-2 z-30 w-7 h-7 rounded-full bg-black/90 border border-white/30 flex items-center justify-center text-white text-base font-black hover:bg-red-900/80 hover:border-red-400 transition-all"
                      onClick={() => setShowLevelLines(false)}
                      title="Hide level lines"
                    >×</button>

                    {/* Legend */}
                    <div className="absolute top-2 left-10 flex gap-3 bg-black/80 border border-white/10 rounded px-2 py-1.5 text-[9px] font-mono font-bold">
                      {p1 && <span style={{ color: '#00ff88' }}>● PRIMARY</span>}
                      {p2 && <span style={{ color: '#f59e0b' }}>● SCALP</span>}
                      {p3 && <span style={{ color: '#f43f5e' }}>● COUNTER</span>}
                    </div>

                    {/* SVG lines */}
                    <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
                      {ls.map((l, i) => {
                        const y = pct(l.price);
                        return (
                          <g key={i}>
                            <line x1="0" y1={y} x2="100%" y2={y}
                              stroke={l.clr} strokeWidth={l.w ?? 1.5}
                              strokeDasharray={l.dash ?? ''}
                              strokeOpacity="0.9"
                            />
                            <rect x="4" y={`calc(${y} - 10px)`} width="178" height="16" rx="3" fill="rgba(0,0,0,0.82)" />
                            <text x="8" y={`calc(${y} + 3px)`}
                              fill={l.clr} fontSize="9" fontFamily="monospace" fontWeight="bold"
                            >{l.lbl}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Right: AI Analysis Panel */}
          <div className={`
              ${mobileActiveTab === 'SIGNAL' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-4 flex-col bg-trading-panel overflow-y-auto no-scrollbar h-full w-full
            `}>
            
            {/* ── CARD 1: PRIMARY ENTRY ─────────────────────────────── */}
            {(() => {
              // FIX: Prioritaskan signal tier 1 NON-COUNTER (tidak ada "COUNTER" di label)
              // Jika ada dua tier 1 (counter + pullback), tampilkan yang searah tren
              const tier1All = (analysis?.suggestions || []).filter(s => s.tier === 1);
              const primary = tier1All.find(s => !s.label.includes('COUNTER')) ?? tier1All[0];
              const isBuy = primary?.type === 'BUY';
              const isSell = primary?.type === 'SELL';
              const color = isBuy ? '#00ff88' : isSell ? '#ff4466' : '#64748b';
              const bgColor = isBuy ? 'bg-bull/5' : isSell ? 'bg-bear/5' : 'bg-slate-800/30';
              const borderColor = isBuy ? 'border-bull/40' : isSell ? 'border-bear/40' : 'border-slate-700';
              return (
                <div className={`m-3 mb-0 rounded-xl border ${bgColor} ${borderColor} overflow-hidden flex-shrink-0`}>
                  <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center bg-black/20">
                    <span className="text-[10px] uppercase tracking-widest font-black opacity-70">🏛️ PRIMARY ENTRY (SWING)</span>
                    {primary && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-400">CONF</span>
                        <span className="text-sm font-black font-mono" style={{ color }}>{primary?.confidence}%</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-400">RR {primary?.rr}</span>
                      </div>
                    )}
                  </div>

                  {primary ? (
                    <div className="p-3">
                      <p className="font-black text-base tracking-tight mb-2" style={{ color }}>{primary.label}</p>
                      <div className="grid grid-cols-4 gap-1 mb-2">
                        {[
                          { label: 'ENTRY', value: primary.zone, col: '#94a3b8' },
                          { label: 'SL', value: primary.sl, col: '#ff4466' },
                          { label: 'TP1', value: primary.tp1, col: color },
                          { label: 'TP2', value: primary.tp2, col: color },
                        ].map(({ label, value, col }) => (
                          <div key={label} className="p-1.5 bg-trading-bg/80 rounded border border-trading-border text-center">
                            <p className="text-[7px] uppercase tracking-widest mb-0.5" style={{ color: col, opacity: 0.6 }}>{label}</p>
                            <p className="text-[10px] font-mono font-black" style={{ color: col }}>{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] font-medium leading-snug" style={{ color, opacity: 0.8 }}>{primary.note}</p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-slate-500 text-[11px]">
                        {analysis ? 'Menunggu harga mencapai level ekstrem H1 atau ledakan breakout.' : 'Tunggu hasil pemindaian...'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── CARD 2: SCALP SEARAH TREN ─────────────────────────── */}
            {(() => {
              const scalpTrend = (analysis?.suggestions || []).find(s => s.tier === 2);
              const isBuy = scalpTrend?.type === 'BUY';
              const isSell = scalpTrend?.type === 'SELL';
              const color = isBuy ? '#00ff88' : isSell ? '#ff4466' : '#eab308';
              const bgColor = scalpTrend ? (isBuy ? 'bg-bull/5' : 'bg-bear/5') : 'bg-slate-800/20';
              const borderColor = scalpTrend ? (isBuy ? 'border-bull/30' : 'border-bear/30') : 'border-slate-700/50';
              return (
                <div className={`m-3 mb-0 rounded-xl border ${bgColor} ${borderColor} overflow-hidden flex-shrink-0`}>
                  <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center bg-black/20">
                    <span className="text-[10px] uppercase tracking-widest font-black opacity-70">🌊 SCALP (SEARAH TREN)</span>
                    {scalpTrend && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-400">CONF</span>
                        <span className="text-sm font-black font-mono" style={{ color }}>{scalpTrend?.confidence}%</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-400">RR {scalpTrend?.rr}</span>
                      </div>
                    )}
                  </div>

                  {scalpTrend ? (
                    <div className="p-3">
                      <p className="font-black text-base tracking-tight mb-2" style={{ color }}>{scalpTrend.label}</p>
                      <div className="grid grid-cols-4 gap-1 mb-2">
                        {[
                          { label: 'ENTRY', value: scalpTrend.zone, col: '#94a3b8' },
                          { label: 'SL', value: scalpTrend.sl, col: '#ff4466' },
                          { label: 'TP1', value: scalpTrend.tp1, col: color },
                          { label: 'TP2', value: scalpTrend.tp2, col: color },
                        ].map(({ label, value, col }) => (
                          <div key={label} className="p-1.5 bg-trading-bg/80 rounded border border-trading-border text-center">
                            <p className="text-[7px] uppercase tracking-widest mb-0.5" style={{ color: col, opacity: 0.6 }}>{label}</p>
                            <p className="text-[10px] font-mono font-black" style={{ color: col }}>{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] font-medium leading-snug" style={{ color, opacity: 0.8 }}>{scalpTrend.note}</p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-slate-500 text-[11px] font-medium">
                        {analysis ? 'Menunggu harga mendekati Support/Resistance searah tren.' : 'Tunggu hasil pemindaian...'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── CARD 3: SCALP COUNTER TREN ─────────────────────────── */}
            {(() => {
              const scalpCounter = (analysis?.suggestions || []).find(s => s.tier === 3);
              const isBuy = scalpCounter?.type === 'BUY';
              const isSell = scalpCounter?.type === 'SELL';
              const color = isBuy ? '#00ff88' : isSell ? '#ff4466' : '#eab308';
              const bgColor = scalpCounter ? (isBuy ? 'bg-bull/5' : 'bg-bear/5') : 'bg-slate-800/20';
              const borderColor = scalpCounter ? (isBuy ? 'border-bull/30' : 'border-bear/30') : 'border-slate-700/50';
              return (
                <div className={`m-3 mb-3 rounded-xl border ${bgColor} ${borderColor} overflow-hidden flex-shrink-0`}>
                  <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center bg-black/20">
                    <span className="text-[10px] uppercase tracking-widest font-black opacity-70">⚡ SCALP (COUNTER TREN)</span>
                    {scalpCounter && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-slate-400">CONF</span>
                        <span className="text-sm font-black font-mono" style={{ color }}>{scalpCounter?.confidence}%</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-400">RR {scalpCounter?.rr}</span>
                      </div>
                    )}
                  </div>

                  {scalpCounter ? (
                    <div className="p-3">
                      <p className="font-black text-base tracking-tight mb-2" style={{ color }}>{scalpCounter.label}</p>
                      <div className="grid grid-cols-4 gap-1 mb-2">
                        {[
                          { label: 'ENTRY', value: scalpCounter.zone, col: '#94a3b8' },
                          { label: 'SL', value: scalpCounter.sl, col: '#ff4466' },
                          { label: 'TP1', value: scalpCounter.tp1, col: color },
                          { label: 'TP2', value: scalpCounter.tp2, col: color },
                        ].map(({ label, value, col }) => (
                          <div key={label} className="p-1.5 bg-trading-bg/80 rounded border border-trading-border text-center">
                            <p className="text-[7px] uppercase tracking-widest mb-0.5" style={{ color: col, opacity: 0.6 }}>{label}</p>
                            <p className="text-[10px] font-mono font-black" style={{ color: col }}>{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] font-medium leading-snug" style={{ color, opacity: 0.8 }}>{scalpCounter.note}</p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-slate-500 text-[11px] font-medium">
                        {analysis ? 'Menunggu peluang pantulan di S/R (Ping-pong melawan arus).' : 'Tunggu hasil pemindaian...'}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── ADVICE Section ─────────────────────────────── */}
            <div className="mx-3 mb-3 rounded-xl border border-accent/30 bg-accent/5 overflow-hidden flex-shrink-0">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest font-black opacity-50">🧠 MARKET ANALYSIS {aiAnalysis ? '(AI-POWERED)' : '(OFFLINE)'}</span>
              </div>
              <div className="p-3 space-y-1.5">
                {(() => {
                  if (!analysis) return <p className="text-slate-500 text-[10px]">Tunggu hasil pemindaian...</p>;
                  if (aiAnalysis) {
                    // AI analysis: render as markdown-like text with line breaks
                    return aiAnalysis.marketAnalysis.split('\n').map((line, i) => (
                      <p key={i} className="text-[10px] font-medium text-slate-300 leading-relaxed">
                        {line || '\u00A0'}
                      </p>
                    ));
                  }
                  // Offline fallback
                  const advice = analysis.suggestions?.find(s => s.isAdvice);
                  const skip = analysis.suggestions?.find(s => s.isSkip);
                  return (
                    <>
                      {advice && advice.note.split('\n').map((line, i) => (
                        <p key={i} className="text-[10px] font-medium text-slate-300 leading-relaxed">{line}</p>
                      ))}
                      {skip && (
                        <p className="text-[10px] font-bold text-slate-400 mt-2 pt-2 border-t border-white/5">
                          ⚠️ {skip.reasoning}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ── Reasoning ─────────────────────────────────────────── */}
            <div className="px-3 pb-4 flex-1">
              <h3 className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-2">REASONING & BIAS</h3>
              <div className="space-y-2">
                {(analysis?.suggestions || []).filter(s => !s.isSkip && !s.isAdvice).map((s, i) => {
                  // FIX BUG #2: Pisahkan session label dari reasoning — tampilkan tanpa emoji Unicode yang bisa terpotong
                  const reasonParts = s.reasoning.split('|').map(p => p.trim()).filter(Boolean);
                  return (
                    <div key={i} className="text-[10px] font-medium text-slate-500 leading-relaxed border-l-2 pl-2"
                      style={{ borderColor: s.type === 'BUY' ? '#00ff88' : '#ff4466' }}>
                      {reasonParts.map((part, j) => (
                        <span key={j} className={j === 0 ? '' : 'opacity-70'}>
                          {j > 0 ? ' · ' : ''}{part}
                        </span>
                      ))}
                    </div>
                  );
                })}
                {(!analysis?.suggestions || analysis.suggestions.filter(s => !s.isSkip && !s.isAdvice).length === 0) && (
                  <p className="text-slate-600 text-[10px]">Tunggu hasil pemindaian...</p>
                )}
              </div>
            </div>
          </div>

          {/* Right: AI Live Chat Panel */}
          <div className={`
              ${mobileActiveTab === 'CHAT' ? 'col-span-12 flex' : 'hidden'}
              lg:flex lg:col-span-3 flex-col h-full w-full min-h-0 overflow-hidden
            `}>
            <AIChat
              apiKey={openRouterKey}
              model={openRouterModel}
              marketData={analysis ? {
                price: analysis.price,
                session: analysis.session,
                tfDirections: analysis.tfDirections,
                signal: analysis.signal,
                suggestions: analysis.suggestions,
                aiAnalysis,
              } : null}
            />
          </div>
        </div>

        {/* Bottom Navigation for Mobile */}
        <nav className="h-16 bg-trading-panel border-t border-trading-border mobile-nav items-center justify-around px-4 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
          {[
            { id: 'SIGNAL', label: 'SIGNALS', icon: <Zap size={20} className={mobileActiveTab === 'SIGNAL' ? 'text-bull' : 'text-slate-500'} /> },
            { id: 'CHART', label: 'CHART', icon: <TrendingUp size={20} className={mobileActiveTab === 'CHART' ? 'text-bull' : 'text-slate-500'} /> },
            { id: 'CHAT', label: 'AI CHAT', icon: <Bot size={20} className={mobileActiveTab === 'CHAT' ? 'text-bull' : 'text-slate-500'} /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileActiveTab(tab.id as 'CHART' | 'SIGNAL' | 'CHAT')}
              className={`flex flex-col items-center gap-1.5 w-16 transition-all duration-300
                ${mobileActiveTab === tab.id ? 'scale-110' : 'scale-100 hover:scale-105'}
              `}
            >
              <div className={`p-1 rounded-md transition-colors ${mobileActiveTab === tab.id ? 'bg-accent/10 border border-accent/20' : ''}`}>
                {tab.icon}
              </div>
              <span className={`text-[9px] font-bold tracking-widest ${mobileActiveTab === tab.id ? 'text-bull' : 'text-slate-500'}`}>
                {tab.label}
              </span>
            </button>
          ))}
        </nav>

        {/* Footer */}
        <footer className="h-6 bg-black border-t border-trading-border flex items-center justify-between px-3 md:px-4 z-[90] hidden lg:flex">
          <div className="flex items-center gap-3 md:gap-4">
            <span className="flex items-center gap-1.5 text-[8px] md:text-[9px] text-bull font-bold tracking-widest uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse" /> SYSTEM: ONLINE
            </span>
          </div>
          <p className="text-[7px] md:text-[8px] text-slate-600 font-mono tracking-widest uppercase">&copy; 2026 OMEGA INTEL. NOT FINANCIAL ADVICE</p>
        </footer>
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className="h-16 bg-trading-panel border-t border-trading-border mobile-nav items-center justify-around px-4 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]" style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', zIndex: 90 }}>
        {[
          { id: 'SIGNAL', label: 'SIGNALS', icon: <Zap size={20} className={mobileActiveTab === 'SIGNAL' ? 'text-bull' : 'text-slate-500'} /> },
          { id: 'CHART', label: 'CHART', icon: <TrendingUp size={20} className={mobileActiveTab === 'CHART' ? 'text-bull' : 'text-slate-500'} /> },
          { id: 'CHAT', label: 'AI CHAT', icon: <Bot size={20} className={mobileActiveTab === 'CHAT' ? 'text-bull' : 'text-slate-500'} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMobileActiveTab(tab.id as 'CHART' | 'SIGNAL' | 'CHAT')}
            className={`flex flex-col items-center gap-1.5 w-16 transition-all duration-300
              ${mobileActiveTab === tab.id ? 'scale-110' : 'scale-100 hover:scale-105'}
            `}
          >
            <div className={`p-1 rounded-md transition-colors ${mobileActiveTab === tab.id ? 'bg-accent/10 border border-accent/20' : ''}`}>
              {tab.icon}
            </div>
            <span className={`text-[9px] font-bold tracking-widest ${mobileActiveTab === tab.id ? 'text-bull' : 'text-slate-500'}`}>
              {tab.label}
            </span>
          </button>
        ))}
      </nav>

      {/* Slide-out History Panel */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel onClose={() => setShowHistory(false)} refreshTrigger={historyRefresh} />
        )}
      </AnimatePresence>

      {/* AI Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            apiKey={openRouterKey}
            model={openRouterModel}
            onSave={(key, mdl) => {
              setOpenRouterKey(key);
              setOpenRouterModel(mdl);
              localStorage.setItem('omega_openrouter_key', key);
              localStorage.setItem('omega_openrouter_model', mdl);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
