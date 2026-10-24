'use client'
import dynamic from 'next/dynamic'
import CookieBanner from '@/components/game/CookieBanner'

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

const SITE_URL = 'https://votechor.app'

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'VideoGame',
      '@id': `${SITE_URL}/#game`,
      name: 'VoteChor: The Great Parliament Run',
      alternateName: ['VoteChor', 'Vote Chor'],
      url: SITE_URL,
      description:
        'VoteChor is a free 3D multiplayer satirical protest game that runs instantly in your browser. Dodge police patrols and searchlights, snatch back the stolen golden vote tokens with your crowd, and take down The Great Vote Collector. Play solo with bots or online with friends — no download required.',
      image: `${SITE_URL}/brand/og-image.png`,
      screenshot: `${SITE_URL}/brand/og-image.png`,
      genre: ['Action', 'Multiplayer', 'Indie', 'Satire', 'Stealth'],
      gamePlatform: ['Web browser', 'Desktop', 'Mobile'],
      operatingSystem: 'Any (modern web browser)',
      applicationCategory: 'Game',
      applicationSubCategory: 'Multiplayer Game',
      playMode: ['SinglePlayer', 'MultiPlayer', 'CoOp'],
      numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 16 },
      inLanguage: 'en',
      isAccessibleForFree: true,
      isFamilyFriendly: true,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: SITE_URL,
      },
      author: { '@type': 'Organization', name: 'VoteChor Studio', url: SITE_URL },
      publisher: { '@type': 'Organization', name: 'VoteChor Studio', url: SITE_URL },
      playUrl: SITE_URL,
      gameLocation: { '@type': 'VirtualLocation', url: SITE_URL },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'VoteChor',
      description: 'The votes are missing. The protest is on. Everybody run! Free 3D multiplayer browser game.',
      publisher: { '@id': `${SITE_URL}/#org` },
      inLanguage: 'en',
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#org`,
      name: 'VoteChor Studio',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/icon-512.png` },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is VoteChor free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, VoteChor is 100% free to play at votechor.app — no payment, no account required.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do I need to download or install anything to play VoteChor?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. VoteChor runs directly in your browser (Chrome, Edge, Firefox, Safari) on desktop and mobile.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I play VoteChor with friends?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Start a multiplayer match and share the invite link, or play solo with AI crowd bots.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is VoteChor about?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'VoteChor is a satirical 3D protest game: the parliament has stolen the people\u2019s votes, and you run through the city with your crowd to take them back while dodging patrols, searchlights and checkpoints — then face The Great Vote Collector.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does VoteChor work on mobile?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, VoteChor has on-screen touch controls for mobile. A keyboard and mouse give the best experience on desktop.',
          },
        },
      ],
    },
  ],
}

function SeoStaticContent() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <noscript>
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: '#f5efdc', color: '#1c1a17', fontFamily: 'system-ui, sans-serif' }}>
          <div>
            <h1>VoteChor: The Great Parliament Run</h1>
            <p>VoteChor is a free 3D multiplayer protest game played in your browser. Please enable JavaScript to play at {SITE_URL}.</p>
          </div>
        </div>
      </noscript>
      {/* Crawler / screen-reader content: the game canvas is client-rendered, so this
          semantic section carries the page's indexable copy (SEO/AIO/GEO). */}
      <section className="sr-only" aria-label="About VoteChor">
        <h1>VoteChor: The Great Parliament Run — Free 3D Multiplayer Browser Game</h1>
        <p>
          The votes are missing. The protest is on. Everybody run! VoteChor is a free 3D multiplayer
          satirical protest game you play instantly in your browser — no download, no install, no
          account. Dodge police patrols and sweeping searchlights across Parliament City, snatch back
          the stolen golden vote tokens, rescue captured protesters to grow your crowd, and take down
          the final boss: The Great Vote Collector.
        </p>
        <h2>How to play VoteChor</h2>
        <p>
          Pick one of 8 protester archetypes, then sprint, slide and vault through 5 zones of a
          stylized cartoon city. Steal back glowing vote tokens without getting spotted, distract
          officers, free your friends from checkpoint cells, and survive the five-phase Great Vote
          Collector showdown. Earn XP, unlock achievements, cosmetics and daily challenges.
        </p>
        <h2>VoteChor features</h2>
        <ul>
          <li>Free to play, instantly in the browser on desktop and mobile</li>
          <li>Online multiplayer with shareable invite links — bring your whole crowd</li>
          <li>Solo mode with AI crowd bots for instant action</li>
          <li>8 playable protester archetypes with unique perks</li>
          <li>5 city zones: searchlights, watchtowers, checkpoints and patrol chases</li>
          <li>Five-phase final boss battle against The Great Vote Collector</li>
          <li>XP, levels, achievements, cosmetics and daily challenges</li>
          <li>Global leaderboard and player stats</li>
        </ul>
        <h2>VoteChor FAQ</h2>
        <h3>Is VoteChor free?</h3>
        <p>Yes — VoteChor is 100% free to play, no payment and no account needed.</p>
        <h3>Can I play VoteChor with friends?</h3>
        <p>Yes — create a multiplayer match and share the invite link, or play solo with AI bots.</p>
        <h3>Does VoteChor work on mobile?</h3>
        <p>Yes — VoteChor has on-screen touch controls; keyboard and mouse are recommended on desktop.</p>
        <h3>Is VoteChor family friendly?</h3>
        <p>Yes — VoteChor is cartoon comedy with slapstick chases and no realistic violence (ages 10+).</p>
        <p>
          Play VoteChor free now at <a href={SITE_URL}>votechor.app</a> — the 3D multiplayer
          satirical protest browser game.
        </p>
      </section>
    </>
  )
}

export default function Page() {
  return (
    <>
      <GameRoot />
      <CookieBanner />
      <SeoStaticContent />
    </>
  )
}
