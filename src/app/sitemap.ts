import type { MetadataRoute } from "next";

import { DigestNotFoundError, digestService } from "@/features/digest/digest-service";
import { getPublicUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const homeEntry: MetadataRoute.Sitemap[number] = {
    url: getPublicUrl("/"),
    lastModified: new Date(),
    changeFrequency: "daily",
    priority: 1,
  };

  try {
    const digest = await digestService.getTodayDigest();
    const lastModified = new Date(digest.publishedAt);

    return [
      {
        ...homeEntry,
        lastModified,
      },
      ...digest.stories.map((story) => ({
        url: getPublicUrl(`/digest/${story.id}`),
        lastModified: new Date(story.updatedAt),
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    if (!(error instanceof DigestNotFoundError)) {
      console.error("Failed to generate the sitemap from today's digest.", error);
    }

    return [homeEntry];
  }
}
