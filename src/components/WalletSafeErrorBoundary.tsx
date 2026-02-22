"use client";

import React, { Component, type ReactNode } from "react";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary that catches and suppresses errors caused by
 * wallet browser extensions (MetaMask, Phantom, Rabby, etc.)
 * fighting over window.ethereum.
 * 
 * In production these are silent console errors.
 * In dev mode Next.js overlay shows them as fatal — this hides them.
 */
export class WalletSafeErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        // Check if error is from a wallet extension
        const msg = error.message || "";
        const isExtensionError =
            msg.includes("Cannot redefine property") ||
            msg.includes("ethereum") ||
            msg.includes("JSON-RPC") ||
            msg.includes("method call timeout");

        if (isExtensionError) {
            // Swallow the error — it's from a browser extension, not our code
            console.warn("[WalletSafeErrorBoundary] Suppressed extension error:", msg);
            return { hasError: false, error: null };
        }

        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        const msg = error.message || "";
        const isExtensionError =
            msg.includes("Cannot redefine property") ||
            msg.includes("ethereum") ||
            msg.includes("JSON-RPC") ||
            msg.includes("method call timeout");

        if (!isExtensionError) {
            console.error("[ErrorBoundary] Caught error:", error, errorInfo);
        }
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="flex items-center justify-center min-h-screen bg-black text-white">
                    <div className="text-center space-y-4">
                        <p className="text-lg font-semibold text-red-400">Something went wrong</p>
                        <button
                            onClick={() => this.setState({ hasError: false, error: null })}
                            className="px-4 py-2 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
