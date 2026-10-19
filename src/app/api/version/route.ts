import { NextResponse } from 'next/server'
import { VC_BUILD } from '@/lib/build-version'

/**
 * Current server-side build version. Clients poll this and compare against the
 * VC_BUILD constant compiled into their own bundle — a mismatch means the tab
 * is running a stale build (the prime suspect for the recurring "blue world"
 * report) and GameRoot shows a refresh banner. force-dynamic: never cache.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { v: VC_BUILD, at: Date.now() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
