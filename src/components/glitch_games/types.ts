export interface GlitchQuest {
    id: string
    category: 'base' | 'progression' | 'social' | 'gameplay' | 'skill' | 'economy'
    title: string
    description: string
    required_cards: number
    required_flights: number
    required_multiplier: number
    xp_reward: number
    ticket_reward: number
    is_holder_only: boolean
    sort_order: number
    // progress
    cards_played: number
    flights_played: number
    max_multiplier: number
    claimed_at: string | null
    is_complete: boolean
}

export interface StreakData {
    current_streak: number
    best_streak: number
    last_active_date: string | null
    streak_reward_claimed_day: number
    is_active_today: boolean
}

export interface Season2Data {
    season_xp: number
    s2_level: number
    s2_rank_title: string
    games_played: number
}

export interface GlitchDashboard {
    isHolder: boolean
    season2: Season2Data
    s1_xp: number
    games_balance: number
    ape_balance: number
    daily_quests: GlitchQuest[]
    weekly_quests: GlitchQuest[]
    streak: StreakData
}

// Streak day reward config (mirrors SQL)
export const STREAK_REWARDS = [
    { day: 1, xp: 50,   ticket: 0, ape: 0 },
    { day: 2, xp: 100,  ticket: 0, ape: 0 },
    { day: 3, xp: 200,  ticket: 1, ape: 0 },
    { day: 4, xp: 350,  ticket: 0, ape: 0 },
    { day: 5, xp: 500,  ticket: 1, ape: 0 },
    { day: 6, xp: 750,  ticket: 0, ape: 0 },
    { day: 7, xp: 1000, ticket: 0, ape: 5 },
]

export const S2_LEVEL_MILESTONES = [0, 500, 1500, 3000, 6000, 12000, 25000, 50000, 100000, 200000]

export function getS2LevelProgress(xp: number) {
    let level = 1
    for (let i = 0; i < S2_LEVEL_MILESTONES.length; i++) {
        if (xp >= S2_LEVEL_MILESTONES[i]) level = i + 1
        else break
    }
    const currentMilestone = S2_LEVEL_MILESTONES[level - 1] ?? 0
    const nextMilestone = S2_LEVEL_MILESTONES[level] ?? (xp * 1.5)
    const range = nextMilestone - currentMilestone
    const earned = xp - currentMilestone
    const progress = range > 0 ? Math.min((earned / range) * 100, 99.9) : 0
    return { level, currentMilestone, nextMilestone, progress }
}

export function getPeriodKey(type: 'daily' | 'weekly'): string {
    const now = new Date()
    if (type === 'daily') {
        return now.toISOString().slice(0, 10) // YYYY-MM-DD UTC
    }
    // ISO week: YYYY-IW
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`
}
