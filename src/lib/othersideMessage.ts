/**
 * The text an Otherside player signs in the Hub dialog to sign in to Droidz Survival — one
 * source for the page that asks and the route that verifies (api/otherside/login).
 */
export function othersideLoginMessage(wallet: string, nonce: string): string {
    return `Droidz Survival — sign in\n\nWallet: ${wallet.toLowerCase()}\nNonce: ${nonce}\n\nThis proves you own this wallet. It is free and sends no transaction.`
}
