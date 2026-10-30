// Pure RSS helpers — no framework imports so they stay unit-testable.

export type NewsItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  /** ISO timestamp, or null when the feed omits / mangles pubDate. */
  publishedAt: string | null;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const hex = code[1]?.toLowerCase() === "x";
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function stripMarkup(input: string): string {
  return decodeEntities(
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function firstTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match?.[1] ? stripMarkup(match[1]) : "";
}

function normalizeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Google News titles are "Headline - Publisher"; drop the publisher suffix. */
function trimSourceSuffix(title: string, source: string): string {
  if (!source) return title;
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = new RegExp(`\\s+[-–—]\\s+${escaped}$`, "i");
  if (suffix.test(title)) return title.replace(suffix, "").trim();
  const cut = title.search(/\s[-–—]\s[^-–—]+$/);
  return cut > 20 ? title.slice(0, cut).trim() : title;
}

/**
 * Parse an RSS 2.0 document into news items.
 * Tolerant of stray whitespace / attributes, ignores items without a usable link.
 */
export function parseRss(xml: string, limit = 20): NewsItem[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  const items: NewsItem[] = [];

  for (const block of blocks) {
    const rawTitle = firstTag(block, "title");
    const url = firstTag(block, "link") || firstTag(block, "guid");
    if (!rawTitle || !url) continue;

    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    const source = firstTag(block, "source") || host || "News";
    const title = trimSourceSuffix(rawTitle, source);
    const pubDate = firstTag(block, "pubDate");
    const parsed = pubDate ? Date.parse(pubDate) : Number.NaN;

    items.push({
      id: url,
      title,
      source,
      url,
      publishedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    });

    if (items.length >= limit) break;
  }

  return items;
}

/** Civic/operational vocabulary a city control room cares about more than general city news. */
const STRONG_TERMS = [
  /\bflood/,
  /\bwaterlog/,
  /\btraffic/,
  /\bbbmp\b/,
  /\bdrain/,
  /\blake/,
  /\bmetro/,
  /\bpower\b/,
  /\bleak/,
  /\bfire\b/,
  /\baccident/,
  /\bdivert/,
  /\bbmtc\b/,
];

const WEATHER_TERMS = [
  /\brain/,
  /\bweather/,
  /\bimd\b/,
  /\bstorm/,
  /\bcyclone/,
  /\broad/,
  /\balert\b/,
];

const hits = (title: string, patterns: RegExp[]) =>
  patterns.filter((pattern) => pattern.test(title)).length;

/** Lower is better: older headlines fall behind if they are not operationally relevant. */
function rankScore(item: NewsItem, now: number): number {
  const title = item.title.toLowerCase();
  const ageHours = item.publishedAt
    ? Math.max(0, (now - Date.parse(item.publishedAt)) / 3_600_000)
    : 24 * 365;
  const credit =
    Math.min(3, hits(title, STRONG_TERMS)) * 18 + Math.min(2, hits(title, WEATHER_TERMS)) * 6;
  return ageHours - Math.min(credit, 72);
}

/** Merge feeds, de-duplicating by normalised headline, operational relevance first. */
export function mergeFeeds(feeds: NewsItem[][], limit = 12): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];

  for (const feed of feeds) {
    for (const item of feed) {
      const key = normalizeKey(item.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  const now = Date.now();
  return merged.sort((a, b) => rankScore(a, now) - rankScore(b, now)).slice(0, limit);
}

/** Most frequently appearing publishers, in feed order. */
export function topSources(items: NewsItem[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.source) continue;
    counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([source]) => source);
}
