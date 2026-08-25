import Link from "next/link";

import { Footer } from "@/components/site/Footer";
import { Nav } from "@/components/site/Nav";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-5 pt-32 pb-24 sm:px-8">
        <p className="label-micro mb-3">404</p>
        <h1 className="text-xl font-medium tracking-tight text-chalk sm:text-2xl">
          Nothing is published here.
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-chalk-dim">
          Either the route does not exist, or the identifier in it is not a well-formed{" "}
          <code className="rounded bg-ink-850 px-1 py-0.5 font-mono text-[0.8125rem] text-chalk">
            did:key
          </code>{" "}
          or note fingerprint. A DID&rsquo;s shape is checkable without a network call, so a
          malformed one is rejected here rather than sent to Technocore.
        </p>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-2xs">
          <Link href="/" className="text-agent-400 hover:text-agent-500">
            home
          </Link>
          <Link href="/app" className="text-chalk-faint hover:text-chalk">
            open the app
          </Link>
          <Link href="/docs" className="text-chalk-faint hover:text-chalk">
            docs
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
