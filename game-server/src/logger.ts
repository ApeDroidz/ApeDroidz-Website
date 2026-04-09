/**
 * Structured logger for the game server.
 * Outputs JSON lines — Railway captures and indexes them.
 * Format: { ts, level, event, ...data }
 */

type Level = 'info' | 'warn' | 'error' | 'debug'

function log(level: Level, event: string, data?: Record<string, unknown>): void {
    const entry = {
        ts: new Date().toISOString(),
        level,
        event,
        ...data,
    }
    if (level === 'error') {
        console.error(JSON.stringify(entry))
    } else {
        console.log(JSON.stringify(entry))
    }
}

export const logger = {
    info:  (event: string, data?: Record<string, unknown>) => log('info',  event, data),
    warn:  (event: string, data?: Record<string, unknown>) => log('warn',  event, data),
    error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
    debug: (event: string, data?: Record<string, unknown>) => {
        if (process.env.LOG_LEVEL === 'debug') log('debug', event, data)
    },
}
