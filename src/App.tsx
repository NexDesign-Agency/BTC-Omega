import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { computeSignal, computeSignals, SignalResult } from "./lib/signalEngine";
import { getAlertLevel, playAlertSound, speakSmartAlert } from "./lib/alertEngine";
import { addSignalToHistory, loadHistory, calcWinRate } from "./lib/historyEngine";
import HistoryPanel from "./components/HistoryPanel";
import {
  TrendingUp,
  Zap,
  RefreshCw,
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
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showChartToolbar, setShowChartToolbar] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [highlightTrigger, setHighlightTrigger] = useState(0);
  const [mobileActiveTab, setMobileActiveTab] = useState<"CHART" | "SIGNAL">("SIGNAL");
  const [showHistory, setShowHistory] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [quickWinRate, setQuickWinRate] = useState<number | null>(null);

  const h1KlinesRef = useRef<any[]>([]);
  const m15KlinesRef = useRef<any[]>([]);
  const lastSignalKeyRef = useRef<string>("");

  useTradingView("tv_chart_container", !showSplash, !showChartToolbar);

  const enterTerminal = () => {
    setShowSplash(false);
    speakSmartAlert("BUY", "0", "NONE", 0); // warm up
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(Object.assign(new SpeechSynthesisUtterance("Welcome to BTC USD Signal Omega. Pure Price Action mode active."), { lang: 'en-US', rate: 0.85 }));
    const h = loadHistory();
    const s = calcWinRate(h);
    if (s.total > 0) setQuickWinRate(s.winRate);
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
    const { shouldFire, level } = getAlertLevel(confidence, tier);
    if (!shouldFire) return;
    playAlertSound(level);
    speakSmartAlert(type, zone, level, confidence);
  };

  const runAnalysis = async () => {
    setLoading(true);
    try {
      let currentPrice = 0;
      let h1RawKlines: any[] = [];
      let m15RawKlines: any[] = [];

      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          currentPrice = parseFloat(binanceData.lastPrice);
        }

        const fetchTF = async (interval: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`);
          if (res.ok) {
            const klines = await res.json();
            if (interval === '1h') h1RawKlines = klines;
            if (interval === '15m') m15RawKlines = klines;
          }
        };

        await Promise.all([
          fetchTF('15m'),
          fetchTF('1h')
        ]);
      } catch (e) {
        console.warn("Failed to fetch from Binance", e);
      }

      h1KlinesRef.current = h1RawKlines;
      m15KlinesRef.current = m15RawKlines;

      const sig = computeSignal(currentPrice, h1RawKlines, m15RawKlines);
      const allSuggestions = computeSignals(currentPrice, h1RawKlines, m15RawKlines);

      setAnalysis({
        price: currentPrice,
        signal: {
          type: sig.type, tier: sig.tier, confidence: sig.confidence,
          zone: sig.zone, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2, rr: sig.rr
        },
        suggestions: allSuggestions,
        reasoning: sig.reasoning
      });
      setHighlightTrigger(prev => prev + 1);

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
    } catch (err) {
      console.error("Analysis Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis();

    const fetchBackgroundData = async () => {
      try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
        let newPrice = 0;
        if (binanceRes.ok) {
          const binanceData = await binanceRes.json();
          newPrice = parseFloat(binanceData.lastPrice);
        }

        const fetchTF = async (interval: string) => {
          const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=150`);
          if (res.ok) {
            const klines = await res.json();
            if (interval === '1h') h1KlinesRef.current = klines;
            if (interval === '15m') m15KlinesRef.current = klines;
          }
        };

        await Promise.all([fetchTF('15m'), fetchTF('1h')]);

        if (newPrice && m15KlinesRef.current.length > 0) {
          const autoSig = computeSignal(newPrice, h1KlinesRef.current, m15KlinesRef.current);
          const autoSuggestions = computeSignals(newPrice, h1KlinesRef.current, m15KlinesRef.current);
          
          const sigKey = `${autoSig.type}-${Math.round(parseFloat(autoSig.zone) / 50) * 50}`;
          
          setAnalysis(prev => ({
            ...prev,
            price: newPrice,
            signal: {
              type: autoSig.type, tier: autoSig.tier, confidence: autoSig.confidence,
              zone: autoSig.zone, sl: autoSig.sl, tp1: autoSig.tp1, tp2: autoSig.tp2, rr: autoSig.rr
            },
            suggestions: autoSuggestions,
            reasoning: autoSig.reasoning,
          } as MarketAnalysis));

          if ((autoSig.type === 'BUY' || autoSig.type === 'SELL') && sigKey !== lastSignalKeyRef.current) {
            lastSignalKeyRef.current = sigKey;
            fireSmartAlert(autoSig.type as 'BUY'|'SELL', autoSig.zone, autoSig.confidence, autoSig.tier);
            if (autoSig.confidence >= 75) {
              addSignalToHistory({ type: autoSig.type as 'BUY'|'SELL', tier: autoSig.tier, confidence: autoSig.confidence, label: autoSig.label, zone: autoSig.zone, sl: autoSig.sl, tp1: autoSig.tp1, tp2: autoSig.tp2, rr: autoSig.rr });
              setHistoryRefresh(prev => prev + 1);
            }
          }
        }
      } catch (err) {}
    };

    const intervalId = setInterval(fetchBackgroundData, 3000);
    return () => clearInterval(intervalId);
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
                <span className="text-[8px] md:text-[9px] font-black text-bull">PRICE ACTION ENGINE</span>
              </div>
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
        {/* Dynamic Content Area */}
        <div className="flex-1 grid grid-cols-12 overflow-hidden relative">
          {/* Left: Chart Area */}
          <div className={`
              ${mobileActiveTab === 'CHART' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-8 border-r border-trading-border flex-col relative h-full w-full
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

              {/* TradingView Chart Frame */}
              <div id="tv_chart_container" className="h-full w-full" />
            </div>
          </div>

          {/* Right: AI Analysis Panel */}
          <div className={`
              ${mobileActiveTab === 'SIGNAL' ? 'col-span-12 flex' : 'hidden'} 
              lg:flex lg:col-span-4 flex-col bg-trading-panel overflow-y-auto no-scrollbar h-full w-full pb-20 lg:pb-0
            `}>
            
            {/* ── CARD 1: PRIMARY ENTRY ─────────────────────────────── */}
            {(() => {
              const primary = (analysis?.suggestions || []).find(s => s.tier === 1);
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
            <div className="mx-3 mb-3 rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden flex-shrink-0">
              <div className="px-3 py-2 border-b border-white/5">
                <span className="text-[10px] uppercase tracking-widest font-black opacity-50">🧠 MARKET ADVICE</span>
              </div>
              <div className="p-3 space-y-1.5">
                {(() => {
                  const advice = analysis?.suggestions?.find(s => s.isAdvice);
                  const skip = analysis?.suggestions?.find(s => s.isSkip);
                  if (!advice && !analysis) return <p className="text-slate-500 text-[10px]">Tunggu hasil pemindaian...</p>;
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
                {(analysis?.suggestions || []).filter(s => !s.isSkip && !s.isAdvice).map((s, i) => (
                  <div key={i} className="text-[10px] font-medium text-slate-500 leading-relaxed border-l-2 pl-2"
                    style={{ borderColor: s.type === 'BUY' ? '#00ff88' : '#ff4466' }}>
                    {s.reasoning}
                  </div>
                ))}
                {(!analysis?.suggestions || analysis.suggestions.filter(s => !s.isSkip && !s.isAdvice).length === 0) && (
                  <p className="text-slate-600 text-[10px]">Tunggu hasil pemindaian...</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Navigation for Mobile */}
        <nav className="h-16 bg-trading-panel border-t border-trading-border lg:hidden flex items-center justify-around px-4 z-[90] shadow-[0_-5px_15px_rgba(0,0,0,0.5)] flex-shrink-0">
          {[
            { id: 'SIGNAL', label: 'SIGNALS', icon: <Zap size={20} className={mobileActiveTab === 'SIGNAL' ? 'text-bull' : 'text-slate-500'} /> },
            { id: 'CHART', label: 'CHART', icon: <TrendingUp size={20} className={mobileActiveTab === 'CHART' ? 'text-bull' : 'text-slate-500'} /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMobileActiveTab(tab.id as 'CHART' | 'SIGNAL')}
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

      {/* Slide-out History Panel */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel onClose={() => setShowHistory(false)} refreshTrigger={historyRefresh} />
        )}
      </AnimatePresence>
    </div>
  );
}
