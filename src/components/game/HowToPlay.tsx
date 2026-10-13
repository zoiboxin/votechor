'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { BookOpen, Keyboard, Crown, ScrollText, Megaphone, Users, Flame, Sparkles } from 'lucide-react'
import { BOSS_NAME, BOSS_PHASE_NAMES } from '@/game/shared/constants'

const CONTROLS: { keys: string[]; action: string; note?: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'Move' },
  { keys: ['MOUSE'], action: 'Camera' },
  { keys: ['SPACE'], action: 'Jump', note: 'Barricades are just Suggestions With Height' },
  { keys: ['SHIFT'], action: 'Sprint', note: 'Stamina drains. Chai fixes it.' },
  { keys: ['C'], action: 'Slide', note: 'Slide under searchlights. Very cinematic.' },
  { keys: ['E'], action: 'Interact / Rescue', note: 'Checkpoints, ballots, bailing out friends' },
  { keys: ['Q'], action: 'Throw Item', note: 'Bottles distract patrols. The bottle is fine.' },
  { keys: ['F'], action: 'Gift Item', note: 'Hand your best item to the nearest teammate — support points + Good Samaritan medal at 3 gifts' },
  { keys: ['G'], action: 'Emote Wheel', note: '4 unlocked by default — level up & earn medals for the rest' },
  { keys: ['T'], action: 'Quick Messages' },
  { keys: ['M'], action: 'Big Map' },
  { keys: ['TAB'], action: 'Squad Panel', note: 'Create a protest cell, share the 4-letter code, RALLY to cellmates' },
  { keys: ['1–8'], action: 'Use Inventory Item', note: 'Right-click a slot to drop it' },
  { keys: ['P'], action: 'Photo Mode', note: 'O cycles filters · wheel zooms · K saves a snapshot PNG' },
  { keys: ['ESC'], action: 'Pause', note: 'The police do not pause. Ever.' },
]

const PHASE_EXPLAIN = [
  'Arrival of the Committee — the boss struts in. Style points do not damage it, but feel good.',
  'The Speech — interrupt the speech by making noise near the boss. Booing is mechanically supported.',
  'Bureaucracy Attack — dodge paperwork projectiles. Return fire. Democracy is a contact sport.',
  'The Giant Stamp — a giant stamp tries to stamp you. Do not be under the red circle. This is the whole lesson.',
  'Teamwork Challenge — grab ballots and deposit them at stations. Solo players carry harder; squad players laugh more.',
  'The Final Vote — collect and bank 10 votes to dissolve the committee forever.',
]

export default function HowToPlay({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vc-scroll vc-paper max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-[#1c1a17]">
            <BookOpen className="h-6 w-6 text-[#8c1f28]" /> Mission Briefing
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-[#1c1a17]/60">
            Read once. Ignore at your own democratic peril.
          </DialogDescription>
        </DialogHeader>

        {/* Briefing */}
        <section className="rounded-2xl border-2 border-[#8c1f28]/60 bg-[#f2c14e]/30 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
            <Megaphone className="h-3.5 w-3.5" /> The Situation
          </div>
          <p className="text-xs font-semibold leading-relaxed text-[#1c1a17]/85">
            Someone (a committee, allegedly) stole <b>12 vote tokens</b> and scattered them across five zones of the city.
            Your job: run from Protest Plaza, through Chowk Market, past the Security Checkpoint and down Grand Avenue,
            grab every token, unlock the Government District gate, and defeat <b>{BOSS_NAME}</b> in parliamentary combat.
            Detention is temporary. Cowardice is forever.
          </p>
        </section>

        {/* Controls */}
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
            <Keyboard className="h-3.5 w-3.5" /> Controls
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-[#1c1a17]/60">
            {CONTROLS.map((c, i) => (
              <div key={c.action} className={`flex items-center gap-3 px-3 py-1.5 ${i % 2 ? 'bg-[#efe6c8]' : 'bg-[#f5efdc]'}`}>
                <div className="flex w-32 shrink-0 gap-1">
                  {c.keys.map((k) => (
                    <span key={k} className="rounded-md border-2 border-[#1c1a17]/70 bg-[#1c1a17] px-1.5 py-0.5 text-center text-[9px] font-black leading-none text-[#f2c14e] shadow-[1px_1px_0_#f2c14e]">
                      {k}
                    </span>
                  ))}
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] font-black uppercase tracking-tight text-[#1c1a17]">{c.action}</span>
                  {c.note && <span className="block text-[9px] font-semibold leading-tight text-[#1c1a17]/55">{c.note}</span>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] font-semibold text-[#1c1a17]/55">
            All keys are rebindable in Settings. On mobile, on-screen controls appear automatically.
          </p>
        </section>

        {/* Boss phases */}
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
            <Crown className="h-3.5 w-3.5" /> {BOSS_NAME} — Field Guide
          </div>
          <div className="space-y-1.5">
            {PHASE_EXPLAIN.map((p, i) => (
              <div key={i} className="flex items-start gap-2 rounded-xl border border-[#1c1a17]/40 bg-[#f5efdc] px-2.5 py-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-[#1c1a17]/70 bg-[#8c1f28] text-[9px] font-black text-[#f5efdc]">
                  {i + 1}
                </span>
                <span className="text-[10px] font-semibold leading-snug text-[#1c1a17]/80">
                  <b className="font-black uppercase text-[#1c1a17]">{BOSS_PHASE_NAMES[i]}:</b> {p}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Survival tips */}
        <section className="rounded-2xl border-2 border-dashed border-[#2e6e4e]/60 bg-[#dcebe0] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#2e6e4e]">
            <ScrollText className="h-3.5 w-3.5" /> Survival Tips From Uncle Ji
          </div>
          <ul className="space-y-1 text-[10px] font-semibold leading-snug text-[#1c1a17]/80">
            <li>• Police look where they walk. Break line of sight behind buildings, then breathe.</li>
            <li>• Searchlights rotate. Watch the rhythm like cricket. Or traffic.</li>
            <li>• Red dots on the minimap are chasing you. Blue dots are merely disappointed in you.</li>
            <li>• The cow on Grand Avenue is not a bug. Give it the respect it demands.</li>
            <li>• Reviving squadmates gives more XP than letting them think about their choices.</li>
          </ul>
        </section>

        {/* Progression: squads, emotes, streaks */}
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
            <Sparkles className="h-3.5 w-3.5" /> Career Progression
          </div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            <div className="rounded-xl border-2 border-[#2e6e4e]/60 bg-[#dcebe0] p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#2e6e4e]">
                <Users className="h-3.5 w-3.5" /> Protest Cells
              </div>
              <p className="text-[9px] font-semibold leading-snug text-[#1c1a17]/75">
                Tab → create a cell, share the 4-letter code — or press <b>INVITE</b> on any protester&rsquo;s row and they get a 20-second flyer to accept. Cellmates get green name tags, a RALLY teleport (45s cooldown), <b>F to gift supplies</b> and a <b>+10% XP solidarity bonus per cellmate</b> at match end.
              </p>
            </div>
            <div className="rounded-xl border-2 border-[#b07d1e]/60 bg-[#f2c14e]/25 p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#b07d1e]">
                <Sparkles className="h-3.5 w-3.5" /> Emote Mastery
              </div>
              <p className="text-[9px] font-semibold leading-snug text-[#1c1a17]/75">
                The emote wheel (G) grows with you: dance &amp; flex at level 2, the CHANT at level 3, and the Chai Toast for Chai Guardians. Locked chants wobble indignantly.
              </p>
            </div>
            <div className="rounded-xl border-2 border-[#8c1f28]/50 bg-[#f5efdc] p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#8c1f28]">
                <Flame className="h-3.5 w-3.5" /> Daily Streak
              </div>
              <p className="text-[9px] font-semibold leading-snug text-[#1c1a17]/75">
                Complete the daily challenge on consecutive days to build a 🔥 streak. Miss a day and the committee wins. Your card displays it proudly.
              </p>
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
