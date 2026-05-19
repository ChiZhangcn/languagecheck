"use strict";

const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SOURCE_URLS = {
  adobeGb1:
    "https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-GB1-6/cid2code.txt",
  adobeCns1:
    "https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-CNS1-7/cid2code.txt",
  adobeJapan1:
    "https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-Japan1-7/cid2code.txt",
  adobeKorea1:
    "https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-Korea1-2/cid2code.txt",
  adobeKr:
    "https://raw.githubusercontent.com/adobe-type-tools/cmap-resources/master/Adobe-KR-9/cid2code.txt",
  unicodeData14: "https://www.unicode.org/Public/14.0.0/ucd/UnicodeData.txt",
  unicodeTn60: "https://www.unicode.org/notes/tn60/tn60-1.xlsx",
};

const CJK_LEVEL_3_RANGES = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0x2ceb0, 0x2ebef],
  [0x2f00, 0x2fdf],
];

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function readTextFromPathOrUrl(filePath, url) {
  if (filePath) {
    return fs.readFileSync(filePath, "utf8");
  }

  return (await fetchBuffer(url)).toString("utf8");
}

async function readBufferFromPathOrUrl(filePath, url) {
  if (filePath) {
    return fs.readFileSync(filePath);
  }

  return fetchBuffer(url);
}

function codePointsToRanges(codePoints) {
  const sorted = Array.from(new Set(codePoints)).sort((left, right) => left - right);
  const ranges = [];

  for (const codePoint of sorted) {
    const lastRange = ranges[ranges.length - 1];

    if (lastRange && lastRange[1] + 1 === codePoint) {
      lastRange[1] = codePoint;
    } else {
      ranges.push([codePoint, codePoint]);
    }
  }

  return ranges;
}

function parseUnicodeCodePoints(value) {
  if (!value || value === "*") {
    return [];
  }

  return value
    .split(",")
    .map((item) => Number.parseInt(item.replace(/v$/i, ""), 16))
    .filter(Number.isFinite);
}

function getHeaderIndex(header) {
  return Object.fromEntries(header.map((name, index) => [name, index]));
}

function parseAdobeCid2Code(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  const header = lines.shift().split("\t");
  const headerIndex = getHeaderIndex(header);

  return lines.map((line) => {
    const columns = line.split("\t");

    return {
      cid: Number(columns[headerIndex.CID]),
      columns,
      headerIndex,
    };
  });
}

function getColumnValue(row, columnName) {
  const index = row.headerIndex[columnName];

  return index === undefined ? null : row.columns[index];
}

function hasEncodedValue(row, columnName) {
  const value = getColumnValue(row, columnName);

  return Boolean(value && value !== "*");
}

function getUnicodeCodePoints(row, unicodeColumnNames) {
  return unicodeColumnNames.flatMap((columnName) => parseUnicodeCodePoints(getColumnValue(row, columnName)));
}

function adobeEncodedProfile(rows, encodedColumnNames, unicodeColumnNames, predicate = () => true) {
  const codePoints = [];

  for (const row of rows) {
    if (!predicate(row) || !encodedColumnNames.some((columnName) => hasEncodedValue(row, columnName))) {
      continue;
    }

    codePoints.push(...getUnicodeCodePoints(row, unicodeColumnNames));
  }

  return codePointsToRanges(codePoints);
}

function adobeUnicodeProfile(rows, unicodeColumnNames, predicate = () => true) {
  const codePoints = [];

  for (const row of rows) {
    if (predicate(row)) {
      codePoints.push(...getUnicodeCodePoints(row, unicodeColumnNames));
    }
  }

  return codePointsToRanges(codePoints);
}

function parseUnicodeDataAssignedCodePoints(text, ranges) {
  const codePoints = [];
  let rangeStart = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [hex, name] = line.split(";");
    const codePoint = Number.parseInt(hex, 16);

    if (name.endsWith(", First>")) {
      rangeStart = codePoint;
      continue;
    }

    if (name.endsWith(", Last>") && rangeStart !== null) {
      for (let current = rangeStart; current <= codePoint; current += 1) {
        if (isCodePointInRanges(current, ranges)) {
          codePoints.push(current);
        }
      }
      rangeStart = null;
      continue;
    }

    if (isCodePointInRanges(codePoint, ranges)) {
      codePoints.push(codePoint);
    }
  }

  return codePoints;
}

function parseTn60KsX1002HangulCodePoints(xlsxBuffer) {
  const tempPath = path.join(os.tmpdir(), `tn60-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  fs.writeFileSync(tempPath, xlsxBuffer);

  try {
    const sharedStringsXml = execFileSync("unzip", ["-p", tempPath, "xl/sharedStrings.xml"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const sheetXml = execFileSync("unzip", ["-p", tempPath, "xl/worksheets/sheet1.xml"], {
      encoding: "utf8",
      maxBuffer: 80 * 1024 * 1024,
    });
    const sharedStrings = Array.from(sharedStringsXml.matchAll(/<si>(.*?)<\/si>/gs)).map((match) =>
      match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
    );
    const codePoints = [];

    for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)) {
      const cells = {};

      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>(.*?)<\/c>|<c\b([^>]*)\/>/gs)) {
        const attrs = cellMatch[1] || cellMatch[3] || "";
        const body = cellMatch[2] || "";
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
        const value = body.match(/<v>(.*?)<\/v>/s)?.[1];

        if (!ref || value === undefined) {
          continue;
        }

        cells[ref] = attrs.includes('t="s"') ? sharedStrings[Number(value)] : value;
      }

      if (/^U\+[0-9A-F]{4,6}$/i.test(cells.A || "") && cells.F && cells.F.trim()) {
        codePoints.push(Number.parseInt(cells.A.slice(2), 16));
      }
    }

    return codePoints;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function isCodePointInRanges(codePoint, ranges) {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function rangeCount(ranges) {
  return ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
}

function createProfile({
  key,
  name,
  standard,
  category,
  languageName,
  languageCode,
  description,
  source,
  sourceUrl,
  codePointRanges,
}) {
  return {
    key,
    name,
    standard,
    category,
    languageName,
    languageCode,
    description,
    source,
    sourceUrl,
    totalCharacterCount: rangeCount(codePointRanges),
    rangeCount: codePointRanges.length,
    codePointRanges,
  };
}

function simplifiedChineseProfiles(gbRows, level3CodePoints) {
  const languageName = "Simplified Chinese";
  const languageCode = "zh-Hans";

  return [
    createProfile({
      key: "gb2312",
      name: "GB2312",
      standard: "GB/T 2312-1980",
      category: "national_standard",
      languageName,
      languageCode,
      description: "GB/T 2312 Simplified Chinese repertoire, checked through Adobe GB-H to Unicode mapping.",
      source: "Adobe CMap Resources Adobe-GB1-6 cid2code.txt, GB column",
      sourceUrl: SOURCE_URLS.adobeGb1,
      codePointRanges: adobeEncodedProfile(gbRows, ["GB"], ["UniGB-UTF32"]),
    }),
    createProfile({
      key: "gbk",
      name: "GBK",
      standard: "GBK / GB 13000.1-93",
      category: "national_standard",
      languageName,
      languageCode,
      description: "GBK Simplified Chinese repertoire, checked through Adobe GBK-EUC to Unicode mapping.",
      source: "Adobe CMap Resources Adobe-GB1-6 cid2code.txt, GBK-EUC column",
      sourceUrl: SOURCE_URLS.adobeGb1,
      codePointRanges: adobeEncodedProfile(gbRows, ["GBK-EUC"], ["UniGB-UTF32"]),
    }),
    createProfile({
      key: "gb18030-2022-level-1",
      name: "GB18030-2022 Level 1",
      standard: "GB 18030-2022 Implementation Level 1",
      category: "national_standard",
      languageName,
      languageCode,
      description:
        "Baseline GB18030 repertoire before Adobe-GB1 Supplement 6 additions; useful as a practical Level 1 coverage proxy.",
      source: "Adobe CMap Resources Adobe-GB1-6 cid2code.txt, GBK2K column, CIDs before Supplement 6",
      sourceUrl: SOURCE_URLS.adobeGb1,
      codePointRanges: adobeEncodedProfile(gbRows, ["GBK2K"], ["UniGB-UTF32"], (row) => row.cid < 30284),
    }),
    createProfile({
      key: "gb18030-2022-level-2",
      name: "GB18030-2022 Level 2",
      standard: "GB 18030-2022 Implementation Level 2",
      category: "national_standard",
      languageName,
      languageCode,
      description:
        "GB18030-2022 Level 2 repertoire represented by Adobe-GB1-6 GBK2K mappings, including Supplement 6 additions.",
      source: "Adobe CMap Resources Adobe-GB1-6 cid2code.txt, GBK2K column",
      sourceUrl: SOURCE_URLS.adobeGb1,
      codePointRanges: adobeEncodedProfile(gbRows, ["GBK2K"], ["UniGB-UTF32"]),
    }),
    createProfile({
      key: "gb18030-2022-level-3",
      name: "GB18030-2022 Level 3",
      standard: "GB 18030-2022 Implementation Level 3",
      category: "national_standard",
      languageName,
      languageCode,
      description:
        "Assigned Unicode 14.0 CJK Unified Ideographs through Extension F plus Kangxi Radicals, matching the public Level 3 scope at code point level.",
      source: "Unicode 14.0 UnicodeData.txt assigned code points in CJK ranges through Extension F plus Kangxi Radicals",
      sourceUrl: SOURCE_URLS.unicodeData14,
      codePointRanges: codePointsToRanges(level3CodePoints),
    }),
    createProfile({
      key: "adobe-gb1-6",
      name: "Adobe-GB1-6",
      standard: "Adobe-GB1-6 Character Collection",
      category: "adobe_collection",
      languageName,
      languageCode,
      description:
        "Unicode-mapped representative repertoire for Adobe-GB1-6. CID glyph variants that do not have distinct Unicode code points cannot be proven from a normal Unicode cmap alone.",
      source: "Adobe CMap Resources Adobe-GB1-6 cid2code.txt, UniGB-UTF32 column",
      sourceUrl: SOURCE_URLS.adobeGb1,
      codePointRanges: adobeUnicodeProfile(gbRows, ["UniGB-UTF32"]),
    }),
  ];
}

function traditionalChineseProfiles(cnsRows) {
  const languageName = "Traditional Chinese";
  const languageCode = "zh-Hant";

  return [
    createProfile({
      key: "big5",
      name: "Big5",
      standard: "Big5",
      category: "national_standard",
      languageName,
      languageCode,
      description: "Big5 Traditional Chinese repertoire, checked through Adobe B5 to Unicode mapping.",
      source: "Adobe CMap Resources Adobe-CNS1-7 cid2code.txt, B5 column",
      sourceUrl: SOURCE_URLS.adobeCns1,
      codePointRanges: adobeEncodedProfile(cnsRows, ["B5"], ["UniCNS-UTF32"]),
    }),
    createProfile({
      key: "hkscs-2016",
      name: "HKSCS-2016",
      standard: "Hong Kong Supplementary Character Set",
      category: "regional_extension",
      languageName,
      languageCode,
      description:
        "HKSCS coverage proxy using Adobe-CNS1-7 HKscs-B5 mappings. The Adobe source is Unicode 10-era and should be refreshed if a newer HKSCS mapping table is added.",
      source: "Adobe CMap Resources Adobe-CNS1-7 cid2code.txt, HKscs-B5 column",
      sourceUrl: SOURCE_URLS.adobeCns1,
      codePointRanges: adobeEncodedProfile(cnsRows, ["HKscs-B5"], ["UniCNS-UTF32"]),
    }),
    createProfile({
      key: "cns-11643",
      name: "CNS 11643",
      standard: "CNS 11643",
      category: "national_standard",
      languageName,
      languageCode,
      description:
        "CNS 11643 coverage proxy from Adobe CNS1/CNS2/CNS-EUC mappings, primarily planes 1 and 2 in this source.",
      source: "Adobe CMap Resources Adobe-CNS1-7 cid2code.txt, CNS1/CNS2/CNS-EUC columns",
      sourceUrl: SOURCE_URLS.adobeCns1,
      codePointRanges: adobeEncodedProfile(cnsRows, ["CNS1", "CNS2", "CNS-EUC"], ["UniCNS-UTF32"]),
    }),
    createProfile({
      key: "adobe-cns1-7",
      name: "Adobe-CNS1-7",
      standard: "Adobe-CNS1-7 Character Collection",
      category: "adobe_collection",
      languageName,
      languageCode,
      description:
        "Unicode-mapped representative repertoire for Adobe-CNS1-7. CID glyph variants cannot be fully proven from a normal Unicode cmap alone.",
      source: "Adobe CMap Resources Adobe-CNS1-7 cid2code.txt, UniCNS-UTF32 column",
      sourceUrl: SOURCE_URLS.adobeCns1,
      codePointRanges: adobeUnicodeProfile(cnsRows, ["UniCNS-UTF32"]),
    }),
  ];
}

function japaneseProfiles(japanRows) {
  const languageName = "Japanese";
  const languageCode = "ja";

  return [
    createProfile({
      key: "jis-x-0208",
      name: "JIS X 0208",
      standard: "JIS X 0208:1997",
      category: "national_standard",
      languageName,
      languageCode,
      description: "JIS X 0208 repertoire, checked through Adobe-Japan1 H CMap to Unicode mapping.",
      source: "Adobe CMap Resources Adobe-Japan1-7 cid2code.txt, H column",
      sourceUrl: SOURCE_URLS.adobeJapan1,
      codePointRanges: adobeEncodedProfile(japanRows, ["H"], ["UniJIS-UTF32"]),
    }),
    createProfile({
      key: "jis-x-0213-2004",
      name: "JIS X 0213:2004",
      standard: "JIS X 0213:2004",
      category: "national_standard",
      languageName,
      languageCode,
      description: "JIS X 0213:2004 repertoire, checked through Adobe UniJISX02132004 UTF-32 mapping.",
      source: "Adobe CMap Resources Adobe-Japan1-7 cid2code.txt, UniJISX02132004-UTF32 column",
      sourceUrl: SOURCE_URLS.adobeJapan1,
      codePointRanges: adobeUnicodeProfile(japanRows, ["UniJISX02132004-UTF32"]),
    }),
    createProfile({
      key: "adobe-japan1-7",
      name: "Adobe-Japan1-7",
      standard: "Adobe-Japan1-7 Character Collection",
      category: "adobe_collection",
      languageName,
      languageCode,
      description:
        "Unicode-mapped representative repertoire for Adobe-Japan1-7. CID glyph variants cannot be fully proven from a normal Unicode cmap alone.",
      source: "Adobe CMap Resources Adobe-Japan1-7 cid2code.txt, Unicode UTF-32 columns",
      sourceUrl: SOURCE_URLS.adobeJapan1,
      codePointRanges: adobeUnicodeProfile(japanRows, [
        "UniJIS-UTF32",
        "UniJIS2004-UTF32",
        "UniJISX0213-UTF32",
        "UniJISX02132004-UTF32",
      ]),
    }),
  ];
}

function koreanProfiles(koreaRows, krRows, tn60KsX1002CodePoints) {
  const languageName = "Korean";
  const languageCode = "ko";

  return [
    createProfile({
      key: "ks-x-1001",
      name: "KS X 1001",
      standard: "KS X 1001",
      category: "national_standard",
      languageName,
      languageCode,
      description: "KS X 1001 repertoire, checked through Adobe-Korea1 KSC to Unicode mapping.",
      source: "Adobe CMap Resources Adobe-Korea1-2 cid2code.txt, KSC column",
      sourceUrl: SOURCE_URLS.adobeKorea1,
      codePointRanges: adobeEncodedProfile(koreaRows, ["KSC"], ["UniKS-UTF32"]),
    }),
    createProfile({
      key: "ks-x-1002",
      name: "KS X 1002",
      standard: "KS X 1002",
      category: "national_standard",
      languageName,
      languageCode,
      description:
        "Unicode-mapped Hangul syllable subset from Unicode TN #60. KS X 1002 has no widely implemented legacy encoding, so this profile intentionally avoids unreliable unofficial full-table mappings.",
      source: "Unicode Technical Note #60 tn60-1.xlsx, KS X 1002 column",
      sourceUrl: SOURCE_URLS.unicodeTn60,
      codePointRanges: codePointsToRanges(tn60KsX1002CodePoints),
    }),
    createProfile({
      key: "adobe-kr-9",
      name: "Adobe-KR-9",
      standard: "Adobe-KR-9 Character Collection",
      category: "adobe_collection",
      languageName,
      languageCode,
      description:
        "Unicode-mapped representative repertoire for Adobe-KR-9. CID glyph variants cannot be fully proven from a normal Unicode cmap alone.",
      source: "Adobe CMap Resources Adobe-KR-9 cid2code.txt, UniAKR-UTF32 column",
      sourceUrl: SOURCE_URLS.adobeKr,
      codePointRanges: adobeUnicodeProfile(krRows, ["UniAKR-UTF32"]),
    }),
  ];
}

async function main() {
  const [
    gbText,
    cnsText,
    japanText,
    koreaText,
    krText,
    unicodeDataText,
    tn60Buffer,
  ] = await Promise.all([
    readTextFromPathOrUrl(process.env.ADOBE_GB1_CID2CODE_PATH, SOURCE_URLS.adobeGb1),
    readTextFromPathOrUrl(process.env.ADOBE_CNS1_CID2CODE_PATH, SOURCE_URLS.adobeCns1),
    readTextFromPathOrUrl(process.env.ADOBE_JAPAN1_CID2CODE_PATH, SOURCE_URLS.adobeJapan1),
    readTextFromPathOrUrl(process.env.ADOBE_KOREA1_CID2CODE_PATH, SOURCE_URLS.adobeKorea1),
    readTextFromPathOrUrl(process.env.ADOBE_KR_CID2CODE_PATH, SOURCE_URLS.adobeKr),
    readTextFromPathOrUrl(process.env.UNICODE_DATA_PATH, SOURCE_URLS.unicodeData14),
    readBufferFromPathOrUrl(process.env.UNICODE_TN60_XLSX_PATH, SOURCE_URLS.unicodeTn60),
  ]);

  const gbRows = parseAdobeCid2Code(gbText);
  const cnsRows = parseAdobeCid2Code(cnsText);
  const japanRows = parseAdobeCid2Code(japanText);
  const koreaRows = parseAdobeCid2Code(koreaText);
  const krRows = parseAdobeCid2Code(krText);
  const level3CodePoints = parseUnicodeDataAssignedCodePoints(unicodeDataText, CJK_LEVEL_3_RANGES);
  const tn60KsX1002CodePoints = parseTn60KsX1002HangulCodePoints(tn60Buffer);
  const profiles = [
    ...simplifiedChineseProfiles(gbRows, level3CodePoints),
    ...traditionalChineseProfiles(cnsRows),
    ...japaneseProfiles(japanRows),
    ...koreanProfiles(koreaRows, krRows, tn60KsX1002CodePoints),
  ];

  const outputPath = path.resolve(__dirname, "../src/cjk-standard-data.js");
  const generatedAt = new Date().toISOString();
  const output = `"use strict";

// Generated by scripts/generate-cjk-standard-data.js on ${generatedAt}.
// Re-run the script after Adobe CMap Resources or Unicode inputs change.

module.exports = ${JSON.stringify(
    {
      summary: {
        generatedAt,
        profileCount: profiles.length,
        sourceUrls: Object.values(SOURCE_URLS),
      },
      profiles,
    },
    null,
    2
  )};
`;

  fs.writeFileSync(outputPath, output);

  console.log(
    JSON.stringify(
      {
        outputPath,
        profiles: profiles.map((profile) => ({
          language: profile.languageName,
          key: profile.key,
          totalCharacterCount: profile.totalCharacterCount,
          rangeCount: profile.rangeCount,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
