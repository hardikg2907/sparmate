import { lookup } from "node:dns/promises";
import { FRIENDLY_HOST } from "./security";

type Lookup = (host: string) => Promise<{ address: string }[]>;

const lookupAll: Lookup = (host) => lookup(host, { all: true });

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

/** Some resolvers do not answer `*.localhost`, so the printed address falls back to the raw loopback IP. */
export async function displayHost(resolve: Lookup = lookupAll): Promise<string> {
  try {
    const addresses = await resolve(FRIENDLY_HOST);
    if (addresses.length > 0 && addresses.every((a) => isLoopback(a.address))) return FRIENDLY_HOST;
  } catch {
    // Fall through to the IP.
  }
  return "127.0.0.1";
}
