"use client"

import { useEffect, useRef, useState } from "react"
import { layoutFooterLogos } from "./grid-art"

interface GridFooterProps {
    height?: number
    bgColor?: string
}

export function GridFooter({ height, bgColor = '#0247AF' }: GridFooterProps) {
    const ref = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)

    // Раскладка считается от реальной ширины подвала — та же математика, что у
    // выгрузки, поэтому скачанная картинка повторяет превью.
    useEffect(() => {
        const measure = () => setWidth(ref.current?.offsetWidth || 0)
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [height])

    const layout = width > 0 && height ? layoutFooterLogos(width, height) : null

    return (
        <div
            ref={ref}
            className="w-full h-full flex items-center justify-center transition-colors duration-500"
            style={{
                backgroundColor: bgColor,
                height: height || 'auto',
                gap: layout ? `${layout.gap}px` : undefined,
                padding: height ? 0 : '1.5rem 1rem',
            }}
        >
            {layout
                ? layout.items.map((logo) => (
                    <img
                        key={logo.src}
                        src={logo.src}
                        alt={logo.alt}
                        draggable={false}
                        style={{
                            // Лого приходят в разных цветах — красим все в белый.
                            filter: 'brightness(0) invert(1)',
                            height: `${logo.height}px`,
                            width: `${logo.width}px`,
                        }}
                    />
                ))
                : null}
        </div>
    )
}
