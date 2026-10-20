/**
 * Where in the site the visitor is. Routes live in the URL hash (`#/`, `#/play/crucible`, `#/forge`),
 * so they work on a static host like GitHub Pages with no server rules, the back button works, and
 * the query string (`?seed`, `?debug`) is left alone.
 */
export type Route =
  | { readonly page: "lobby" }
  | { readonly page: "machine"; readonly machine: string }
  | { readonly page: "forge" };

export const LOBBY: Route = { page: "lobby" };
export const FORGE: Route = { page: "forge" };
export const machineRoute = (machine: string): Route => ({ page: "machine", machine });

/** Reads a route from a URL hash. Anything unrecognised, including an unknown machine, is the lobby. */
export function parseRoute(hash: string, machineIds: readonly string[]): Route {
  // Drop the leading "#" and any "?query" inside the hash, then split into parts; empty parts (from "//" or a trailing "/") are ignored.
  const path = hash.replace(/^#/, "").split("?")[0]!;
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length === 1 && parts[0] === "forge") return FORGE;
  if (parts.length === 2 && parts[0] === "play" && machineIds.includes(parts[1]!)) return machineRoute(parts[1]!);
  return LOBBY;
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case "lobby":
      return "#/";
    case "forge":
      return "#/forge";
    case "machine":
      return `#/play/${route.machine}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}
