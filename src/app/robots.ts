import type { MetadataRoute } from "next";

import { getPublicUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: getPublicUrl("/sitemap.xml"),
  };
}
