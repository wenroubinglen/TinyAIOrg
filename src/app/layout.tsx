import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { PermissionAskToast } from "@/components/agent/permission-ask-toast";
// Root-level phase banner: booting progress, degraded debounce, unreachable retry.
import { ConnectionPhaseBanner } from "@/components/connection-phase-banner";

export const metadata: Metadata = {
  title: "TinyOrg 工作台",
  description: "TinyOrg — AI 团队协作工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          {/* Global permission dialogs, one window per agent (SSE + polling sources). */}
          <PermissionAskToast />
          {/* Global connection phase banner */}
          <ConnectionPhaseBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
