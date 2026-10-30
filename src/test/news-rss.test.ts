import { describe, expect, it } from "vitest";

import { mergeFeeds, parseRss, topSources } from "@/lib/news-rss";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"Bengaluru" - Google News</title>
<item>
  <title>Heavy rain floods Bengaluru roads &amp; cripples traffic - Deccan Herald</title>
  <link>https://news.google.com/rss/articles/a1?oc=5</link>
  <pubDate>Fri, 30 Oct 2026 09:15:00 GMT</pubDate>
  <source url="https://www.deccanherald.com">Deccan Herald</source>
</item>
<item>
  <title><![CDATA[BBMP opens 24x7 control rooms &#8211; The Hindu]]></title>
  <link>https://news.google.com/rss/articles/a2?oc=5</link>
  <pubDate>Fri, 30 Oct 2026 08:00:00 GMT</pubDate>
  <source url="https://www.thehindu.com">The Hindu</source>
</item>
<item>
  <title>No link here - The Hindu</title>
  <pubDate>Fri, 30 Oct 2026 07:00:00 GMT</pubDate>
</item>
</channel></rss>`;

describe("news RSS parsing", () => {
  it("parses real-shaped Google News RSS into items", () => {
    const items = parseRss(FEED);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Heavy rain floods Bengaluru roads & cripples traffic",
      source: "Deccan Herald",
      url: "https://news.google.com/rss/articles/a1?oc=5",
      publishedAt: "2026-10-30T09:15:00.000Z",
    });
    expect(items[1]?.title).toBe("BBMP opens 24x7 control rooms");
  });

  it("de-duplicates the same headline across queries and ranks operations news first", () => {
    const older = parseRss(FEED)[1]!;
    const newer = parseRss(FEED)[0]!;
    const merged = mergeFeeds([[older], [newer, older]]);

    expect(merged.map((n) => n.title)).toEqual([
      "Heavy rain floods Bengaluru roads & cripples traffic",
      "BBMP opens 24x7 control rooms",
    ]);
  });

  it("ranks publishers by how many headlines they supplied", () => {
    const items = parseRss(FEED);
    expect(topSources(items)).toEqual(["Deccan Herald", "The Hindu"]);
  });
});
