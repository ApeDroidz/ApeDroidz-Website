/**
 * Every row of a query, page by page. PostgREST on this project answers at most 1000 rows
 * (max_rows — checked 29.09: `.limit(20000)` on survival_events came back with 1000), so a
 * `.limit(100_000)` silently stops at 1000 and every sum over it is short: the vault check, the
 * panel's totals. This walks `.range()` pages of 1000 until a short page or `cap` rows.
 *
 * `build` must make a FRESH query with a stable order (a unique column last, e.g. `.order('id')`),
 * or pages can overlap. `truncated` = the cap was hit; say so where the numbers are shown.
 */
const PAGE = 1000

export async function fetchAll<T>(
    build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
    opts: { cap?: number } = {},
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
    const cap = opts.cap ?? 50_000
    const rows: T[] = []
    for (let from = 0; from < cap; from += PAGE) {
        const { data, error } = await build().range(from, Math.min(from + PAGE, cap) - 1)
        if (error) return { rows, truncated: false, error: error.message }
        const page = (data as T[] | null) ?? []
        rows.push(...page)
        if (page.length < PAGE) return { rows, truncated: false, error: null }
    }
    return { rows, truncated: true, error: null }
}
