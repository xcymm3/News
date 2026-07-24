import { processRawNewsArticles } from "./article-processing";
import { getLatestLiveNews } from "./live-news-source";

export async function getProcessedLiveNews() {
  const liveNews = await getLatestLiveNews();
  const processedNews = processRawNewsArticles(liveNews.articles);

  return {
    ...liveNews,
    ...processedNews,
  };
}
