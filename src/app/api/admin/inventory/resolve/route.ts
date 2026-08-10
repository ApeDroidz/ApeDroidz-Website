import { NextResponse } from 'next/server'
import { getContract, readContract } from 'thirdweb'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { requireAdmin } from '@/lib/adminAuth'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { detectTokenStandard } from '@/lib/tokenStandard'
import { parseNftRef, type ResolvedRef } from '@/lib/nftRef'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/inventory/resolve
 * Body: { refs: string[] }
 *
 * Разбирает ссылки на NFT и возвращает всё, что нужно, чтобы завести приз:
 * имя, картинку, стандарт токена и — главное — лежит ли токен в призовом
 * волте. Последняя проверка не косметическая: семь призов в марте не доехали
 * победителям именно потому, что в базе они числились, а физически волту не
 * принадлежали, и перевод отлетал с ERC721InsufficientApproval.
 */

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'
const MAX_REFS = 50

function ipfsToHttp(url: string): string {
    if (url.startsWith('ipfs://')) {
        return IPFS_GATEWAY + url.replace(/^ipfs:\/\/(ipfs\/)?/, '')
    }
    return url
}

async function fetchMetadata(uri: string): Promise<{ name?: string; image?: string }> {
    const url = ipfsToHttp(uri)

    // data:application/json;base64,... — часть контрактов отдаёт метаданные инлайном
    if (url.startsWith('data:')) {
        const comma = url.indexOf(',')
        const payload = url.slice(comma + 1)
        const json = url.slice(0, comma).includes('base64')
            ? Buffer.from(payload, 'base64').toString('utf8')
            : decodeURIComponent(payload)
        const meta = JSON.parse(json)
        return { name: meta?.name, image: meta?.image }
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) throw new Error(`metadata ${res.status}`)
    const meta = await res.json()
    return { name: meta?.name, image: meta?.image ?? meta?.image_url }
}

export async function POST(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    const refs: string[] = Array.isArray(body?.refs) ? body.refs : []
    if (!refs.length) return NextResponse.json({ error: 'refs required' }, { status: 400 })
    if (refs.length > MAX_REFS) {
        return NextResponse.json({ error: `too many refs (max ${MAX_REFS})` }, { status: 400 })
    }

    const pk = process.env.PRIZE_VAULT_PRIVATE_KEY
    if (!pk) return NextResponse.json({ error: 'PRIZE_VAULT_PRIVATE_KEY not set' }, { status: 500 })

    const client = createServerThirdwebClient()
    const vault = privateKeyToAccount({ client, privateKey: pk }).address

    async function resolveOne(ref: string): Promise<ResolvedRef> {
        const parsed = parseNftRef(ref)
        if (!parsed) return { ref, ok: false, error: 'не разобрал ссылку — нужен адрес контракта и id токена' }

        const { contract: address, tokenId } = parsed
        const base: ResolvedRef = { ref, ok: false, contract: address, tokenId }

        try {
            const standard = await detectTokenStandard({ client, chain: apeChainServer, address })
            const contract = getContract({ client, chain: apeChainServer, address })

            // Владение и метаданные тянем параллельно — оба по одному вызову.
            const [balance, uri] = await Promise.all([
                standard === 'erc1155'
                    ? readContract({
                        contract,
                        method: 'function balanceOf(address account, uint256 id) view returns (uint256)',
                        params: [vault, BigInt(tokenId)],
                    }).then(Number).catch(() => 0)
                    : readContract({
                        contract,
                        method: 'function ownerOf(uint256 tokenId) view returns (address)',
                        params: [BigInt(tokenId)],
                    }).then((o) => (String(o).toLowerCase() === vault.toLowerCase() ? 1 : 0)).catch(() => 0),
                (standard === 'erc1155'
                    ? readContract({
                        contract,
                        method: 'function uri(uint256 id) view returns (string)',
                        params: [BigInt(tokenId)],
                    })
                    : readContract({
                        contract,
                        method: 'function tokenURI(uint256 tokenId) view returns (string)',
                        params: [BigInt(tokenId)],
                    })
                ).catch(() => ''),
            ])

            let name: string | undefined
            let imageUrl: string | undefined
            if (uri) {
                try {
                    // ERC1155 разрешает {id} в шаблоне uri — подставляем 64-символьный hex.
                    const filled = String(uri).replace(
                        '{id}',
                        BigInt(tokenId).toString(16).padStart(64, '0')
                    )
                    const meta = await fetchMetadata(filled)
                    name = meta.name
                    imageUrl = meta.image ? ipfsToHttp(meta.image) : undefined
                } catch { /* метаданные не критичны — имя можно вписать руками */ }
            }

            return {
                ...base,
                ok: true,
                standard,
                name,
                imageUrl,
                vaultBalance: balance,
                inVault: balance > 0,
            }
        } catch (e: any) {
            return { ...base, error: e?.message ?? 'resolve failed' }
        }
    }

    const items = await Promise.all(refs.map(resolveOne))
    return NextResponse.json({ vault, items }, { headers: { 'cache-control': 'no-store' } })
}
