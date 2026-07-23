import * as cheerio from "cheerio";

const WANDLITZ_URLS = [
  process.env.WANDLITZ_SOURCE_URL,
  "https://www.wandlitz.de/veranstaltungen/",
  "https://www.wandlitz.de/veranstaltungen/index.php"
].filter((value, index, values) => value && values.indexOf(value) === index);
const WANDLITZ_URL = WANDLITZ_URLS[0];
const WANDLITZ_READER_URL =
  process.env.WANDLITZ_READER_URL ||
  "https://r.jina.ai/https://www.wandlitz.de/veranstaltungen/";
const BERNAU_URL =
  process.env.BERNAU_SOURCE_URL || "https://www.bernau-besuchen.de/veranstaltungen-2";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 160;

const WANDLITZ_EVENT_PATH_RE =
  /\/veranstaltungen\/\d+\/(\d{4})\/(\d{2})\/(\d{2})\/[^?#]+\.html/i;
const BERNAU_EVENT_PATH_RE = /\/veranstaltungen\/(?!index\.html)[^/?#]+\.html$/i;
const GERMAN_DATE_RE =
  /^(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag),?\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s*(\d{4})$/i;

const MONTHS = {
  jan: 1,
  januar: 1,
  feb: 2,
  februar: 2,
  mär: 3,
  maerz: 3,
  märz: 3,
  apr: 4,
  april: 4,
  mai: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dezember: 12
};

const BERNAU_CATEGORIES = new Set(
  [
    "ausstellung",
    "begegnung",
    "essen und trinken",
    "familien",
    "führung / besichtigung",
    "gesundheit / wellness",
    "gottesdienste",
    "kinder und jugendliche",
    "klassisches konzert/oper",
    "konzert",
    "kurse",
    "lesung",
    "markt",
    "sport",
    "theater / tanz / kabarett / musical",
    "und sonst",
    "workshop"
  ].map((value) => value.toLocaleLowerCase("de-DE"))
);

function normalize(value = "") {
  return String(value)
    .replace(/\u200b|\u00ad/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function berlinToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0"
  )}-${String(day).padStart(2, "0")}`;
}

function monthNumber(value) {
  const key = normalize(value)
    .toLocaleLowerCase("de-DE")
    .replace(/\./g, "");
  return MONTHS[key] || MONTHS[key.slice(0, 3)] || null;
}

function parseGermanHeadingDate(text) {
  const match = normalize(text).match(GERMAN_DATE_RE);
  if (!match) return null;
  const month = monthNumber(match[2]);
  if (!month) return null;
  return isoDate(Number(match[3]), month, Number(match[1]));
}

function parseLastGermanDate(text, fallbackStartDate) {
  const matches = [
    ...normalize(text).matchAll(
      /(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\.?\s*(\d{4})/g
    )
  ];

  if (!matches.length) return fallbackStartDate;

  const last = matches[matches.length - 1];
  const month = monthNumber(last[2]);
  if (!month) return fallbackStartDate;

  return isoDate(Number(last[3]), month, Number(last[1]));
}

function parseTimes(text) {
  const match = normalize(text).match(
    /(\d{1,2}:\d{2})(?:\s*(?:–|—|-|bis)\s*(\d{1,2}:\d{2}))?\s*(?:Uhr)?/i
  );
  if (!match) return { startTime: null, endTime: null, match: null };

  return {
    startTime: match[1].padStart(5, "0"),
    endTime: match[2] ? match[2].padStart(5, "0") : null,
    match
  };
}

function eventSortKey(event) {
  return `${event.startDate}T${event.startTime || "00:00"}|${event.title}`;
}

function sortAndFilter(events) {
  const today = berlinToday();
  return events
    .filter((event) => (event.endDate || event.startDate) >= today)
    .sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b), "de"));
}

function leafTextLines($, container) {
  const lines = [];
  const seen = new Set();

  container.find("*").each((_, element) => {
    const item = $(element);
    if (item.children().length) return;
    const value = normalize(item.text());
    if (!value || value.length > 260 || seen.has(value)) return;
    seen.add(value);
    lines.push(value);
  });

  return lines;
}

function dateFromWandlitzUrl(url) {
  const match = new URL(url).pathname.match(WANDLITZ_EVENT_PATH_RE);
  if (!match) return null;
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function isWandlitzEventHref(href) {
  if (!href) return false;
  try {
    return WANDLITZ_EVENT_PATH_RE.test(new URL(href, WANDLITZ_URL).pathname);
  } catch {
    return false;
  }
}

function chooseWandlitzCard($, link) {
  let node = $(link);
  let best = node.parent();

  for (let depth = 0; depth < 8; depth += 1) {
    node = node.parent();
    if (!node.length) break;

    const text = normalize(node.text());
    const eventLinkCount = node
      .find("a[href]")
      .filter((_, anchor) => isWandlitzEventHref($(anchor).attr("href"))).length;

    if (eventLinkCount === 1 && text.length >= 20 && text.length <= 1600) {
      best = node;
      if (
        node.is("article, li") ||
        /veranstaltung|event|termin/i.test(node.attr("class") || "")
      ) {
        break;
      }
    }
  }

  return best;
}

function looksLikeWandlitzMetadata(line, title) {
  if (!line) return true;
  const lower = line.toLocaleLowerCase("de-DE");

  return (
    line === title ||
    title.includes(line) ||
    line.includes(title) ||
    /\b(?:mo|di|mi|do|fr|sa|so)\.?,?\s+\d{1,2}\./i.test(line) ||
    /\d{1,2}:\d{2}/.test(line) ||
    /^(uhr|mehr|weiter|details|veranstaltung)$/i.test(line) ||
    /veranstaltung kostenlos melden/i.test(line) ||
    /^(listenansicht|kalender ansicht)$/i.test(line) ||
    lower.length < 3
  );
}

function extractWandlitzLocation($, link, card, title) {
  const heading = $(link).closest("h1,h2,h3,h4");

  if (heading.length) {
    const siblingCandidates = [];
    heading
      .nextAll()
      .slice(0, 4)
      .each((_, element) => {
        const value = normalize($(element).text());
        if (value && value.length <= 200) siblingCandidates.push(value);
      });

    const siblingLocation = siblingCandidates.find(
      (line) => !looksLikeWandlitzMetadata(line, title)
    );
    if (siblingLocation) return siblingLocation;
  }

  const laterLinks = card
    .find("a[href]")
    .toArray()
    .filter((element) => element !== link)
    .map((element) => ({
      text: normalize($(element).text()),
      href: $(element).attr("href") || ""
    }))
    .filter(
      (candidate) =>
        candidate.text &&
        candidate.text.length <= 180 &&
        !isWandlitzEventHref(candidate.href) &&
        !looksLikeWandlitzMetadata(candidate.text, title)
    );

  if (laterLinks.length) return laterLinks[0].text;

  return (
    leafTextLines($, card).find(
      (line) =>
        !looksLikeWandlitzMetadata(line, title) &&
        !/^(ausflüge|ausstellungen|familie|kino|sport|sonstiges)$/i.test(line)
    ) || null
  );
}

function extractWandlitzImage($, card) {
  const images = card.find("img[src], img[data-src]").toArray();

  for (const image of images) {
    const src = $(image).attr("src") || $(image).attr("data-src");
    const url = absoluteUrl(src, WANDLITZ_URL);
    if (!url) continue;
    if (/layout\.verwaltungsportal\.de\/global\//i.test(url)) continue;
    return url;
  }

  return null;
}


function decodeHtml(value = "") {
  return cheerio.load(`<span>${value}</span>`)("span").text();
}

function cleanMarkdownText(value = "") {
  return normalize(
    decodeHtml(value)
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
  );
}

function looksLikeReaderMetadata(line, title) {
  const value = cleanMarkdownText(line);
  if (!value) return true;
  const lower = value.toLocaleLowerCase("de-DE");

  return (
    value === title ||
    /^(title|url source|published time|markdown content):/i.test(value) ||
    /^(navigation|start|veranstaltungen|listenansicht|kalender ansicht)$/i.test(value) ||
    /veranstaltung kostenlos melden/i.test(value) ||
    /^(sa|so|mo|di|mi|do|fr)[,.]?\s*\d{1,2}\./i.test(value) ||
    /\d{1,2}:\d{2}/.test(value) ||
    /^image\s*:/i.test(value) ||
    lower.length < 3
  );
}

function readerLocation(lines, eventIndex, title) {
  for (const rawLine of lines.slice(eventIndex + 1, eventIndex + 8)) {
    const value = cleanMarkdownText(rawLine);
    if (!value || looksLikeReaderMetadata(value, title)) continue;
    if (/^#{1,6}\s/.test(rawLine)) break;
    if (/^https?:\/\//i.test(value)) continue;
    if (value.length > 220) continue;
    return value;
  }
  return null;
}

function parseWandlitzReaderEvents(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const results = [];
  const seen = new Set();
  const eventLinkRe = /(?<!!)\[([^\]]+)\]\((https?:\/\/(?:www\.)?wandlitz\.de\/veranstaltungen\/\d+\/(\d{4})\/(\d{2})\/(\d{2})\/[^)\s]+?\.html(?:\?[^)]*)?)\)/i;

  lines.forEach((line, index) => {
    const match = line.match(eventLinkRe);
    if (!match) return;

    const title = cleanMarkdownText(match[1]);
    const url = match[2];
    if (!title || title.length < 2 || seen.has(url)) return;
    seen.add(url);

    const startDate = isoDate(Number(match[3]), Number(match[4]), Number(match[5]));
    const before = lines.slice(Math.max(0, index - 10), index);
    const dateContext = before.map(cleanMarkdownText).join(" ");
    const timeLine = [...before]
      .reverse()
      .map(cleanMarkdownText)
      .find((value) => /\d{1,2}:\d{2}/.test(value));
    const { startTime, endTime } = parseTimes(timeLine || "");

    results.push({
      id: `wandlitz:${url.match(/\/veranstaltungen\/(\d+)\//)?.[1] || url}`,
      title,
      startDate,
      endDate: parseLastGermanDate(dateContext, startDate),
      startTime,
      endTime,
      location: readerLocation(lines, index, title),
      url,
      image: null,
      source: "Gemeinde Wandlitz",
      sourceKey: "wandlitz"
    });
  });

  return sortAndFilter(results);
}

function parseWandlitzEvents(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href]").each((_, link) => {
    const href = $(link).attr("href");
    if (!isWandlitzEventHref(href)) return;

    const url = absoluteUrl(href, WANDLITZ_URL);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const title = normalize($(link).text());
    if (!title || title.length < 2) return;

    const card = chooseWandlitzCard($, link);
    const cardText = normalize(card.text());
    const startDate = dateFromWandlitzUrl(url);
    if (!startDate) return;

    const endDate = parseLastGermanDate(cardText, startDate);
    const { startTime, endTime } = parseTimes(cardText);

    results.push({
      id: `wandlitz:${url.match(/\/veranstaltungen\/(\d+)\//)?.[1] || url}`,
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      location: extractWandlitzLocation($, link, card, title),
      url,
      image: extractWandlitzImage($, card),
      source: "Gemeinde Wandlitz",
      sourceKey: "wandlitz"
    });
  });

  return sortAndFilter(results);
}

function isBernauEventHref(href) {
  if (!href) return false;
  try {
    const url = new URL(href, BERNAU_URL);
    return (
      /(^|\.)best-bernau\.de$/i.test(url.hostname) &&
      BERNAU_EVENT_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function chooseBernauCard($, link) {
  let node = $(link);
  let best = node.parent();

  for (let depth = 0; depth < 9; depth += 1) {
    node = node.parent();
    if (!node.length) break;

    const text = normalize(node.text());
    const eventLinkCount = node
      .find("a[href]")
      .filter((_, anchor) => isBernauEventHref($(anchor).attr("href"))).length;

    if (
      eventLinkCount === 1 &&
      /\d{1,2}:\d{2}/.test(text) &&
      text.length >= 12 &&
      text.length <= 1200
    ) {
      best = node;
      if (node.is("article, li") || /event|termin|veranstaltung/i.test(node.attr("class") || "")) {
        break;
      }
    }
  }

  return best;
}

function cleanBernauLocation(value, title) {
  let location = normalize(value)
    .replace(/^[•·|–—:\s]+/, "")
    .replace(/\s+(?:mehr(?: erfahren)?|details?)\s*$/i, "")
    .trim();

  if (!location || location === title) return null;

  const categoryPrefix = [...BERNAU_CATEGORIES]
    .sort((a, b) => b.length - a.length)
    .find((category) =>
      location.toLocaleLowerCase("de-DE").startsWith(`${category} `)
    );

  if (categoryPrefix) {
    location = normalize(location.slice(categoryPrefix.length));
  }

  if (!location || BERNAU_CATEGORIES.has(location.toLocaleLowerCase("de-DE"))) {
    return null;
  }

  return location.slice(0, 220);
}

function extractBernauLocation($, card, title, timeMatch) {
  const cardText = normalize(card.text());

  if (timeMatch) {
    const endIndex = (timeMatch.index || 0) + timeMatch[0].length;
    const afterTime = cleanBernauLocation(cardText.slice(endIndex), title);
    if (afterTime) return afterTime;
  }

  const lines = leafTextLines($, card);
  const timeIndex = lines.findIndex((line) => /\d{1,2}:\d{2}/.test(line));

  if (timeIndex >= 0) {
    const inlineMatch = lines[timeIndex].match(
      /\d{1,2}:\d{2}(?:\s*(?:–|—|-)\s*\d{1,2}:\d{2})?\s*(?:Uhr)?\s*[•·|]\s*(.+)$/i
    );
    if (inlineMatch) {
      const inlineLocation = cleanBernauLocation(inlineMatch[1], title);
      if (inlineLocation) return inlineLocation;
    }

    for (const line of lines.slice(timeIndex + 1, timeIndex + 5)) {
      const candidate = cleanBernauLocation(line, title);
      if (
        candidate &&
        !/\d{1,2}:\d{2}/.test(candidate) &&
        !parseGermanHeadingDate(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function elementOwnText($, element) {
  return normalize($(element).clone().children().remove().end().text());
}

function parseBernauEvents(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  let currentDate = null;

  $("body *").each((_, element) => {
    const node = $(element);
    const ownText = elementOwnText($, element);
    const fullText = normalize(node.text());
    const headingDate =
      parseGermanHeadingDate(ownText) ||
      (fullText.length <= 60 ? parseGermanHeadingDate(fullText) : null);

    if (headingDate) {
      currentDate = headingDate;
      return;
    }

    if (!node.is("a[href]") || !currentDate) return;

    const href = node.attr("href");
    if (!isBernauEventHref(href)) return;

    const url = absoluteUrl(href, BERNAU_URL);
    const title = normalize(node.text());
    if (!url || !title || title.length < 2) return;

    const card = chooseBernauCard($, element);
    const cardText = normalize(card.text());
    const { startTime, endTime, match } = parseTimes(cardText);
    if (!startTime) return;

    const location = extractBernauLocation($, card, title, match);
    const dedupeKey = [currentDate, startTime, title, location || "", url].join("|");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    results.push({
      id: `bernau:${dedupeKey}`,
      title,
      startDate: currentDate,
      endDate: currentDate,
      startTime,
      endTime,
      location,
      url,
      image: null,
      source: "Tourist-Information Bernau",
      sourceKey: "bernau"
    });
  });

  return sortAndFilter(results);
}

async function fetchHtml(url, userAgent = BROWSER_USER_AGENT) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: new URL(url).origin + "/"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  }

  const html = await response.text();
  if (html.length < 1000) {
    throw new Error(`${new URL(url).hostname} returned an unexpectedly short page`);
  }

  return html;
}


async function fetchPlainText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "text/plain,text/markdown;q=0.9,*/*;q=0.5",
      "X-Return-Format": "markdown"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  }

  const text = await response.text();
  if (text.length < 1000) {
    throw new Error(`${new URL(url).hostname} returned an unexpectedly short page`);
  }

  return text;
}

async function fetchWandlitzEvents(source) {
  const failures = [];

  for (const url of source.urls) {
    for (const userAgent of source.userAgents) {
      try {
        const html = await fetchHtml(url, userAgent);
        const events = parseWandlitzEvents(html);
        if (events.length) {
          return {
            source,
            events,
            fetchedUrl: url,
            strategy: "direct-html"
          };
        }
        failures.push(`${url}: HTML geladen, aber keine Termine erkannt`);
      } catch (error) {
        failures.push(`${url}: ${String(error?.message || error)}`);
      }
    }
  }

  try {
    const markdown = await fetchPlainText(WANDLITZ_READER_URL);
    const events = parseWandlitzReaderEvents(markdown);
    if (events.length) {
      return {
        source,
        events,
        fetchedUrl: WANDLITZ_READER_URL,
        strategy: "reader-fallback"
      };
    }
    failures.push(`${WANDLITZ_READER_URL}: Reader geladen, aber keine Termine erkannt`);
  } catch (error) {
    failures.push(
      `${WANDLITZ_READER_URL}: ${String(error?.message || error)}`
    );
  }

  throw new Error(failures.join(" | "));
}

async function fetchAndParseSource(source) {
  const failures = [];
  const urls = source.urls || [source.url];
  const userAgents = source.userAgents || [BROWSER_USER_AGENT];

  for (const url of urls) {
    for (const userAgent of userAgents) {
      try {
        const html = await fetchHtml(url, userAgent);
        const events = source.parser(html);

        if (events.length) {
          return { source, events, fetchedUrl: url };
        }

        failures.push(`${url}: Seite geladen, aber keine Termine erkannt`);
      } catch (error) {
        failures.push(`${url}: ${String(error?.message || error)}`);
      }
    }
  }

  throw new Error(failures.join(" | "));
}

function dedupeMergedEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = [
      event.sourceKey,
      event.startDate,
      event.startTime || "",
      normalize(event.title).toLocaleLowerCase("de-DE"),
      normalize(event.location || "").toLocaleLowerCase("de-DE")
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectEventsFairly(events, limit, sourceKeys) {
  const sorted = sortAndFilter(events);
  if (sorted.length <= limit) return sorted;

  const activeSourceKeys = sourceKeys.filter((sourceKey) =>
    sorted.some((event) => event.sourceKey === sourceKey)
  );

  if (activeSourceKeys.length <= 1) return sorted.slice(0, limit);

  const minimumPerSource = Math.floor(limit / activeSourceKeys.length);
  const selected = [];
  const selectedIds = new Set();

  for (const sourceKey of activeSourceKeys) {
    const sourceEvents = sorted
      .filter((event) => event.sourceKey === sourceKey)
      .slice(0, minimumPerSource);

    for (const event of sourceEvents) {
      selected.push(event);
      selectedIds.add(event.id);
    }
  }

  for (const event of sorted) {
    if (selected.length >= limit) break;
    if (selectedIds.has(event.id)) continue;
    selected.push(event);
    selectedIds.add(event.id);
  }

  return selected.sort((a, b) =>
    eventSortKey(a).localeCompare(eventSortKey(b), "de")
  );
}

export { parseWandlitzEvents, parseWandlitzReaderEvents, parseBernauEvents };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const sourceJobs = [
    {
      key: "wandlitz",
      label: "Gemeinde Wandlitz",
      url: WANDLITZ_URL,
      urls: WANDLITZ_URLS,
      userAgents: [
        BROWSER_USER_AGENT,
        "WandlitzEventsWidget/1.0 (+public event list; cached server-side)"
      ],
      parser: parseWandlitzEvents,
      loader: fetchWandlitzEvents
    },
    {
      key: "bernau",
      label: "Tourist-Information Bernau",
      url: BERNAU_URL,
      urls: [BERNAU_URL],
      parser: parseBernauEvents
    }
  ];

  const settled = await Promise.allSettled(
    sourceJobs.map((source) =>
      source.loader ? source.loader(source) : fetchAndParseSource(source)
    )
  );

  const events = [];
  const sources = [];
  const warnings = [];

  settled.forEach((result, index) => {
    const source = sourceJobs[index];
    if (result.status === "fulfilled" && result.value.events.length) {
      events.push(...result.value.events);
      sources.push({
        key: source.key,
        label: source.label,
        url: source.url,
        fetchedUrl: result.value.fetchedUrl,
        strategy: result.value.strategy || "direct-html",
        count: result.value.events.length,
        ok: true
      });
      return;
    }

    const reason =
      result.status === "rejected"
        ? String(result.reason?.message || result.reason)
        : "No events found. The source page structure may have changed.";

    warnings.push(`${source.label}: ${reason}`);
    sources.push({
      key: source.key,
      label: source.label,
      url: source.url,
      count: 0,
      ok: false
    });
  });

  const deduped = dedupeMergedEvents(events);
  const merged = selectEventsFairly(
    deduped,
    limit,
    sourceJobs.map((source) => source.key)
  );

  const returnedCounts = Object.fromEntries(
    sourceJobs.map((source) => [
      source.key,
      merged.filter((event) => event.sourceKey === source.key).length
    ])
  );

  sources.forEach((source) => {
    source.returnedCount = returnedCounts[source.key] || 0;
  });

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!merged.length) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      error: "Die Veranstaltungsdaten konnten nicht geladen werden.",
      warnings,
      sources
    });
  }

  res.setHeader(
    "Cache-Control",
    warnings.length
      ? "public, s-maxage=120, stale-while-revalidate=300"
      : "public, s-maxage=21600, stale-while-revalidate=86400"
  );

  return res.status(200).json({
    version: "7.0.0",
    fetchedAt: new Date().toISOString(),
    count: merged.length,
    sources,
    warnings,
    events: merged
  });
}
