'use client'

import { useEffect, useState } from 'react'

/**
 * The Otherside arcade cabinet: its screen video (owner, 11.10.2026: «видос мы тоже могли менять на
 * экране») and the links James needs. Saved here, the cabinet MML picks it up within ~30 s, no deploy.
 */
export function OthersideArcade() {
    const [video, setVideo] = useState('')
    const [saved, setSaved] = useState('')
    const [mmlUrl, setMmlUrl] = useState('')
    const [msg, setMsg] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        void fetch('/api/admin/otherside/arcade', { credentials: 'include', cache: 'no-store' })
            .then((r) => r.json().then((j) => ({ r, j })))
            .then(({ r, j }) => {
                if (!r.ok) { setMsg(j.error ?? `HTTP ${r.status}`); return }
                setVideo(j.videoUrl); setSaved(j.videoUrl); setMmlUrl(j.mmlUrl)
            })
            .catch(() => setMsg('load failed'))
    }, [])
    const save = async () => {
        setBusy(true); setMsg(null)
        const r = await fetch('/api/admin/otherside/arcade', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoUrl: video }) })
        const j = await r.json().catch(() => ({}))
        setBusy(false)
        if (!r.ok) { setMsg(j.error ?? `HTTP ${r.status}`); return }
        setSaved(j.videoUrl); setMsg('Saved — the cabinet shows it within ~30 s')
    }
    const poolPng = mmlUrl ? mmlUrl.replace('arcade.mml', 'arcade-pool.png') : ''
    return (
        <div className="space-y-3 text-sm">
            <label className="block text-white/60 text-xs">Screen video (https, H.264 MP4)</label>
            <div className="flex gap-2">
                <input value={video} onChange={(e) => setVideo(e.target.value)} spellCheck={false}
                    className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 font-mono text-xs" />
                <button onClick={save} disabled={busy || !video || video === saved}
                    className="px-4 py-2 rounded bg-[#3b82f6] disabled:opacity-40 text-white text-xs font-semibold">Save</button>
            </div>
            {saved && <video src={saved} muted loop autoPlay playsInline className="w-full max-w-md rounded border border-white/10" />}
            {msg && <div className="text-xs text-white/60">{msg}</div>}
            {mmlUrl && (
                <div className="text-xs text-white/50 space-y-1">
                    <div>Cabinet MML (for Otherside): <a className="text-[#3b82f6] underline break-all" href={mmlUrl} target="_blank" rel="noreferrer">{mmlUrl}</a></div>
                    <div>Live pool board: <a className="text-[#3b82f6] underline break-all" href={poolPng} target="_blank" rel="noreferrer">{poolPng}</a></div>
                </div>
            )}
        </div>
    )
}
