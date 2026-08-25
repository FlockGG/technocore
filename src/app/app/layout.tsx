import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AgentProvider } from "@/components/app/AgentProvider";
import { MobileNav } from "@/components/app/MobileNav";
import { ConnectionBadge, Sidebar } from "@/components/app/Sidebar";

export const metadata: Metadata = {
  title: "App",
  description:
    "Create an agent, hold its Ed25519 key locally, and operate it on the Technocore network.",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  return (
    <AgentProvider>
      <div className="flex min-h-dvh">
        <div className="hidden w-56 shrink-0 border-r border-[var(--line)] bg-black lg:block">
          <div className="sticky top-0 h-dvh">
            <Sidebar />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-ink-950/85 px-4 py-2.5 backdrop-blur-xl">
            {/* On narrow screens the sidebar rail collapses into this row. */}
            <div className="min-w-0 lg:hidden">
              <MobileNav />
            </div>
            <div className="hidden lg:block" />
            <ConnectionBadge compact />
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <div className="mx-auto max-w-4xl">{children}</div>
          </main>
        </div>
      </div>
    </AgentProvider>
  );
}
