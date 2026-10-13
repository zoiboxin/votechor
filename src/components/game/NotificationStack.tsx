'use client'

import { useEffect } from 'react'
import { useGameStore, type Notification } from '@/lib/game-store'
import { Megaphone, Trophy, Skull, Users, Crown, AlertTriangle, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const KIND_STYLE: Record<Notification['kind'], { border: string; bg: string; icon: typeof Megaphone; iconCls: string }> = {
  info: { border: 'border-[#1c1a17]/80', bg: 'bg-[#f5efdc]', icon: Megaphone, iconCls: 'text-[#1c1a17]' },
  capture: { border: 'border-[#8c1f28]', bg: 'bg-[#f5d9d4]', icon: Skull, iconCls: 'text-[#8c1f28]' },
  achievement: { border: 'border-[#b07d1e]', bg: 'bg-[#f2c14e]', icon: Trophy, iconCls: 'text-[#1c1a17]' },
  squad: { border: 'border-[#2e6e4e]', bg: 'bg-[#dcebe0]', icon: Users, iconCls: 'text-[#2e6e4e]' },
  boss: { border: 'border-[#8c1f28]', bg: 'bg-[#1c1a17]', icon: Crown, iconCls: 'text-[#f2c14e]' },
  warning: { border: 'border-[#b07d1e]', bg: 'bg-[#f7ecd2]', icon: AlertTriangle, iconCls: 'text-[#b07d1e]' },
}

function Toast({ n }: { n: Notification }) {
  const dismiss = useGameStore((s) => s.dismissNotification)
  const style = KIND_STYLE[n.kind]
  const Icon = style.icon
  const dark = n.kind === 'boss'

  useEffect(() => {
    const t = setTimeout(() => dismiss(n.id), 4500)
    return () => clearTimeout(t)
  }, [n.id, dismiss])

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -18, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      onClick={() => dismiss(n.id)}
      className={`pointer-events-auto flex w-[min(420px,92vw)] items-center gap-2.5 rounded-2xl border-2 px-3 py-2 text-left shadow-[4px_4px_0_rgba(28,26,23,0.85)] ${style.border} ${style.bg}`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#1c1a17]/40 ${dark ? 'bg-[#8c1f28]' : 'bg-[#1c1a17]/10'}`}>
        <Icon className={`h-4 w-4 ${style.iconCls}`} />
      </span>
      <span className={`min-w-0 flex-1 text-xs font-bold leading-snug ${dark ? 'text-[#f5efdc]' : 'text-[#1c1a17]'}`}>
        {n.text}
      </span>
      <X className={`h-3.5 w-3.5 shrink-0 ${dark ? 'text-[#f5efdc]/50' : 'text-[#1c1a17]/40'}`} />
    </motion.button>
  )
}

export default function NotificationStack() {
  const notifications = useGameStore((s) => s.notifications)
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <AnimatePresence mode="popLayout">
        {notifications.map((n) => (
          <Toast key={n.id} n={n} />
        ))}
      </AnimatePresence>
    </div>
  )
}
