"use client"

import { useUserProgressContext } from "@/components/user-progress-provider"

// Hook now just consumes the context
export const useUserProgress = () => {
    return useUserProgressContext()
}