import * as cheerio from "cheerio";

const SOURCE_URL =
  process.env.SOURCE_URL || "https://www.wandlitz.de/veranstaltungen/";
const SOURCE_ORIGIN = new URL(SOURCE_URL).origin;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 80;

const EVENT_PATH_RE =
  /\/veranstaltungen\/\d+\/(\d{4})\/(\d{2})\/(\d{2})\/[^?#]+\.html/i;

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

function normalize(value = "") {
  return value
    .replace(/\u200b|\u00ad/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, SOURCE_URL).href;
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

function dateFromEventUrl(url) {
  const match = new URL(url).pathname.match(EVENT_PATH_RE);
  if (!match) return null;
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseLastGermanDate(text, fallbackStartDate) {
  const matches = [
    ...normalize(text).matchAll(
      /(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\.?\s*(\d{4})/g
    )
  ];

  if (!matches.length) return fallbackStartDate;

  const last = matches[matches.length - 1];
  const monthKey = last[2]
    .toLocaleLowerCase("de-DE")
    .replace(/\./g, "")
    .replace("ä", "ä");

  const month = MONTHS[monthKey] || MONTHS[monthKey.slice(0, 3)];
  if (!month) return fallbackStartDate;

  return isoDate(Number(last[3]), month, Number(last[1]));
}

function parseTimes(text) {
  const match = normalize(text).match(
    /(\d{1,2}:\d{2})(?:\s*(?:–|—|-|bis)\s*(\d{1,2}:\d{2}))?\s*Uhr?/i
  );
  if (!match) return { startTime: null, endTime: null };

  return {
    startTime: match[1].padStart(5, "0"),
    endTime: match[2] ? match[2].padStart(5, "0") : null
  };
}

function isEventHref(href) {
  if (!href) return false;
  try {
    return EVENT_PATH_RE.test(new URL(href, SOURCE_URL).pathname);
  } catch {
    return false;
  }
}

function chooseCard($, link) {
  let node = $(link);
  let best = node.parent();

  for (let depth = 0; depth < 8; depth += 1) {
    node = node.parent();
    if (!node.length) break;

    const text = normalize(node.text());
    const eventLinkCount = node
      .find("a[href]")
      .filter((_, a) => isEventHref($(a).attr("href"))).length;

    if (
      eventLinkCount === 1 &&
      text.length >= 20 &&
      text.length <= 1600
    ) {
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

function elementLines($, container) {
  const lines = [];
  const seen = new Set();

  container
    .find("h1,h2,h3,h4,p,time,address,li,span,a")
    .each((_, element) => {
      const item = $(element);
      const value = normalize(item.clone().children().remove().end().text());
      if (!value || value.length > 240 || seen.has(value)) return;
      seen.add(value);
      lines.push(value);
    });

  return lines;
}

function looksLikeMetadata(line, title) {
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

function extractLocation($, link, card, title) {
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
      (line) => !looksLikeMetadata(line, title)
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
        !isEventHref(candidate.href) &&
        !looksLikeMetadata(candidate.text, title)
    );

  if (laterLinks.length) return laterLinks[0].text;

  return (
    elementLines($, card).find(
      (line) =>
        !looksLikeMetadata(line, title) &&
        !/^(ausflüge|ausstellungen|familie|kino|sport|sonstiges)$/i.test(line)
    ) || null
  );
}

function extractImage($, card) {
  const images = card.find("img[src], img[data-src]").toArray();

  for (const image of images) {
    const src = $(image).attr("src") || $(image).attr("data-src");
    const url = absoluteUrl(src);
    if (!url) continue;
    if (/layout\.verwaltungsportal\.de\/global\//i.test(url)) continue;
    return url;
  }

  return null;
}

function parseEvents(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href]").each((_, link) => {
    const href = $(link).attr("href");
    if (!isEventHref(href)) return;

    const url = absoluteUrl(href);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const title = normalize($(link).text());
    if (!title || title.length < 2) return;

    const card = chooseCard($, link);
    const cardText = normalize(card.text());
    const startDate = dateFromEventUrl(url);
    if (!startDate) return;

    const endDate = parseLastGermanDate(cardText, startDate);
    const { startTime, endTime } = parseTimes(cardText);
    const location = extractLocation($, link, card, title);

    results.push({
      id: url.match(/\/veranstaltungen\/(\d+)\//)?.[1] || url,
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      location,
      url,
      image: extractImage($, card),
      source: "Gemeinde Wandlitz"
    });
  });

  const today = berlinToday();

  return results
    .filter((event) => (event.endDate || event.startDate) >= today)
    .sort((a, b) => {
      const left = `${a.startDate}T${a.startTime || "00:00"}`;
      const right = `${b.startDate}T${b.startTime || "00:00"}`;
      return left.localeCompare(right);
    });
}

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

  try {
    const upstream = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent":
          "WandlitzEventsWidget/1.0 (+public event list; cached server-side)",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!upstream.ok) {
      throw new Error(`Upstream returned HTTP ${upstream.status}`);
    }

    const html = await upstream.text();
    const events = parseEvents(html).slice(0, limit);

    if (!events.length) {
      throw new Error(
        "No events found. The source page structure may have changed."
      );
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      source: SOURCE_URL,
      sourceOrigin: SOURCE_ORIGIN,
      fetchedAt: new Date().toISOString(),
      count: events.length,
      events
    });
  } catch (error) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");

    return res.status(502).json({
      error: "Die Veranstaltungsdaten konnten nicht geladen werden.",
      detail:
        process.env.NODE_ENV === "development"
          ? String(error?.message || error)
          : undefined,
      source: SOURCE_URL
    });
  }
}
