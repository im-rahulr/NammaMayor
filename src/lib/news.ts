import { createServerFn } from "@tanstack/react-start";

import { mergeFeeds, parseRss, topSources, type NewsItem } from "./news-rss";

export type NewsMode = "idle" | "storm" | "gas";

export type NewsPayload = {
  items: NewsItem[];
  sources: string[];
  queries: string[];
  updatedAt: string;
};

const MODES: NewsMode[] = ["idle", "storm", "gas"];

// City-ops queries per operating mode. Google News RSS is free and needs no key.
const QUERIES: Record<NewsMode, string[]> = {
  idle: [
    "Bengaluru BBMP when:7d",
    "Bengaluru traffic roads when:7d",
    "Bengaluru weather rain when:7d",
    "Bengaluru when:7d",
  ],
  storm: [
    "Bengaluru rain flood when:7d",
    "Bengaluru waterlogging when:7d",
    "Bengaluru weather alert when:7d",
    "Bengaluru when:7d",
  ],
  gas: [
    "Bengaluru gas leak when:7d",
    "Bengaluru fire when:7d",
    "Bengaluru HSR Layout when:7d",
    "Bengaluru when:7d",
  ],
};

const FEED_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_AGE_DAYS = 10;

// Google matches any query word, so keep only headlines with local context.
const CITY_CONTEXT =
  /bengaluru|bangalore|karnataka|bbmp|bmtc|namma metro|silk board|bellandur|whitefield|koramangala|\bhsr\b|\bbtm\b|electronic city|marathahalli|hebbal|yelahanka|jayanagar|indiranagar|malleshwaram/i;

// Headlines that match the incident the control room is currently simulating.
const MODE_TERMS: Record<NewsMode, RegExp> = {
  idle: CITY_CONTEXT,
  storm:
    /\brain|\bflood|\bwaterlog|\bstorm|\bcyclone|\bweather|\bimd\b|\bdownpour|\bmonsoon|\bdrain|\balert/i,
  gas: /\bgas\b|\bleak|\bfire\b|\bblast|\bexplosion|\bsmoke|\bhazard|\bevacuat|\bcordon|\bcylinder/i,
};

const cache = new Map<NewsMode, { at: number; payload: NewsPayload }>();

function modeFrom(value: unknown): NewsMode {
  return MODES.includes(value as NewsMode) ? (value as NewsMode) : "idle";
}

function feedUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: "en-IN",
    gl: "IN",
    ceid: "IN:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchFeed(query: string): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl(query), {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        "user-agent": "NammaMayorOS/2.0 (+city operations dashboard)",
      },
    });
    if (!response.ok) throw new Error(`RSS ${response.status} for "${query}"`);
    return parseRss(await response.text(), 40);
  } finally {
    clearTimeout(timer);
  }
}

async function loadNews(mode: NewsMode): Promise<NewsPayload> {
  const cached = cache.get(mode);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.payload;

  const queries = QUERIES[mode];
  const feeds = await Promise.allSettled(queries.map(fetchFeed));
  const fulfilled = feeds.filter(
    (f): f is PromiseFulfilledResult<NewsItem[]> => f.status === "fulfilled",
  );
  const items = mergeFeeds(
    fulfilled.map((f) => f.value),
    100,
  );

  const local = items.filter((item) => CITY_CONTEXT.test(item.title));
  const onTopic = local.filter((item) => MODE_TERMS[mode].test(item.title));
  const pool = onTopic.length >= 4 ? onTopic : local;

  // Drop stale results, but never pad the list with out-of-city headlines.
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const fresh = pool.filter((item) => !item.publishedAt || Date.parse(item.publishedAt) >= cutoff);
  const visible = (fresh.length >= 5 ? fresh : pool).slice(0, 14);

  // Every upstream failed: surface the error instead of pretending there is no news.
  if (fulfilled.length === 0) {
    const reason = feeds.find((f): f is PromiseRejectedResult => f.status === "rejected")?.reason;
    throw new Error(reason instanceof Error ? reason.message : "News feeds are unavailable");
  }

  const payload: NewsPayload = {
    items: visible,
    sources: topSources(visible),
    queries,
    updatedAt: new Date().toISOString(),
  };
  cache.set(mode, { at: Date.now(), payload });
  return payload;
}

export const getNews = createServerFn({ method: "GET" })
  .validator((input: { mode?: string } | undefined) => ({ mode: modeFrom(input?.mode) }))
  .handler(async ({ data }) => loadNews(data.mode));
