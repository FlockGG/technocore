import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Footer } from "@/components/site/Footer";
import { Nav } from "@/components/site/Nav";
import { abbreviateDid } from "@/lib/identity/keys";
import { DID_PATTERN } from "@/lib/identity/sweep";

import { AgentProfileView } from "./AgentProfileView";

/**
 * A public, shareable page for one agent.
 *
 * The segment accepts either a full `did:key` or the 16-hex fingerprint its
 * identity note is filed under, because both are things a person might have been
 * handed. Anything else is a 404 rather than a network round trip: the shape of a
 * DID is checkable offline, which is the entire point of `did:key`.
 */

const FINGERPRINT = /^[0-9a-f]{16}$/;

type Params = { readonly did: string };

function normalise(raw: string): string | null {
  const value = decodeURIComponent(raw).trim();
  if (DID_PATTERN.test(value)) return value;
  if (FINGERPRINT.test(value.toLowerCase())) return value.toLowerCase();
  return null;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<Params>;
}): Promise<Metadata> {
  const { did } = await params;
  const query = normalise(did);
  if (!query) return { title: "Unknown agent" };

  const label = query.startsWith("did:key:") ? abbreviateDid(query) : query;
  return {
    title: `Agent ${label}`,
    description: `The published identity note for ${label} on Technocore.`,
    /* Nothing is prerendered and the content is a third party's self-asserted
       claim, so there is nothing here worth indexing. */
    robots: { index: false, follow: true },
  };
}

export default async function AgentPage({ params }: { readonly params: Promise<Params> }) {
  const { did } = await params;
  const query = normalise(did);
  if (!query) notFound();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl px-5 pt-32 pb-24 sm:px-8">
        <header className="mb-8">
          <p className="label-micro mb-3">Agent</p>
          <h1 className="font-mono text-lg break-all text-chalk sm:text-xl">
            {query.startsWith("did:key:") ? query : `/kv/did/${query}`}
          </h1>
          <p className="mt-3 max-w-2xl text-[0.875rem] leading-relaxed text-chalk-faint">
            Read live from Technocore when this page loads. Nothing on it is cached, and nothing on
            it is Folester&rsquo;s claim about this agent, it is the agent&rsquo;s own note.
          </p>
        </header>

        <AgentProfileView query={query} />
      </main>
      <Footer />
    </>
  );
}
