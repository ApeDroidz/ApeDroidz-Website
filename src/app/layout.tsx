import type React from "react";
import type { Metadata } from "next";
import Script from "next/script"; // <--- Импорт компонента Script

import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

import {
  Inter,
  JetBrains_Mono,
} from "next/font/google";
import { ReactQueryProvider } from "./react-query-provider";
import { ThirdwebAppProvider } from "./thirdweb-provider";
import { UserProgressProvider } from "@/components/user-progress-provider";

// Initialize fonts
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "ApeDroidz | Animated NFT Collection on ApeChain",
  description: "Fully animated NFT collection on ApeChain. Otherside 3D models & Pixel survival game.",
  keywords: ["ApeDroidz", "NFT", "ApeChain", "Animated NFT", "3D Avatars", "Otherside", "Pixel Game", "Web3"],
  authors: [{ name: "ApeDroidz" }],
  creator: "ApeDroidz",
  metadataBase: new URL("https://www.apedroidz.com"),
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.apedroidz.com",
    siteName: "ApeDroidz",
    title: "ApeDroidz | Animated NFT Collection on ApeChain",
    description: "Fully animated NFT collection on ApeChain. Otherside 3D models & Pixel survival game.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "ApeDroidz - Animated NFT Collection on ApeChain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ApeDroidz | Animated NFT Collection on ApeChain",
    description: "Fully animated NFT collection on ApeChain. Otherside 3D models & Pixel survival game.",
    images: ["/og-image.png"],
    creator: "@ApeDroidz",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preload критических ресурсов для ускорения загрузки */}
        <link rel="preconnect" href="https://rpc.apechain.com" />
        <link rel="dns-prefetch" href="https://rpc.apechain.com" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-black text-white`}>
        <ReactQueryProvider>
          <ThirdwebAppProvider>
            <UserProgressProvider>
              {children}
            </UserProgressProvider>

            {/* Vercel Analytics */}
            <Analytics />

            {/* Microsoft Clarity Integration */}
            <Script id="microsoft-clarity" strategy="afterInteractive">
              {`
                (function(c,l,a,r,i,t,y){
                    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "vb0r9ec6cz");
              `}
            </Script>

          </ThirdwebAppProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}