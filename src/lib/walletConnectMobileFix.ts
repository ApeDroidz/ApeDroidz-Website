/**
 * Phone wallets over WalletConnect (MetaMask / Rainbow in iPhone Safari): «I tap Sign, MetaMask
 * opens, and there is no request in it» (owner, 01.10.2026, iPhone XR). Two thirdweb 5.116 quirks
 * meet here, and this module straightens both without forking the library.
 *
 * 1. The signature is addressed to a chain the session does not have.
 *    thirdweb's WalletConnect account sends `personal_sign` to `eip155:<the chain it was connected
 *    with>` — ApeChain, 33139 (node_modules/thirdweb/dist/esm/wallets/wallet-connect/controller.js,
 *    createAccount → signMessage → `chain: eip155:${chain.id}`). A phone wallet approves a session
 *    only on the chains it already knows; MetaMask without ApeChain added approves mainnet and
 *    friends, not 33139. The sign client then refuses the request locally, before it is ever sent
 *    («Missing or invalid. request() chainId: eip155:33139», @walletconnect/sign-client
 *    isValidRequest) — but thirdweb has ALREADY opened the wallet app by deep link in the same tick
 *    (requestAndOpenWallet opens it right after `provider.request(...)`, whatever the outcome).
 *    So MetaMask comes up empty, every time, for everyone whose MetaMask has no ApeChain.
 *    A `personal_sign` signature does not depend on the chain (EIP-191, the server checks it with
 *    ecrecover — lib/walletAuth.ts), so when the target chain is not in the session we route the
 *    request over a chain that is. Payments stay on ApeChain: they go through switchChain, which
 *    adds ApeChain to the wallet first (lib/thirdweb.ts carries the chain's name and currency for
 *    that — without them the wallet refused to add it).
 *
 * 2. The dapp metadata told the wallet to «return» to the wallet itself.
 *    thirdweb fills our own `metadata.redirect` with the WALLET's links (metamask://,
 *    https://metamask.app.link). `redirect` is how a wallet gets back to the dapp; a browser tab
 *    has no link that reopens it, so the honest value is none, and the wallet shows its own
 *    «return to your browser» note instead of bouncing into itself.
 *
 * Both are patches on the UniversalProvider class (the one copy thirdweb itself loads —
 * node_modules/@walletconnect/universal-provider, 2.21.8, hoisted, no nested copy under thirdweb).
 * If that ever stops being the same module the patch simply does nothing and the old behaviour
 * returns — it never breaks connecting. Injected wallets (a wallet's in-app browser, desktop
 * extensions), Coinbase Wallet (its own SDK) and the Otherside Glyph login do not go through it.
 */

type Namespace = { chains?: string[]; accounts?: string[] }
type ProviderLike = {
    session?: { namespaces?: Record<string, Namespace> }
}
type RequestArgs = { method?: string }
type RequestFn = (this: ProviderLike, args: RequestArgs, chain?: string, expiry?: number) => Promise<unknown>
type InitFn = (opts: { metadata?: Record<string, unknown> } & Record<string, unknown>) => Promise<unknown>

/** Chain-agnostic signing methods: the signature is the same whichever chain carries the request. */
const CHAINLESS = new Set(['personal_sign', 'eth_sign'])
const MARK = '__apedroidzWcFix'

/** The chains the wallet approved in this session, as CAIP-2 ids («eip155:1»). */
export function sessionChains(session: ProviderLike['session']): string[] {
    const ns = session?.namespaces?.eip155
    if (!ns) return []
    const out = new Set<string>(ns.chains ?? [])
    for (const a of ns.accounts ?? []) {
        const [space, ref] = a.split(':')
        if (space && ref) out.add(`${space}:${ref}`)
    }
    return Array.from(out)
}

/** The chain to send a request over: the asked one if approved, else for a chainless signature the first approved one. */
export function routeChain(method: string | undefined, chain: string | undefined, approved: string[]): string | undefined {
    if (!chain || !method || !CHAINLESS.has(method) || approved.length === 0) return chain
    if (approved.includes(chain)) return chain
    // Mainnet first when the wallet approved it — every wallet has it, and its signing screen is the plainest.
    return approved.includes('eip155:1') ? 'eip155:1' : approved[0]
}

let installing: Promise<void> | null = null

/** Install once per page; safe to call from any client component. */
export function installWalletConnectMobileFix(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve()
    if (installing) return installing
    installing = import('@walletconnect/universal-provider')
        .then((mod) => {
            const UP = (mod.UniversalProvider ?? mod.default) as unknown as {
                prototype: { request: RequestFn } & Record<string, unknown>
                init: InitFn
            } & Record<string, unknown>
            if (!UP?.prototype || UP.prototype[MARK]) return
            UP.prototype[MARK] = true

            const request = UP.prototype.request
            UP.prototype.request = function patchedRequest(this: ProviderLike, args, chain, expiry) {
                const routed = routeChain(args?.method, chain, sessionChains(this.session))
                return request.call(this, args, routed, expiry)
            }

            const init = UP.init.bind(UP)
            UP.init = (opts) => {
                const metadata = opts?.metadata ? { ...opts.metadata } : undefined
                if (metadata) delete metadata.redirect
                return init(metadata ? { ...opts, metadata } : opts)
            }
        })
        .catch(() => { /* the library moved — keep thirdweb's own behaviour */ })
    return installing
}
