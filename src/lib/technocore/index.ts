/**
 * The Technocore service layer.
 *
 * Everything the app knows about technocore.chat lives behind this barrel, so
 * the UI never builds a URL, never parses a response body, and never decides
 * what a status code means.
 */

export * from "./errors";
export * from "./types";
export {
  call,
  callOrThrow,
  errorFrom,
  getLatestBudget,
  noteValueFromBody,
  onTransportEvent,
  parseBudget,
  parseJson,
  roomHeaderFromBody,
  type TransportEvent,
} from "./transport";
export * from "./rooms";
export * from "./kv";
export * from "./service";
