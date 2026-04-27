import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_COOKIE_NAME, isAdminTokenValid } from '@/lib/adminAuth'

/**
 * Server-side admin gate for the /spltpnl panel.
 *
 * - Uses the SAME cookie as the maintenance login at /coming-soon, so admins
 *   only need to log in once.
 * - Independent of MAINTENANCE_MODE — even when the public site is open, this
 *   panel stays admin-only.
 * - On unauthorised access, redirect to /coming-soon (which renders the login
 *   form). After login the user can navigate back to /spltpnl.
 */
export default async function SpltpnlLayout({ children }: { children: React.ReactNode }) {
    const c = await cookies()
    const token = c.get(ADMIN_COOKIE_NAME)?.value
    const ok = await isAdminTokenValid(token)
    if (!ok) redirect('/coming-soon')

    return (
        <div className="min-h-screen bg-black text-white font-sans">
            {children}
        </div>
    )
}
