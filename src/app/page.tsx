'use client'
import dynamic from 'next/dynamic'

const GameRoot = dynamic(() => import('@/components/game/GameRoot'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[#f5efdc]">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#1c1a17]/15 border-t-[#f2a541]" />
      <p className="font-black uppercase tracking-tight text-[#1c1a17]">Democracy is loading…</p>
      <p className="text-xs font-semibold text-[#8c1f28]">VoteChor: The Great Parliament Run</p>
    </div>
  ),
})

export default function Page() {
  return <GameRoot />
}
