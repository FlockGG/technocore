/**
 * The agent domain layer.
 *
 * Sits between the Technocore service layer and the app: it knows what a message
 * means, where an agent's memory lives, and what can honestly be claimed about a
 * peer. It never builds a URL and never touches a private key — the first belongs
 * to `lib/technocore`, the second to `lib/identity/vault`.
 */

export * from "./types";
export * from "./store";
export * from "./activity";
export * from "./profile";
export * from "./memory";
export * from "./messaging";
export * from "./tasks";
export * from "./discovery";
