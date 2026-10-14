'use client'

import { useEffect, useState } from 'react'
import { useGameStore, type Settings } from '@/lib/game-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Volume2, Music, Volume1, MousePointer2, Keyboard, RotateCcw, Monitor, CloudSun, Gauge, Accessibility } from 'lucide-react'

const KEYBIND_LABELS: Record<string, string> = {
  forward: 'Move Forward', back: 'Move Back', left: 'Move Left', right: 'Move Right',
  jump: 'Jump', sprint: 'Sprint', slide: 'Slide', interact: 'Interact / Revive',
  throw: 'Throw Item', gift: 'Gift Item', emote: 'Emote Wheel', map: 'Big Map', squad: 'Squad Panel', pause: 'Pause',
  heal: 'Quick Heal (food / medkit)', shout: 'Shout / Whistle',
}

function prettyKey(code: string): string {
  const map: Record<string, string> = {
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Space: 'SPACE', Escape: 'ESC', Tab: 'TAB',
    CapsLock: 'CAPS', Enter: 'ENTER', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  }
  if (map[code]) return map[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code.toUpperCase()
}

const DEFAULTS: Settings = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9,
  mouseSensitivity: 1, invertY: false, quality: 'auto',
  showFps: false, reducedEffects: false,
  minimapZoom: 150,
  timeMode: 'cycle',
  weatherMode: 'auto',
  perfHud: true,
  minimapRotate: true,
  reducedShake: false,
  keybinds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', slide: 'KeyC', interact: 'KeyE', throw: 'KeyQ', emote: 'KeyG', map: 'KeyM', squad: 'Tab', pause: 'Escape', gift: 'KeyF' },
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Volume2; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  )
}

export default function SettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useGameStore((s) => s.settings)
  const setSettings = useGameStore((s) => s.setSettings)
  const notify = useGameStore((s) => s.notify)
  const [rebinding, setRebinding] = useState<string | null>(null)

  const update = (patch: Partial<Settings>) => {
    const merged = { ...settings, ...patch, keybinds: { ...settings.keybinds, ...(patch.keybinds ?? {}) } }
    setSettings(patch)
    try {
      localStorage.setItem('votechor_settings', JSON.stringify(merged))
    } catch {
      /* private browsing — settings live for this session only */
    }
  }

  // key capture while rebinding
  useEffect(() => {
    if (!rebinding) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRebinding(null)
        return
      }
      if (e.code === 'Tab') return
      const clash = Object.entries(settings.keybinds).find(([action, code]) => code === e.code && action !== rebinding)
      if (clash) {
        notify(`${prettyKey(e.code)} is already used for "${KEYBIND_LABELS[clash[0]] ?? clash[0]}". Pick another.`, 'warning')
        return
      }
      update({ keybinds: { ...settings.keybinds, [rebinding]: e.code } })
      setRebinding(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rebinding, settings.keybinds])

  const resetAll = () => {
    update(DEFAULTS)
    notify('Settings reset. The committee approves of defaults.', 'info')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!rebinding) onOpenChange(o) }}>
      <DialogContent className="vc-scroll vc-paper max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black uppercase tracking-tight text-[#1c1a17]">Protest Settings</DialogTitle>
          <DialogDescription className="text-xs font-semibold text-[#1c1a17]/60">
            Tuned for maximum chaos with minimum frame drops. Saved automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Audio */}
        <section>
          <SectionTitle icon={Volume2}>Audio</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            {([
              { key: 'masterVolume', label: 'Master Volume', icon: Volume2 },
              { key: 'musicVolume', label: 'Music Volume', icon: Music },
              { key: 'sfxVolume', label: 'SFX Volume', icon: Volume1 },
            ] as const).map(({ key, label, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0 text-[#1c1a17]/60" />
                <span className="w-24 shrink-0 text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">{label}</span>
                <Slider
                  value={[settings[key]]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => update({ [key]: v[0] } as Partial<Settings>)}
                  className="flex-1"
                />
                <span className="w-9 text-right text-[11px] font-black tabular-nums text-[#1c1a17]/70">
                  {Math.round(settings[key] * 100)}%
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Controls */}
        <section>
          <SectionTitle icon={MousePointer2}>Controls</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Mouse Sens.</span>
              <Slider
                value={[settings.mouseSensitivity]}
                min={0.2}
                max={3}
                step={0.1}
                onValueChange={(v) => update({ mouseSensitivity: v[0] })}
                className="flex-1"
              />
              <span className="w-9 text-right text-[11px] font-black tabular-nums text-[#1c1a17]/70">
                {settings.mouseSensitivity.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Invert Y Axis</span>
              <Switch checked={settings.invertY} onCheckedChange={(v) => update({ invertY: v })} />
            </div>
          </div>
        </section>

        {/* Video */}
        <section>
          <SectionTitle icon={Monitor}>Video</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Show FPS Counter</span>
              <Switch checked={settings.showFps} onCheckedChange={(v) => update({ showFps: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Reduced Effects</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Less particles, more democracy</div>
              </div>
              <Switch checked={settings.reducedEffects} onCheckedChange={(v) => update({ reducedEffects: v })} />
            </div>
          </div>
        </section>

        {/* Performance (quality tier + live perf chip) */}
        <section>
          <SectionTitle icon={Gauge}>Performance</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Quality</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Auto tunes render resolution to hold your frame rate</div>
              </div>
              <Select value={settings.quality} onValueChange={(v) => update({ quality: v as Settings['quality'] })}>
                <SelectTrigger className="w-40 rounded-xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] font-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="vc-paper border-2 border-[#1c1a17]/70">
                  <SelectItem value="auto" className="font-bold">Auto (recommended)</SelectItem>
                  <SelectItem value="high" className="font-bold">High — full parade</SelectItem>
                  <SelectItem value="medium" className="font-bold">Medium</SelectItem>
                  <SelectItem value="low" className="font-bold">Low — potato</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Performance HUD</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Live chip: FPS · net · crowd · render res</div>
              </div>
              <Switch checked={settings.perfHud ?? true} onCheckedChange={(v) => update({ perfHud: v })} />
            </div>
          </div>
        </section>

        {/* Environment (day/night + weather) */}
        <section>
          <SectionTitle icon={CloudSun}>Environment</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Time of Day</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Cycle runs a full 24h in ~7 real minutes</div>
              </div>
              <Select
                value={settings.timeMode ?? 'cycle'}
                onValueChange={(v) => update({ timeMode: v as Settings['timeMode'] })}
              >
                <SelectTrigger className="w-36 rounded-xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] font-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="vc-paper border-2 border-[#1c1a17]/70">
                  <SelectItem value="cycle" className="font-bold">Live Cycle 🌗</SelectItem>
                  <SelectItem value="dawn" className="font-bold">Dawn 🌅</SelectItem>
                  <SelectItem value="noon" className="font-bold">High Noon ☀️</SelectItem>
                  <SelectItem value="dusk" className="font-bold">Dusk 🌆</SelectItem>
                  <SelectItem value="night" className="font-bold">Midnight 🌙</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Weather</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Auto lets the skies wander on their own</div>
              </div>
              <Select
                value={settings.weatherMode ?? 'auto'}
                onValueChange={(v) => update({ weatherMode: v as Settings['weatherMode'] })}
              >
                <SelectTrigger className="w-36 rounded-xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] font-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="vc-paper border-2 border-[#1c1a17]/70">
                  <SelectItem value="auto" className="font-bold">Auto 🎲</SelectItem>
                  <SelectItem value="clear" className="font-bold">Clear Skies</SelectItem>
                  <SelectItem value="cloudy" className="font-bold">Cloudy</SelectItem>
                  <SelectItem value="overcast" className="font-bold">Overcast</SelectItem>
                  <SelectItem value="rain" className="font-bold">Monsoon Rain</SelectItem>
                  <SelectItem value="storm" className="font-bold">Thunderstorm ⛈️</SelectItem>
                  <SelectItem value="fog" className="font-bold">Lohri Fog</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Accessibility (reduced camera shake) */}
        <section>
          <SectionTitle icon={Accessibility}>Accessibility</SectionTitle>
          <div className="space-y-3 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">Reduced Camera Shake</div>
                <div className="text-[9px] font-semibold text-[#1c1a17]/50">Dampens hit, explosion &amp; detention shake</div>
              </div>
              <Switch checked={settings.reducedShake ?? false} onCheckedChange={(v) => update({ reducedShake: v })} />
            </div>
          </div>
        </section>

        {/* Keybinds */}
        <section>
          <SectionTitle icon={Keyboard}>Keybinds</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl border-2 border-[#1c1a17]/60 bg-[#f5efdc] p-3">
            {Object.keys(KEYBIND_LABELS).map((action) => {
              const code = settings.keybinds[action]
              const listening = rebinding === action
              return (
                <button
                  key={action}
                  onClick={() => setRebinding(listening ? null : action)}
                  className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    listening
                      ? 'animate-[vc-blink_0.8s_linear_infinite] border-[#8c1f28] bg-[#f2c14e]'
                      : 'border-[#1c1a17]/40 bg-[#f5efdc] hover:border-[#8c1f28]'
                  }`}
                >
                  <span className="truncate text-[9px] font-black uppercase tracking-tight text-[#1c1a17]/70">
                    {KEYBIND_LABELS[action]}
                  </span>
                  <span className="shrink-0 rounded border border-[#1c1a17]/60 bg-[#1c1a17] px-1.5 py-0.5 text-[9px] font-black text-[#f2c14e]">
                    {listening ? 'PRESS KEY' : prettyKey(code)}
                  </span>
                </button>
              )
            })}
          </div>
          {rebinding && (
            <p className="mt-1.5 text-center text-[10px] font-black uppercase tracking-wider text-[#8c1f28]">
              Press any key for “{KEYBIND_LABELS[rebinding]}” — ESC cancels
            </p>
          )}
        </section>

        <button
          onClick={resetAll}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#1c1a17]/60 bg-[#efe6c8] px-3 py-2 text-[11px] font-black uppercase tracking-tight text-[#1c1a17] transition-colors hover:bg-[#f2c14e]"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to Committee Defaults
        </button>
      </DialogContent>
    </Dialog>
  )
}
