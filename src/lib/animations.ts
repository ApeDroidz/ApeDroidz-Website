import { Variants } from "framer-motion"

// === TIMING CONSTANTS ===
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const
export const EASE_OUT_BACK = [0.34, 1.56, 0.64, 1] as const

// === STAGGER CONTAINERS ===
export const staggerContainer: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.08,
            delayChildren: 0.1,
        },
    },
}

export const staggerContainerFast: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05,
            delayChildren: 0.05,
        },
    },
}

// === FADE VARIANTS ===
export const fadeIn: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
}

export const fadeUp: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, ease: EASE_OUT_EXPO },
    },
}

export const fadeUpSoft: Variants = {
    hidden: { opacity: 0, y: 12 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
}

// === SLIDE VARIANTS ===
export const slideInLeft: Variants = {
    hidden: { opacity: 0, x: -30 },
    show: {
        opacity: 1,
        x: 0,
        transition: { duration: 0.6, ease: EASE_OUT_EXPO },
    },
}

export const slideInRight: Variants = {
    hidden: { opacity: 0, x: 30 },
    show: {
        opacity: 1,
        x: 0,
        transition: { duration: 0.6, ease: EASE_OUT_EXPO },
    },
}

export const slideInBottom: Variants = {
    hidden: { opacity: 0, y: 30 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.6, ease: EASE_OUT_EXPO },
    },
}

// === SCALE VARIANTS ===
export const scaleIn: Variants = {
    hidden: { opacity: 0, scale: 0.95 },
    show: {
        opacity: 1,
        scale: 1,
        transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
}

export const scaleInBounce: Variants = {
    hidden: { opacity: 0, scale: 0.9 },
    show: {
        opacity: 1,
        scale: 1,
        transition: { duration: 0.5, ease: EASE_OUT_BACK },
    },
}

// === MODAL VARIANTS ===
export const modalOverlay: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.2 } },
    exit: { opacity: 0, transition: { duration: 0.15 } },
}

export const modalContent: Variants = {
    hidden: { opacity: 0, scale: 0.95, y: 10 },
    show: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            duration: 0.3,
            ease: EASE_OUT_EXPO,
        },
    },
    exit: {
        opacity: 0,
        scale: 0.98,
        y: 5,
        transition: { duration: 0.2 },
    },
}

// === SPECIAL EFFECTS ===
export const heroText: Variants = {
    hidden: { opacity: 0, scale: 0.8, y: 20 },
    show: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            duration: 0.7,
            ease: EASE_OUT_BACK,
        },
    },
}

export const lineExpand: Variants = {
    hidden: { scaleX: 0, opacity: 0 },
    show: {
        scaleX: 1,
        opacity: 1,
        transition: { duration: 0.6, ease: EASE_OUT_EXPO },
    },
}

// === LIST ITEM (for staggered children) ===
export const listItem: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
}

export const listItemFromRight: Variants = {
    hidden: { opacity: 0, x: 20 },
    show: {
        opacity: 1,
        x: 0,
        transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
}

// === HOVER/TAP PRESETS (use with whileHover/whileTap) ===
export const hoverScale = {
    scale: 1.02,
    transition: { duration: 0.2 },
}

export const hoverScaleLarge = {
    scale: 1.05,
    transition: { duration: 0.2 },
}

export const tapScale = {
    scale: 0.98,
    transition: { duration: 0.1 },
}

// === UTILITY: Create delayed variant ===
export const withDelay = (variant: Variants, delay: number): Variants => {
    const result: Variants = { ...variant }
    // Ensure 'show' exists, is an object, and NOT an array (VariantLabels are arrays)
    if (result.show && typeof result.show === "object" && !Array.isArray(result.show)) {
        result.show = {
            ...result.show,
            transition: {
                ...(result.show.transition || {}),
                delay,
            },
        }
    }
    return result
}