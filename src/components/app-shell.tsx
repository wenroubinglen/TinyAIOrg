"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

// Routes that render without the floating sidebar overlay.
const BARE_ROUTES = new Set<string>(["/setup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showSidebar = !BARE_ROUTES.has(pathname);

  return (
    <main className="h-screen overflow-y-auto">
      {children}
      {/* Sidebar renders fixed floating widgets (search bar + corner button),
          so it does not participate in this layout's flow. */}
      {showSidebar && <Sidebar />}
    </main>
  );
}
