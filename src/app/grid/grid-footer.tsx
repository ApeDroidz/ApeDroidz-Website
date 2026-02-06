"use client"

interface GridFooterProps {
    height?: number
    bgColor?: string
}

export function GridFooter({ height, bgColor = '#0247AF' }: GridFooterProps) {
    return (
        <div
            className="w-full h-full flex items-center justify-center gap-4 md:gap-6 transition-colors duration-500"
            style={{
                backgroundColor: bgColor,
                height: height || 'auto',
                padding: height ? 0 : '1.5rem 1rem'
            }}
        >
            {/* Logos only */}
            <img
                src="/Apechain.svg"
                alt="ApeChain"
                className="h-5 md:h-6 w-auto"
                style={{ filter: 'brightness(0) invert(1)' }}
            />
            <img
                src="/full-logo.svg"
                alt="ApeDroidz"
                className="h-6 md:h-7 w-auto brightness-0 invert"
            />
        </div>
    )
}
