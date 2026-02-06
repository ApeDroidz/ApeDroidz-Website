"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { NFTItem } from "@/app/dashboard/page"
import { resolveImageUrl } from "@/lib/utils"
import { GridFooter } from "./grid-footer"

interface VisualGridProps {
    droids: NFTItem[]
    gridOrder: string[]
    onReorder: (newOrder: string[]) => void
    gridRef: React.RefObject<HTMLDivElement | null>
}

const SUPABASE_PROJECT_URL = "https://jpbalgwwwalofynoaavv.supabase.co"
const BLUE_BG = '#0247AF'
const ORANGE_BG = '#FF6C00'

// Check if droid is super
const isSuper = (item: NFTItem): boolean => {
    return (item.batteryType === 'Super') || !!item.metadata?.attributes?.some((a: any) =>
        (a.trait_type === "upgrade level" && a.value?.toLowerCase().includes("super")) ||
        (a.trait_type === "background" && a.value === "apechain_orange")
    )
}

const getAnimatedUrl = (item: NFTItem): string | null => {
    const level = item.level || 1
    if (level < 2) return null

    const tokenId = item.tokenId || item.id

    if (isSuper(item)) {
        return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/super-gif/${tokenId}.gif`
    }
    return `${SUPABASE_PROJECT_URL}/storage/v1/object/public/assets/level2-gif/${tokenId}.gif`
}

// Calculate optimal grid dimensions for N items (minimum 2)
const calculateGridDimensions = (count: number): { cols: number; rows: number } => {
    if (count < 2) return { cols: 2, rows: 1 }
    if (count === 2) return { cols: 2, rows: 1 }
    if (count === 3) return { cols: 3, rows: 1 }
    if (count === 4) return { cols: 2, rows: 2 }
    if (count === 5) return { cols: 3, rows: 2 }
    if (count === 6) return { cols: 3, rows: 2 }
    if (count <= 9) return { cols: 3, rows: 3 }
    if (count <= 12) return { cols: 4, rows: 3 }
    if (count <= 16) return { cols: 4, rows: 4 }
    if (count <= 20) return { cols: 5, rows: 4 }
    if (count <= 25) return { cols: 5, rows: 5 }

    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    return { cols, rows }
}

// Grid cell with animations
const GridCell = ({
    droid,
    index,
    bgColor,
    onDragStart,
    onDragEnter,
    onDragOver,
    onDrop,
    onDragEnd,
    isDragging,
    isDropTarget,
    draggedDroid
}: {
    droid: NFTItem | null
    index: number
    bgColor: string
    onDragStart: (index: number) => void
    onDragEnter: (index: number) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (index: number) => void
    onDragEnd: () => void
    isDragging: boolean
    isDropTarget: boolean
    draggedDroid: NFTItem | null
}) => {
    const [isLoaded, setIsLoaded] = useState(false)
    const dropTargetBg = bgColor === ORANGE_BG ? '#FF8C33' : '#0369A1'

    // Empty cell
    if (!droid) {
        return (
            <motion.div
                layout
                className={`w-full h-full flex items-center justify-center transition-colors duration-200`}
                style={{ backgroundColor: isDropTarget ? dropTargetBg : bgColor }}
                onDragOver={onDragOver}
                onDragEnter={() => onDragEnter(index)}
                onDrop={() => onDrop(index)}
                animate={{
                    scale: isDropTarget ? 1.02 : 1,
                    boxShadow: isDropTarget ? 'inset 0 0 20px rgba(255,255,255,0.3)' : 'none'
                }}
                transition={{ duration: 0.15 }}
            >
                {isDropTarget && draggedDroid ? (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 0.5, scale: 0.9 }}
                        className="w-3/4 h-3/4 rounded-lg overflow-hidden"
                    >
                        <img
                            src={resolveImageUrl(draggedDroid.image)}
                            alt="Preview"
                            className="w-full h-full object-cover opacity-60"
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </motion.div>
                ) : (
                    <span className="text-white/30 text-xl font-light">+</span>
                )}
            </motion.div>
        )
    }

    const animatedUrl = getAnimatedUrl(droid)
    const imageUrl = animatedUrl || resolveImageUrl(droid.image)

    return (
        <motion.div
            layout
            layoutId={droid.id}
            draggable
            onDragStart={() => onDragStart(index)}
            onDragEnter={() => onDragEnter(index)}
            onDragOver={onDragOver}
            onDrop={() => onDrop(index)}
            onDragEnd={onDragEnd}
            className="w-full h-full cursor-grab active:cursor-grabbing relative"
            style={{ backgroundColor: bgColor }}
            animate={{
                scale: isDragging ? 0.85 : isDropTarget ? 1.02 : 1,
                opacity: isDragging ? 0.5 : 1,
                zIndex: isDragging ? 50 : 1,
                boxShadow: isDragging
                    ? '0 20px 40px rgba(0,0,0,0.5)'
                    : isDropTarget
                        ? 'inset 0 0 0 3px rgba(255,255,255,0.5)'
                        : 'none'
            }}
            transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
                layout: { duration: 0.3 }
            }}
        >
            {!isLoaded && (
                <div className="absolute inset-0 animate-pulse" style={{ backgroundColor: bgColor }} />
            )}
            <img
                src={imageUrl}
                alt={droid.name}
                onLoad={() => setIsLoaded(true)}
                draggable={false}
                className={`w-full h-full object-cover block transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                style={{ imageRendering: 'pixelated', display: 'block', margin: 0, padding: 0 }}
                crossOrigin="anonymous"
            />

            {/* Drop target overlay */}
            <AnimatePresence>
                {isDropTarget && draggedDroid && !isDragging && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/40 flex items-center justify-center"
                    >
                        <motion.div
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            className="text-white text-center"
                        >
                            <div className="text-xs font-bold uppercase tracking-wider bg-white/20 px-2 py-1 rounded">
                                Swap
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}

export function VisualGrid({ droids, gridOrder, onReorder, gridRef }: VisualGridProps) {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
    const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

    // Measure container
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight
                })
            }
        }
        updateSize()
        window.addEventListener('resize', updateSize)
        return () => window.removeEventListener('resize', updateSize)
    }, [])

    // Check if majority are super (>50%)
    const isSuperMajority = useMemo(() => {
        if (droids.length === 0) return false
        const superCount = droids.filter(d => isSuper(d)).length
        return superCount > droids.length / 2
    }, [droids])

    const bgColor = isSuperMajority ? ORANGE_BG : BLUE_BG

    // Calculate dimensions based on droids count
    const { cols, rows } = useMemo(() => calculateGridDimensions(droids.length), [droids.length])
    const totalCells = cols * rows

    // Calculate optimal grid size
    const gridDimensions = useMemo(() => {
        if (containerSize.width === 0 || containerSize.height === 0) {
            return { width: 300, height: 300, cellSize: 100, footerHeight: 70 }
        }

        const availableHeight = containerSize.height
        const availableWidth = containerSize.width

        const maxCellByHeight = availableHeight / (rows + 0.7)
        const maxCellByWidth = availableWidth / cols

        // Use the smaller to ensure it fits - no max cap on mobile, use full space
        const cellSize = Math.min(maxCellByHeight, maxCellByWidth)

        const gridWidth = cellSize * cols
        const gridHeight = cellSize * rows
        const footerHeight = cellSize * 0.7

        return { width: gridWidth, height: gridHeight, cellSize, footerHeight }
    }, [containerSize, cols, rows])

    // Map droids by ID
    const droidMap = useMemo(() => new Map(droids.map(d => [d.id, d])), [droids])

    // Create ordered array
    const orderedDroids: (NFTItem | null)[] = useMemo(() => {
        const result: (NFTItem | null)[] = Array(totalCells).fill(null)
        const usedIds = new Set<string>()
        let fillIndex = 0

        for (let i = 0; i < gridOrder.length; i++) {
            const id = gridOrder[i]
            if (id && droidMap.has(id) && !usedIds.has(id)) {
                result[fillIndex] = droidMap.get(id)!
                usedIds.add(id)
                fillIndex++
            }
        }

        for (const droid of droids) {
            if (!usedIds.has(droid.id) && fillIndex < totalCells) {
                result[fillIndex] = droid
                usedIds.add(droid.id)
                fillIndex++
            }
        }

        return result
    }, [droids, gridOrder, totalCells, droidMap])

    const draggedDroid = useMemo(() => {
        if (draggedIndex === null) return null
        return orderedDroids[draggedIndex]
    }, [draggedIndex, orderedDroids])

    const handleDragStart = useCallback((index: number) => {
        setDraggedIndex(index)
    }, [])

    const handleDragEnter = useCallback((index: number) => {
        if (draggedIndex !== null && draggedIndex !== index) {
            setDropTargetIndex(index)
        }
    }, [draggedIndex])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
    }, [])

    const handleDrop = useCallback((targetIndex: number) => {
        if (draggedIndex === null || draggedIndex === targetIndex) {
            setDraggedIndex(null)
            setDropTargetIndex(null)
            return
        }

        const newOrder: string[] = orderedDroids.map(d => d?.id || '')
        const temp = newOrder[draggedIndex]
        newOrder[draggedIndex] = newOrder[targetIndex]
        newOrder[targetIndex] = temp

        onReorder(newOrder.filter(id => id !== ''))
        setDraggedIndex(null)
        setDropTargetIndex(null)
    }, [draggedIndex, orderedDroids, onReorder])

    const handleDragEnd = useCallback(() => {
        setDraggedIndex(null)
        setDropTargetIndex(null)
    }, [])

    // Not enough droids state
    if (droids.length < 2) {
        return (
            <div
                ref={(el) => {
                    (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                        ; (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                }}
                className="w-full h-full flex items-center justify-center p-4"
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="border-2 border-white/20 rounded-xl p-6 md:p-10 text-center max-w-xs"
                >
                    <p className="text-white/60 text-xs md:text-sm uppercase tracking-widest font-medium mb-2">
                        Minimum 2 Droidz Required
                    </p>
                    <p className="text-white/30 text-[10px] md:text-xs">
                        Select at least 2 droidz to create a grid
                    </p>
                </motion.div>
            </div>
        )
    }

    return (
        <div
            ref={(el) => {
                (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                    ; (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            }}
            className="w-full h-full flex items-center justify-center p-2 md:p-0"
        >
            {/* Container */}
            <motion.div
                layout
                className="flex flex-col overflow-hidden rounded-lg transition-colors duration-500"
                style={{
                    backgroundColor: bgColor,
                    width: gridDimensions.width,
                }}
            >
                {/* Grid */}
                <div
                    className="grid relative"
                    style={{
                        gridTemplateColumns: `repeat(${cols}, 1fr)`,
                        gridTemplateRows: `repeat(${rows}, 1fr)`,
                        gap: 0,
                        width: gridDimensions.width,
                        height: gridDimensions.height,
                        fontSize: 0,
                        lineHeight: 0,
                    }}
                >
                    {orderedDroids.map((droid, index) => (
                        <GridCell
                            key={`cell-${index}-${droid?.id || 'empty'}`}
                            droid={droid}
                            index={index}
                            bgColor={bgColor}
                            onDragStart={handleDragStart}
                            onDragEnter={handleDragEnter}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                            isDragging={draggedIndex === index}
                            isDropTarget={dropTargetIndex === index}
                            draggedDroid={draggedDroid}
                        />
                    ))}
                </div>

                {/* Footer */}
                <div style={{ height: gridDimensions.footerHeight, backgroundColor: bgColor }}>
                    <GridFooter height={gridDimensions.footerHeight} bgColor={bgColor} />
                </div>
            </motion.div>
        </div>
    )
}

export { calculateGridDimensions, isSuper, BLUE_BG, ORANGE_BG }
