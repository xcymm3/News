export class WebSearchProviderError extends Error {
  constructor(
    readonly code: "WEB_SEARCH_NOT_CONFIGURED" | "WEB_SEARCH_PROVIDER_UNSUPPORTED" | "WEB_SEARCH_UNAVAILABLE" | "WEB_SEARCH_INVALID_RESPONSE",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebSearchProviderError";
  }
}
