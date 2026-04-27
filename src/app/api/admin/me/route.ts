import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, isAdminTokenValid, isMaintenanceModeEnabled } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/me
 * Returns whether the caller is an admin. Useful for showing/hiding a "Logout"
 * button somewhere in the actual site (e.g. footer) once the gate is open.
 */
export async function GET(req: NextRequest) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value
    const ok = await isAdminTokenValid(token)
    return NextResponse.json(
        { authenticated: ok, maintenance: isMaintenanceModeEnabled() },
        { headers: { 'cache-control': 'no-store' } },
    )
}
