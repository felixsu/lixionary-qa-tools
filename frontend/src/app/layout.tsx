import type { Metadata } from "next";
import { Inter, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { AppProvider } from "./context/AppContext";
import { WebExplorerProvider } from "./context/WebExplorerContext";
import { BackendStatusProvider } from "./context/BackendStatusContext";
import { SearchIndexStatusProvider } from "./context/SearchIndexStatusContext";
import { FlowRunsProvider } from "./context/FlowRunsContext";
import { ToastProvider } from "./context/ToastContext";
import TauriOnlyGate from "./components/TauriOnlyGate";
import GlobalDropGuard from "./components/GlobalDropGuard";

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
        <GlobalDropGuard />
        <TauriOnlyGate>
          <BackendStatusProvider>
            <SearchIndexStatusProvider>
              <FlowRunsProvider>
                <ToastProvider>
                  <AppProvider>
                    {/* Root-level so the live browser session (WebSocket +
                        screencast) survives navigating between modules. */}
                    <WebExplorerProvider>
                      <Suspense fallback={null}>
                        {children}
                      </Suspense>
                    </WebExplorerProvider>
                  </AppProvider>
                </ToastProvider>
              </FlowRunsProvider>
            </SearchIndexStatusProvider>
          </BackendStatusProvider>
        </TauriOnlyGate>
      </body>
    </html>
  );
}
