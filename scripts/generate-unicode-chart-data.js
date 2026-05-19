"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BLOCKS_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Blocks.txt";
const CHARTS_URL = "https://www.unicode.org/charts/?level=1";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "unicode-chart-data.js");

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)));
}

function stripTags(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRange(title) {
  if (!title) {
    return null;
  }

  const normalizedTitle = decodeHtmlEntities(title).trim();
  const pairMatch = normalizedTitle.match(/([0-9A-F]+)\s*[–-]\s*([0-9A-F]+)/i);

  if (pairMatch) {
    return {
      start: parseInt(pairMatch[1], 16),
      end: parseInt(pairMatch[2], 16),
    };
  }

  const singleMatch = normalizedTitle.match(/\b([0-9A-F]{4,6})\b/i);

  if (!singleMatch) {
    return null;
  }

  const codePoint = parseInt(singleMatch[1], 16);

  return {
    start: codePoint,
    end: codePoint,
  };
}

function parseBlocks(blocksText) {
  return blocksText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([0-9A-F]+)\.\.([0-9A-F]+);\s*(.+)$/i);

      if (!match) {
        return null;
      }

      return {
        start: parseInt(match[1], 16),
        end: parseInt(match[2], 16),
        blockName: match[3].trim(),
      };
    })
    .filter(Boolean);
}

function parseLinks(html) {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map((match) => {
    const attributes = match[1];
    const titleMatch = attributes.match(/title="([^"]*)"/i);
    const hrefMatch = attributes.match(/href="([^"]*)"/i);

    return {
      href: hrefMatch ? hrefMatch[1] : null,
      title: titleMatch ? titleMatch[1] : "",
      text: stripTags(match[2]),
    };
  });
}

function extractSection(html, startAnchor, endAnchor) {
  const startIndex = html.indexOf(startAnchor);

  if (startIndex === -1) {
    throw new Error(`Could not find section start: ${startAnchor}`);
  }

  const endIndex = html.indexOf(endAnchor, startIndex);

  if (endIndex === -1) {
    throw new Error(`Could not find section end: ${endAnchor}`);
  }

  return html.slice(startIndex, endIndex);
}

function parseChartSection(sectionHtml, sectionKey, sectionName) {
  const paragraphMatches = Array.from(sectionHtml.matchAll(/<p class="(sg|mb|sb|pb)">([\s\S]*?)<\/p>/gi));
  const entries = [];
  let currentFamilyName = null;
  let currentScriptName = null;
  let order = 0;

  for (const match of paragraphMatches) {
    const rangeType = match[1];
    const innerHtml = match[2];
    const text = stripTags(innerHtml);

    if (rangeType === "sg") {
      currentFamilyName = text;
      currentScriptName = null;
      continue;
    }

    if (rangeType === "mb") {
      currentScriptName = text || null;
    }

    const shouldInclude = rangeType === "mb" || rangeType === "sb" || (rangeType === "pb" && sectionKey === "scripts");

    if (!shouldInclude) {
      continue;
    }

    const links = parseLinks(innerHtml).filter((link) => parseRange(link.title));

    if (rangeType === "mb" && links.length === 0) {
      continue;
    }

    if (rangeType === "pb" && links.length !== 1) {
      continue;
    }

    if (links.length !== 1) {
      continue;
    }

    const link = links[0];
    const range = parseRange(link.title);

    if (!range) {
      continue;
    }

    entries.push({
      sectionKey,
      sectionName,
      familyName: currentFamilyName,
      scriptName: rangeType === "mb" ? text : currentScriptName,
      chartLabel: link.text,
      rangeType,
      order,
      start: range.start,
      end: range.end,
    });

    order += 1;
  }

  return entries;
}

function findBlockForCodePoint(blocks, codePoint) {
  return blocks.find((block) => codePoint >= block.start && codePoint <= block.end) || null;
}

async function downloadText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const [blocksText, chartsHtml] = await Promise.all([downloadText(BLOCKS_URL), downloadText(CHARTS_URL)]);

  const unicodeVersionMatch = blocksText.match(/#\s*Blocks-([0-9.]+)\.txt/i);
  const blocks = parseBlocks(blocksText);
  const scriptsHtml = extractSection(chartsHtml, '<a id="scripts">', '<a id="symbols">');
  const symbolsHtml = extractSection(chartsHtml, '<a id="symbols">', '<a id="notes">');
  const chartEntries = [...parseChartSection(scriptsHtml, "scripts", "Scripts"), ...parseChartSection(symbolsHtml, "symbols", "Symbols & Punctuation")].map((entry) => {
    const block = findBlockForCodePoint(blocks, entry.start);

    if (!block) {
      throw new Error(`Could not find block for U+${entry.start.toString(16).toUpperCase()}`);
    }

    return {
      ...entry,
      blockName: block.blockName,
      blockStart: block.start,
      blockEnd: block.end,
    };
  });

  const payload = {
    unicodeVersion: unicodeVersionMatch ? unicodeVersionMatch[1] : null,
    blocksSourceUrl: BLOCKS_URL,
    chartsSourceUrl: CHARTS_URL,
    generatedAt: new Date().toISOString(),
    blocks,
    chartEntries,
  };

  const output = `"use strict";\n\nmodule.exports = ${JSON.stringify(payload, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(`Generated ${chartEntries.length} chart entries and ${blocks.length} blocks at ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
