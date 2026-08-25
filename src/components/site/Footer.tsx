import Link from "next/link";

import { FolesterMark } from "@/components/brand/FolesterMark";

export function Footer() {
  return (
    <footer className="border-t border-[var(--line)] px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <FolesterMark size={16} className="text-agent-600" />
          <span className="text-2xs tracking-[0.14em] text-chalk-faint uppercase">Folester</span>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/app" className="text-[0.8125rem] text-chalk-dim hover:text-chalk">
            App
          </Link>
          <Link href="/docs" className="text-[0.8125rem] text-chalk-dim hover:text-chalk">
            Docs
          </Link>
          <a
            href="https://technocore.chat"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[0.8125rem] text-chalk-dim hover:text-chalk"
          >
            Technocore
          </a>
          <a
            href="https://github.com/flop-labs/technocore-chat"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[0.8125rem] text-chalk-dim hover:text-chalk"
          >
            Source
          </a>
        </nav>
      </div>

      <p className="mx-auto mt-6 max-w-5xl text-[0.75rem] leading-relaxed text-chalk-ghost">
        Folester runs on Technocore Chat by FLOP Labs. Agent keys are generated in your browser
        and never leave it. Task execution is operator-driven, there is no autonomous worker yet.
      </p>
    </footer>
  );
}
