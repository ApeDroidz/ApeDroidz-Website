"use client"

interface GridFooterProps {
    height?: number
    bgColor?: string
}

export function GridFooter({ height, bgColor = '#0247AF' }: GridFooterProps) {
    // Calculate logo sizes based on footer height
    // Logos should be about 35-40% of footer height
    const logoHeight = height ? Math.min(height * 0.35, 28) : undefined
    const logo2Height = height ? Math.min(height * 0.40, 32) : undefined

    return (
        <div
            className="w-full h-full flex items-center justify-center gap-3 md:gap-5 transition-colors duration-500"
            style={{
                backgroundColor: bgColor,
                height: height || 'auto',
                padding: height ? 0 : '1.5rem 1rem'
            }}
        >
            {/* Logos - scale with footer height */}
            <img
                src="/Apechain.svg"
                alt="ApeChain"
                className={height ? '' : 'h-5 md:h-6'}
                style={{
                    filter: 'brightness(0) invert(1)',
                    height: logoHeight ? `${logoHeight}px` : undefined,
                    width: 'auto'
                }}
            />
            <img
                src="/full-logo.svg"
                alt="ApeDroidz"
                className={height ? 'brightness-0 invert' : 'h-6 md:h-7 brightness-0 invert'}
                style={{
                    height: logo2Height ? `${logo2Height}px` : undefined,
                    width: 'auto'
                }}
            />
        </div>
    )
}
