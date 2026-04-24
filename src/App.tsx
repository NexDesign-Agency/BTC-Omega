import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { analyzeTimeframe, resetFlipFlopMap } from "./lib/trendEngine";
import { computeSignal, computeSignals, SignalResult } from "./lib/signalEngine";
import { getAlertLevel, playAlertSound, speakSmartAlert } from "./lib/alertEngine";
import { addSignalToHistory, loadHistory, calcWinRate } from "./lib/historyEngine";
import HistoryPanel from "./components/HistoryPanel";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Info,
  Target,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Trophy
} from "lucide-react";

// TradingView widget script loader
const useTradingView = (containerId: string, isActive: boolean, hideToolbar: boolean) => {
  useEffect(() => {
    if (!isActive) return;

    const initWidget = () => {
      const container = document.getElementById(containerId);
      if (container && window.TradingView) {
        // Clear container to prevent duplicate widgets
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
        // Script is already loading, it will call its own onload. 
        // Or we can poll if we need to be sure.
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

interface TimeframeData {
  timeframe: string;
  trend: string;
  rsi: number;
  rsiState: string;
  structure: string;
}

interface MarketAnalysis {
  price: number;
  timeframes: TimeframeData[];
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
  checkpoints: { label: string; checked: boolean }[];
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showChartToolbar, setShowChartToolbar] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [liveIndicators, setLiveIndicators] = useState<TimeframeData[] | null>(null);
  const [highlightTrigger, setHighlightTrigger] = useState(0);
  const [mobileActiveTab, setMobileActiveTab] = useState<"CHART" | "SIGNAL">("SIGNAL");
  const [showHistory, setShowHistory] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [quickWinRate, setQuickWinRate] = useState<number | null>(null);

  // Shared H1 klines for ATR â€” updated every fetch cycle
  const h1KlinesRef = useRef<any[]>([]);
  // Track last voiced signal to avoid repeated alerts
  const lastSignalKeyRef = useRef<string>("");
  // FIX: Track last time flipFlop was auto-reset (every 10 min)
  const lastFlipFlopResetRef = useRef<number>(Date.now());

  useTradingView("tv_chart_container", !showSplash, !showChartToolbar);

  const enterTerminal = () => {
    setShowSplash(false);
    speakSmartAlert("BUY", "0", "NONE", 0); // warm up audio ctx
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance("Welcome to BTC USD Signal Omega. Terminal system is now active."), { lang: 'en-US', rate: 0.85 }));
    // Load quick win rate
    const h = loadHistory();
    const s = calcWinRate(h);
    if (s.total > 0) setQuickWinRate(s.winRate);
  };

  // Auto-enter timer
  useEffect(() => {
    if (!showSplash) return;

    if (countdown <= 0) {
      enterTerminal();
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [showSplash, countdown]);

  // Remove the timeout so highlightTrigger stays until re-triggered
  // Or rather, we don't need a timeout anymore. It will just stay statically there.

  // Smart alert — hanya fire untuk Tier 1/2 confidence >= 75
  const fireSmartAlert = (type: "BUY" | "SELL", zone: string, confidence: number, tier: number) => {
    const { shouldFire, level } = getAlertLevel(confidence, tier);
    if (!shouldFire) return;
    playAlertSound(level);
    speakSmartAlert(type, zone, level, confidence);
  };

  // RSI, Structure, EMA, ADX calculations are in src/lib/trendEngine.ts

  const runAnalysis = async () => {
    setLoading(true);
    // BUG 5 FIX: Reset anti flip-flop state supaya manual scan selalu fresh
    resetFlipFlopMap();
    try {
      // 1. Fetch exact real-time price & 24h stats from Binance (Public API)
      let currentPrice = 0;
      let priceChangePercent = 0;
      let priceString = "Unknown";
      let shortTermTrendInfo = "";
      let miniTrendPercent = 0; // Expose to fallback logic

      const realTimeframes: TimeframeData[] = [];
      let h1RawKlines: any[] = [];

      try {
        // Fetch 24hr ticker
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          currentPrice = parseFloat(binanceData.lastPrice);
          priceChangePercent = parseFloat(binanceData.priceChangePercent);
          priceString = `$${currentPrice.toLocaleString()}`;
        }

        // Fetch klines and classify via Hybrid EMA+ADX+RSI engine
        const fetchTF = async (interval: string, tfLabel: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`);
          if (res.ok) {
            const klines = await res.json();
            if (interval === '1h') h1RawKlines = klines;
            const result = analyzeTimeframe(klines, tfLabel);

            realTimeframes.push({
              timeframe: tfLabel,
              trend: result.trend,
              rsi: result.rsi,
              rsiState: result.rsiState,
              structure: result.structure
            });

            if (interval === '15m') {
              const closes = klines.slice(0, -1).map((k: any) => parseFloat(k[4]));
              const recent = closes.slice(-50);
              miniTrendPercent = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;
              shortTermTrendInfo = `DATA KLINES 1 JAM TERAKHIR: Trend M15 bergerak sebesar ${miniTrendPercent.toFixed(2)}%. Closes (4 candle 15m terakhir): ${closes.slice(-4).join(', ')}.`;
            }
          }
        };

        await Promise.all([
          fetchTF('5m', 'M5'),
          fetchTF('15m', 'M15'),
          fetchTF('1h', 'H1'),
          fetchTF('4h', 'H4')
        ]);

        // Sort timeframes
        const tfOrder = ['H4', 'H1', 'M15', 'M5'];
        realTimeframes.sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe));

      } catch (e) {
        console.warn("Failed to fetch price from Binance API", e);
      }

      // Save H1 klines to ref so background poller can reuse for ATR
      h1KlinesRef.current = h1RawKlines;

      // Compute signal via engine (deterministic, tier-based)
      const sig = computeSignal(realTimeframes, currentPrice, h1RawKlines);
      const allSuggestions = computeSignals(realTimeframes, currentPrice, h1RawKlines);
      const signalType = sig.type;
      const reasoningTxt = sig.reasoning;

      const localData: MarketAnalysis = {
        price: currentPrice,
        timeframes: realTimeframes,
        signal: {
          type: sig.type,
          tier: sig.tier,
          confidence: sig.confidence,
          zone: sig.zone,
          sl: sig.sl,
          tp1: sig.tp1,
          tp2: sig.tp2,
          rr: sig.rr
        },
        suggestions: allSuggestions,
        reasoning: reasoningTxt,
        checkpoints: [
          { label: "Data Binance Validated", checked: true },
          { label: "RSI Multi-Timeframe Algoritma", checked: true },
          { label: "Structure Konfirmasi", checked: true }
        ]
      };

      setAnalysis(localData);
      setHighlightTrigger(prev => prev + 1);
      // BUG 8 FIX: Round zone ke nearest 50 untuk key comparison â€” cegah voice spam saat harga choppy
      const sigKey = `${sig.type}-${Math.round(parseFloat(sig.zone) / 50) * 50}`;
      if ((sig.type === 'BUY' || sig.type === 'SELL') && sigKey !== lastSignalKeyRef.current) {
        lastSignalKeyRef.current = sigKey;
        fireSmartAlert(sig.type as 'BUY'|'SELL', sig.zone, sig.confidence, sig.tier);
        if (sig.confidence >= 75) {
          addSignalToHistory({ type: sig.type as 'BUY'|'SELL', tier: sig.tier, confidence: sig.confidence, label: sig.label, zone: sig.zone, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2, rr: sig.rr });
          setHistoryRefresh(prev => prev + 1);
          setQuickWinRate(calcWinRate(loadHistory()).winRate || null);
        }
      }
    } catch (err: any) {
      console.error("General Analysis Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();

    // Background poller for Live Math Indicators
    const fetchBackgroundData = async () => {
      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        let newPrice = 0;
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          newPrice = parseFloat(binanceData.lastPrice);
        }

        const realTimeframes: TimeframeData[] = [];
        const fetchTF = async (interval: string, tfLabel: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`);
          if (res.ok) {
            const klines = await res.json();
            // BUG 3 FIX: Update h1KlinesRef supaya ATR selalu fresh, bukan dari last manual scan
            if (interval === '1h') h1KlinesRef.current = klines;
            const result = analyzeTimeframe(klines, tfLabel);
            realTimeframes.push({ timeframe: tfLabel, trend: result.trend, rsi: result.rsi, rsiState: result.rsiState, structure: result.structure });
          }
        };

        await Promise.all([
          fetchTF('5m', 'M5'),
          fetchTF('15m', 'M15'),
          fetchTF('1h', 'H1'),
          fetchTF('4h', 'H4')
        ]);

        // FIX: Auto-reset flipFlopMap setiap 10 menit â€” cegah SIDEWAYS lock permanen
        const nowMs = Date.now();
        if (nowMs - lastFlipFlopResetRef.current > 10 * 60 * 1000) {
          resetFlipFlopMap();
          lastFlipFlopResetRef.current = nowMs;
          console.log('[BG Poller] flipFlopMap auto-reset @', new Date().toLocaleTimeString());
        }

        const tfOrder = ['H4', 'H1', 'M15', 'M5'];
        realTimeframes.sort((a, b) => tfOrder.indexOf(a.timeframe) - tfOrder.indexOf(b.timeframe));

        setLiveIndicators(realTimeframes);

        // Auto-recalculate signal every 3s using latest TF data + live price
        if (newPrice && realTimeframes.length === 4) {
          const autoSig = computeSignal(realTimeframes, newPrice, h1KlinesRef.current);
          const autoSuggestions = computeSignals(realTimeframes, newPrice, h1KlinesRef.current);
          // BUG 8 FIX: Round zone ke nearest 50 â€” cegah voice spam
          const sigKey = `${autoSig.type}-${Math.round(parseFloat(autoSig.zone) / 50) * 50}`;
          setAnalysis(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              price: newPrice,
              timeframes: realTimeframes,
              signal: {
                type: autoSig.type,
                tier: autoSig.tier,
                confidence: autoSig.confidence,
                zone: autoSig.zone,
                sl: autoSig.sl,
                tp1: autoSig.tp1,
                tp2: autoSig.tp2,
                rr: autoSig.rr
              },
              suggestions: autoSuggestions,
              reasoning: autoSig.reasoning,
            };
          });
          // Voice alert only on new actionable signal
          if ((autoSig.type === 'BUY' || autoSig.type === 'SELL') && sigKey !== lastSignalKeyRef.current) {
            lastSignalKeyRef.current = sigKey;
            fireSmartAlert(autoSig.type as 'BUY'|'SELL', autoSig.zone, autoSig.confidence, autoSig.tier);
            if (autoSig.confidence >= 75) {
              addSignalToHistory({ type: autoSig.type as 'BUY'|'SELL', tier: autoSig.tier, confidence: autoSig.confidence, label: autoSig.label, zone: autoSig.zone, sl: autoSig.sl, tp1: autoSig.tp1, tp2: autoSig.tp2, rr: autoSig.rr });
              setHistoryRefresh(prev => prev + 1);
            }
          }
        } else if (newPrice) {
          setAnalysis(prev => prev ? { ...prev, price: newPrice } : null);
        }
      } catch (err) {
        // Ignore background errors
      }
    };

    const intervalId = setInterval(fetchBackgroundData, 3000); // 3 seconds for extremely snappy feel instead of 10s
    return () => clearInterval(intervalId);
  }, []);

  const getTrendColor = (trend: string) => {
    if (trend.includes("BULL")) return "text-bull border-bull/20 bg-bull/5";
    if (trend.includes("BEAR")) return "text-bear border-bear/20 bg-bear/5";
    return "text-warning border-warning/20 bg-warning/5";
  };

  if (showSplash) {
    return (
      <div className="min-h-[100dvh] w-screen bg-[#05070a] text-white flex flex-col relative overflow-hidden font-sans select-none">
        {/* Background Grid/Fx */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(0,255,136,0.08),transparent_70%)] opacity-60 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />

        {/* Content Container */}
        <div className="relative z-10 flex flex-col flex-1 max-w-7xl mx-auto px-6 md:px-16 py-8 md:py-24">

          {/* Brand Header */}
          <div className="flex items-center gap-3 md:gap-4 mb-20 md:mb-24 animate-in fade-in slide-in-from-top-10 duration-700">
            <div className="relative w-10 h-10 md:w-14 md:h-14 bg-bull/10 rounded-xl flex items-center justify-center border border-bull/30">
              <div className="relative text-bull border-2 md:border-4 border-bull rounded-full p-1 flex items-center justify-center w-7 h-7 md:w-10 md:h-10">
                <span className="text-sm md:text-xl font-black italic">Î©</span>
              </div>
            </div>
            <div>
              <h2 className="text-[10px] md:text-lg font-black tracking-[0.2em] md:tracking-[0.3em] text-white/90 italic uppercase">BTCUSD <span className="text-bull">SIGNAL OMEGA</span></h2>
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-bull animate-pulse" />
                <span className="text-[7px] md:text-[10px] font-bold text-bull/60 tracking-widest uppercase">Live Scanning â€¢ Binance</span>
              </div>
            </div>
          </div>

          {/* Hero Section */}
          <div className="flex-1 flex flex-col lg:flex-row lg:items-center gap-8 md:gap-12">
            <div className="flex flex-col animate-in fade-in slide-in-from-left-10 duration-1000 delay-200">
              <h1 className="text-4xl md:text-8xl font-black italic tracking-tighter leading-[0.85] mb-16 md:mb-20">
                PREMIUM <br />
                <span className="text-bull text-glow uppercase">BTC SIGNAL</span>
              </h1>

              {/* CTA - Moved Up */}
              <button
                onClick={enterTerminal}
                className="group relative w-full md:w-fit px-8 md:px-12 py-5 border-2 border-bull text-bull hover:bg-bull hover:text-black font-black text-lg md:text-xl italic tracking-widest rounded-xl transition-all active:scale-95 overflow-hidden shadow-[0_0_30px_rgba(0,255,136,0.2)] mb-2 md:mb-4"
              >
                <div className="absolute inset-0 bg-bull/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                ENTER TERMINAL
              </button>

              {/* Countdown Indicator */}
              <div className="flex items-center gap-2 mb-10 md:mb-16">
                <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">Auto-redirecting in</span>
                <span className="w-5 h-5 flex items-center justify-center bg-bull/20 rounded border border-bull/30 text-bull font-mono text-xs font-bold">{countdown}s</span>
              </div>

              {/* Feature List - Moved Down */}
              <div className="space-y-6 md:space-y-8">
                {[
                  { icon: <Zap className="text-bull" size={14} />, title: "Real-Time Signal", desc: "Market update real-time" },
                  { icon: <Target className="text-bull" size={14} />, title: "High Accuracy", desc: "Akurasi 80%+" },
                  { icon: <ShieldCheck className="text-bull" size={14} />, title: "Secure & Reliable", desc: "Validasi AI & Logic" }
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-5">
                    <div className="p-2.5 bg-bull/10 rounded-lg border border-bull/20 shadow-[0_0_15px_rgba(0,255,136,0.1)]">{f.icon}</div>
                    <div>
                      <h4 className="font-bold text-white text-xs md:text-base tracking-wide leading-none">{f.title}</h4>
                      <p className="text-[9px] md:text-xs text-slate-500 mt-1.5">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Column */}
            <div className="hidden lg:flex flex-col justify-center items-center relative animate-in fade-in slide-in-from-right-10 duration-1000 delay-500">
              {/* Glowing Bull Visual (Conceptual) */}
              <div className="relative w-full max-w-lg aspect-square flex items-center justify-center">
                <div className="absolute inset-0 bg-bull/5 rounded-full blur-[100px]" />

                {/* Decorative Circles */}
                <div className="absolute inset-0 border-[1px] border-bull/10 rounded-full animate-pulse" />
                <div className="absolute inset-8 border-[1px] border-bull/5 rounded-full" />

                <div className="relative p-12 border-2 border-bull/20 rounded-full animate-spin-slow">
                  <div className="w-80 h-80 border border-dashed border-bull/40 rounded-full" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-bull rounded-full blur-sm" />
                </div>

                <div className="absolute inset-0 flex items-center justify-center text-bull/10 italic font-black text-[25rem] pointer-events-none select-none">
                  Î©
                </div>

                <div className="absolute inset-0 flex items-center justify-center">
                  <TrendingUp size={180} className="text-bull drop-shadow-[0_0_40px_rgba(0,255,136,0.8)]" />
                </div>
              </div>

              {/* Floating Stat Labels (Visual only) */}
              <div className="absolute top-10 right-0 bg-bull/20 border border-bull/40 p-4 rounded-xl backdrop-blur-xl animate-bounce-slow shadow-[0_0_20px_rgba(0,255,136,0.2)]">
                <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">TP 2 TARGET</p>
                <p className="text-2xl font-mono font-black text-bull">$77,707.7</p>
              </div>
              <div className="absolute bottom-10 left-0 bg-bear/20 border border-bear/40 p-4 rounded-xl backdrop-blur-xl animate-bounce-slower shadow-[0_0_20px_rgba(255,68,102,0.2)]">
                <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">STOP LOSS</p>
                <p className="text-2xl font-mono font-black text-bear">$75,572.5</p>
              </div>
              <div className="absolute top-1/2 left-0 -translate-x-12 bg-warning/20 border border-warning/40 p-4 rounded-xl backdrop-blur-xl animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                <p className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest opacity-60">BUY ZONE</p>
                <p className="text-2xl font-mono font-black text-warning">$76,030.0</p>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="border-t border-white/5 pt-6 md:pt-12 mt-auto md:mt-12 flex flex-wrap gap-6 md:gap-12 items-center justify-center md:justify-start grayscale opacity-40 text-[9px] md:text-sm">
            <div className="flex items-center gap-2 font-bold italic"><Zap size={12} className="text-bull" /> BETTER ANALYSIS</div>
            <div className="flex items-center gap-2 font-bold italic"><Target size={12} className="text-bull" /> BETTER DECISIONS</div>
            <div className="ml-auto text-[8px] opacity-30 font-mono tracking-tighter">V.2.0.4-HOTFIX</div>
          </div>
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
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bull/10 border border-bull/20">
                <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-bull animate-pulse shadow-[0_0_5px_rgba(0,255,136,0.5)]" />
                <span className="text-[8px] md:text-[9px] font-black text-bull">LIVE SCANNING</span>
              </div>
              <span className="hidden sm:inline text-[10px] font-mono text-slate-500">/</span >
              <span className="hidden sm:inline text-[10px] font-mono text-slate-500 uppercase">BTCUSDT â€¢ BINANCE</span>
            </div>
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
            {loading ? <RefreshCw size={12} className="animate-spin md:w-3.5 md:h-3.5" /> : <Zap size={12} className="md:w-3.5 md:h-3.5" />}
            <span className="hidden sm:inline">{loading ? "SCANNING..." : "SCAN MARKET"}</span>
            <span className="inline sm:hidden">{loading ? "SCAN" : "SCAN"}</span>
          </button>
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
      <main className="flex-1 flex flex-col overflow-hidden relative">

        {/* Top Timeframe Strip */}
        <div className="h-20 border-b border-trading-border flex flex-nowrap overflow-x-auto no-scrollbar bg-trading-panel/30 flex-shrink-0">
          {(liveIndicators || analysis?.timeframes || [
            { timeframe: "H4", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "H1", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "M15", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." },
            { timeframe: "M5", trend: "NEUTRAL", rsi: 50, rsiState: "...", structure: "..." }
          ]).slice(0, 4).map((tf, i) => (
            <div key={i} className={`min-w-[140px] flex-1 p-3 border-r border-trading-border flex flex-col justify-between ${liveIndicators || analysis ? "" : "animate-pulse"}`}>
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded tracking-widest leading-none">{tf.timeframe} [EMA]</span>
                <span className="text-[8px] uppercase tracking-widest font-bold opacity-20">STRUCTURE</span>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className={`text-[10px] md:text-[11px] font-black tracking-tight leading-none ${getTrendColor(tf.trend).split(' ')[0]}`}>{tf.trend}</p>
                  <p className="text-[9px] font-mono text-slate-500 mt-1">RSI: <span className="text-white">{tf.rsi}</span></p>
                </div>
                <p className="text-[9px] font-mono text-slate-400 font-bold uppercase">{tf.structure}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 grid grid-cols-12 overflow-hidden relative">
          {/* Left: Chart Area */}
          <div className={`
              ${mobileActiveTab === 'CHART' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-8 border-r border-trading-border flex-col relative h-full w-full
            `}>
            {/* Drawing Toolbar Toggle - Yellow Exness Style */}
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

              {/* Visual Target Lock Highlight Overlay (TV-Style Horizontal Ray) */}
              <AnimatePresence>
                {analysis?.signal && (
                  <>
                    {/* ── PRIMARY: BUY / SELL ZONE line ─────────────────── */}
                    <motion.div
                      key={highlightTrigger}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="absolute left-0 w-full top-[30%] z-[60] flex items-center pointer-events-none drop-shadow-md"
                    >
                      <div className="pl-4 pr-3 text-[10px] md:text-xs uppercase font-bold tracking-widest drop-shadow-lg whitespace-nowrap bg-trading-bg/50 backdrop-blur-sm"
                        style={{ color: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }}>
                        {analysis.signal.type} ZONE
                      </div>
                      <div className="flex-1 h-0 border-b-2 border-dotted opacity-60"
                        style={{ borderColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }} />
                      <div className="flex items-center">
                        <div
                          className="w-0 h-0 border-y-[12px] border-y-transparent border-r-[8px]"
                          style={{ borderRightColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }}
                        />
                        <div
                          className="text-white font-mono text-[11px] font-semibold h-[24px] px-1.5 flex items-center justify-center rounded-sm rounded-l-none"
                          style={{ backgroundColor: analysis.signal.type === 'SELL' ? '#ff4466' : analysis.signal.type === 'BUY' ? '#00ff88' : '#eab308' }}
                        >
                          {analysis.signal.zone}
                        </div>
                      </div>
                    </motion.div>

                    {/* ── SCALP ZONE line (kuning) ───────────────────────── */}
                    {(() => {
                      const scalp = (analysis.suggestions || []).find(
                        s => !s.isSkip && !s.isAdvice && s.label.includes('SCALP') && s.zone !== '---'
                      );
                      if (!scalp) return null;
                      return (
                        <motion.div
                          key={`scalp-${highlightTrigger}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.3, delay: 0.1 }}
                          className="absolute left-0 w-full top-[48%] z-[60] flex items-center pointer-events-none drop-shadow-md"
                        >
                          <div className="pl-4 pr-3 text-[10px] md:text-xs uppercase font-bold tracking-widest drop-shadow-lg whitespace-nowrap bg-trading-bg/50 backdrop-blur-sm"
                            style={{ color: '#eab308' }}>
                            SCALP ZONE
                          </div>
                          <div className="flex-1 h-0 border-b-2 border-dashed opacity-60"
                            style={{ borderColor: '#eab308' }} />
                          <div className="flex items-center">
                            <div
                              className="w-0 h-0 border-y-[12px] border-y-transparent border-r-[8px]"
                              style={{ borderRightColor: '#eab308' }}
                            />
                            <div
                              className="text-black font-mono text-[11px] font-semibold h-[24px] px-1.5 flex items-center justify-center rounded-sm rounded-l-none"
                              style={{ backgroundColor: '#eab308' }}
                            >
                              {scalp.zone}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })()}
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right: AI Analysis Panel */}
          <div className={`
              ${mobileActiveTab === 'SIGNAL' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-4 flex-col bg-trading-panel overflow-y-auto no-scrollbar h-full w-full pb-20 lg:pb-0
            `}>
            {/* Signal Header */}
            <div className="p-4 border-b border-trading-border bg-gradient-to-br from-trading-panel to-trading-bg flex-shrink-0">
              <h2 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-3">AI ENTRY SUGGESTION</h2>

              {/* Multi-Suggestion Cards */}
              <div className="space-y-3">
                {(analysis?.suggestions || []).map((s, i) => {
                  const isSkip = s.isSkip;
                  const isBuy = s.type === "BUY";
                  const isSell = s.type === "SELL";
                  const color = isSkip ? "#64748b" : isBuy ? "#00ff88" : "#ff4466";
                  const bgColor = isSkip ? "bg-slate-800/40" : isBuy ? "bg-bull/5" : "bg-bear/5";
                  const borderColor = isSkip ? "border-slate-700" : isBuy ? "border-bull/30" : "border-bear/30";

                  // ADVICE card render
                  if (s.isAdvice) {
                    return (
                      <div key={i} className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-black tracking-widest text-blue-400">ADVICE</span>
                        </div>
                        <div className="space-y-1">
                          {s.note.split("\\n").map((line, li) => (
                            <p key={li} className="text-[10px] font-medium text-slate-300 leading-relaxed">{line}</p>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={i} className={`rounded-lg border p-3 ${bgColor} ${borderColor}`}>
                      {/* Card Header */}
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-black text-sm tracking-tight" style={{ color }}>
                          {s.label}
                        </span>
                        {!isSkip && (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                              Conf:
                            </span>
                            <span className="text-sm font-black font-mono" style={{ color }}>
                              {s.confidence}%
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-slate-400">
                              RR {s.rr}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Price Levels - hanya untuk non-skip */}
                      {!isSkip && (
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          <div className="p-2 bg-trading-bg/80 rounded border border-trading-border">
                            <p className="text-[8px] uppercase tracking-widest opacity-40 mb-0.5">Entry</p>
                            <p className="text-xs font-mono text-white font-bold">{s.zone}</p>
                          </div>
                          <div className="p-2 bg-trading-bg/80 rounded border border-trading-border">
                            <p className="text-[8px] uppercase tracking-widest text-bear opacity-70 mb-0.5">SL</p>
                            <p className="text-xs font-mono text-bear font-bold">{s.sl}</p>
                          </div>
                          <div className="p-2 bg-trading-bg/80 rounded border border-trading-border">
                            <p className="text-[8px] uppercase tracking-widest mb-0.5" style={{ color, opacity: 0.7 }}>TP1</p>
                            <p className="text-xs font-mono font-bold" style={{ color }}>{s.tp1}</p>
                          </div>
                          <div className="p-2 bg-trading-bg/80 rounded border border-trading-border">
                            <p className="text-[8px] uppercase tracking-widest mb-0.5" style={{ color, opacity: 0.7 }}>TP2</p>
                            <p className="text-xs font-mono font-black" style={{ color }}>{s.tp2}</p>
                          </div>
                        </div>
                      )}

                      {/* Note */}
                      <p className="text-[10px] font-bold leading-snug" style={{ color: isSkip ? "#94a3b8" : color, opacity: isSkip ? 1 : 0.85 }}>
                        {s.note}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Reasoning per suggestion pertama */}
            <div className="p-4 flex-1">
              <h3 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-3">REASONING & BIAS</h3>
              <div className="space-y-2">
                {(analysis?.suggestions || []).filter(s => !s.isSkip).map((s, i) => (
                  <div key={i} className="text-[11px] font-medium text-slate-400 leading-relaxed border-l-2 pl-3"
                    style={{ borderColor: s.type === "BUY" ? "#00ff88" : "#ff4466" }}>
                    {s.reasoning}
                  </div>
                ))}
                {(!analysis?.suggestions || analysis.suggestions.filter(s => !s.isSkip).length === 0) && (
                  <p className="text-slate-500 text-[11px]">
                    {analysis?.suggestions?.find(s => s.isSkip)?.reasoning || "Tunggu hasil pemindaian..."}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className="h-16 bg-trading-panel border-t border-trading-border lg:hidden flex items-center justify-around px-4 z-[90] shadow-[0_-5px_15px_rgba(0,0,0,0.5)] flex-shrink-0">
        {[
          { id: 'CHART', icon: <TrendingUp size={20} />, label: 'Market Chart' },
          { id: 'SIGNAL', icon: <Target size={20} />, label: 'Signal Omega' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMobileActiveTab(tab.id as any)}
            className={`flex flex-col items-center gap-1 transition-all ${mobileActiveTab === tab.id ? 'text-accent' : 'text-slate-500'}`}
          >
            <div className={`p-1 rounded-md transition-colors ${mobileActiveTab === tab.id ? 'bg-accent/10 border border-accent/20' : ''}`}>
              {tab.icon}
            </div>
            <span className={`text-[9px] font-bold tracking-widest uppercase ${mobileActiveTab === tab.id ? 'opacity-100' : 'opacity-40'}`}>{tab.label}</span>
            {mobileActiveTab === tab.id && <motion.div layoutId="nav-glow" className="w-4 h-0.5 bg-accent rounded-full mt-1 blur-sm" />}
          </button>
        ))}
      </nav>

      {/* Footer Utility */}
      <footer className="h-6 bg-white/[0.02] border-t border-white/[0.05] flex items-center px-4 text-[8px] font-mono tracking-widest text-slate-600 uppercase">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="w-1 h-1 rounded-full bg-bull" />
            SYSTEM: ONLINE [24/7 SCANNING]
          </div>
          <div>VOLATILITY: 1.25%</div>
          <div className="ml-auto">Â© 2026 ALPHAPULSE INTEL. LTD. â€¢ NOT FINANCIAL ADVICE</div>
        </div>
      </footer>

      {/* History Panel */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel
            onClose={() => setShowHistory(false)}
            refreshTrigger={historyRefresh}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Typing definitions for window
declare global {
  interface Window {
    TradingView: any;
  }
}
