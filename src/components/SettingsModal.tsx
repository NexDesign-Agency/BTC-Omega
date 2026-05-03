import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Key, Cpu, Eye, EyeOff, Save } from 'lucide-react'

interface Props {
  onClose: () => void
  apiKey: string
  model: string
  onSave: (apiKey: string, model: string) => void
}

const MODEL_OPTIONS = [
  { value: 'deepseek/deepseek-v4-flash',  label: '🔥 DeepSeek V4 Flash — Tercepat & Termurah' },
  { value: 'anthropic/claude-sonnet-4-6', label: '🧠 Claude Sonnet 4.6 — Analitis Terbaik' },
  { value: 'google/gemini-3.1-pro-preview', label: '🌟 Gemini 3.1 Pro — Benchmark Tertinggi' },
  { value: 'google/gemini-3.1-pro-preview', label: '🌟 Gemini 3.1 Pro — Benchmark Tertinggi' },
  { value: 'minimax/minimax-m2.5',        label: '💎 MiniMax M2.5 — Setara Opus, Murah' },
]

export default function SettingsModal({ onClose, apiKey: initialKey, model: initialModel, onSave }: Props) {
  const validModel = MODEL_OPTIONS.find(o => o.value === initialModel)
    ? initialModel
    : MODEL_OPTIONS[0].value
  const [apiKey, setApiKey] = useState(initialKey)
  const [model, setModel] = useState(validModel)
  const [showKey, setShowKey] = useState(false)

  const handleSave = () => {
    if (!apiKey.trim()) return
    onSave(apiKey.trim(), model)
    onClose()
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <motion.div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          className="relative z-10 w-full max-w-md mx-4 bg-trading-panel border border-trading-border rounded-2xl shadow-2xl overflow-hidden"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-trading-border bg-black/20">
            <div className="flex items-center gap-2.5">
              <div className="bg-accent/10 p-2 rounded-lg border border-accent/20">
                <Cpu size={18} className="text-accent" />
              </div>
              <div>
                <h2 className="font-black text-white text-sm tracking-wider">AI CONFIG</h2>
                <p className="text-[9px] text-slate-500 font-mono tracking-wider">OpenRouter API</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-trading-border flex items-center justify-center text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* API Key */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <Key size={12} /> OpenRouter API Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full bg-black/40 border border-trading-border rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors p-1"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[8px] text-slate-600 leading-relaxed">
                Daftar di{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" className="text-accent hover:underline">openrouter.ai/keys</a>
                {' '}— semua model di bawah butuh saldo OpenRouter.
              </p>
            </div>

            {/* Model Selection */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <Cpu size={12} /> AI Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-black/40 border border-trading-border rounded-lg px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors appearance-none cursor-pointer"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                  backgroundPosition: 'right 0.5rem center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '1.5em 1.5em',
                  paddingRight: '2.5rem',
                }}
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-trading-panel text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[8px] text-warning font-bold">
                ⚠️ Semua model berbayar. Pastikan saldo OpenRouter cukup sebelum digunakan.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-trading-border bg-black/20 flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-trading-border rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-colors tracking-wider"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim()}
              className="flex-1 px-4 py-2.5 bg-accent hover:bg-accent/90 border border-accent rounded-lg text-[11px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 tracking-wider shadow-[0_0_15px_rgba(59,130,246,0.3)]"
            >
              <Save size={14} />
              SAVE
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
