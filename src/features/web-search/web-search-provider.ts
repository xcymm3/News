import { BochaWebSearchProvider } from "./bocha-web-search-provider";
import { getWebSearchConfig } from "./web-search-contract";
import { WebSearchProviderError } from "./web-search-provider-error";
import { TavilyWebSearchProvider } from "./tavily-web-search-provider";

export { WebSearchProviderError } from "./web-search-provider-error";

export function createConfiguredWebSearchProvider() {
  const config = getWebSearchConfig();

  if (!config) {
    throw new WebSearchProviderError("WEB_SEARCH_NOT_CONFIGURED", 503, "尚未配置全网搜索 API。请设置 WEB_SEARCH_PROVIDER 和 WEB_SEARCH_API_KEY。");
  }

  if (config.provider === "tavily") {
    return new TavilyWebSearchProvider(config);
  }

  if (config.provider === "bocha") {
    return new BochaWebSearchProvider(config);
  }

  throw new WebSearchProviderError(
    "WEB_SEARCH_PROVIDER_UNSUPPORTED",
    503,
    `当前尚未实现 ${config.provider} 搜索适配器，请使用 bocha 或 tavily。`,
  );
}
