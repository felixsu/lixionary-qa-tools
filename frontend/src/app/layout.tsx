import type { Metadata } from "next";
import { Inter, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { AppProvider } from "./context/AppContext";
import { BackendStatusProvider } from "./context/BackendStatusContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Lixionary Automation Explorer",
  description: "Collaborative API automation, variable chaining, and Playwright POM generation engine.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cormorant.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <BackendStatusProvider>
          <AppProvider>
            <Suspense fallback={null}>
              {children}
            </Suspense>
          </AppProvider>
        </BackendStatusProvider>
      </body>
    </html>
  );
}
