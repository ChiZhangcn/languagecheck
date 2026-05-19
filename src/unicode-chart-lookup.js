"use strict";

const unicodeChartData = require("./unicode-chart-data");

const SECTION_PRIORITY = {
  scripts: 0,
  symbols: 1,
};

const RANGE_TYPE_PRIORITY = {
  sb: 0,
  mb: 1,
  pb: 2,
};

function findUnicodeBlock(codePoint) {
  for (const block of unicodeChartData.blocks) {
    if (codePoint >= block.start && codePoint <= block.end) {
      return block;
    }
  }

  return null;
}

function compareChartEntries(left, right) {
  const sectionPriorityDelta =
    (SECTION_PRIORITY[left.sectionKey] ?? Number.MAX_SAFE_INTEGER) -
    (SECTION_PRIORITY[right.sectionKey] ?? Number.MAX_SAFE_INTEGER);

  if (sectionPriorityDelta !== 0) {
    return sectionPriorityDelta;
  }

  const leftSize = left.end - left.start;
  const rightSize = right.end - right.start;

  if (leftSize !== rightSize) {
    return leftSize - rightSize;
  }

  const rangeTypePriorityDelta =
    (RANGE_TYPE_PRIORITY[left.rangeType] ?? Number.MAX_SAFE_INTEGER) -
    (RANGE_TYPE_PRIORITY[right.rangeType] ?? Number.MAX_SAFE_INTEGER);

  if (rangeTypePriorityDelta !== 0) {
    return rangeTypePriorityDelta;
  }

  return left.order - right.order;
}

function findBestChartEntry(codePoint) {
  let bestEntry = null;

  for (const entry of unicodeChartData.chartEntries) {
    if (codePoint < entry.start || codePoint > entry.end) {
      continue;
    }

    if (!bestEntry || compareChartEntries(entry, bestEntry) < 0) {
      bestEntry = entry;
    }
  }

  return bestEntry;
}

function getUnicodeMetadata(codePoint) {
  const block = findUnicodeBlock(codePoint);
  const chartEntry = findBestChartEntry(codePoint);

  return {
    blockName: block ? block.blockName : "No_Block",
    scriptFamilyName: chartEntry ? chartEntry.familyName : null,
    scriptName: chartEntry ? chartEntry.scriptName : null,
    blockChartName: chartEntry ? chartEntry.chartLabel : null,
    chartSectionName: chartEntry ? chartEntry.sectionName : null,
  };
}

function mergeRanges(ranges) {
  const sortedRanges = [...ranges].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    return left.end - right.end;
  });
  const mergedRanges = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges[mergedRanges.length - 1];

    if (!previousRange || range.start > previousRange.end + 1) {
      mergedRanges.push({ ...range });
      continue;
    }

    previousRange.end = Math.max(previousRange.end, range.end);
  }

  return mergedRanges;
}

function countRangeCodePoints(ranges) {
  return ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
}

function serializeRanges(ranges) {
  return ranges.map((range) => [range.start, range.end]);
}

function getSpecificChartEntries(chartEntries) {
  const entriesByRange = new Map();

  for (const entry of chartEntries) {
    const rangeKey = `${entry.start}-${entry.end}`;
    const previousEntry = entriesByRange.get(rangeKey);

    if (!previousEntry || compareChartEntries(entry, previousEntry) < 0) {
      entriesByRange.set(rangeKey, entry);
    }
  }

  return Array.from(entriesByRange.values());
}

function getCoveragePolicy(scriptName, chartLabel) {
  if (
    chartLabel === scriptName ||
    chartLabel === `${scriptName} (ASCII)` ||
    chartLabel === `Basic ${scriptName}` ||
    chartLabel.startsWith(`Basic ${scriptName} `)
  ) {
    return {
      key: "core",
      label: "Core block",
      description: "Product policy: script 同名或主要 block，通常作为该 script 的核心覆盖范围。",
    };
  }

  if (/(Extended|Supplement|Presentation Forms|Compatibility|Ligatures|Fullwidth|Halfwidth)/i.test(chartLabel)) {
    return {
      key: "extended",
      label: "Extended block",
      description: "Product policy: 扩展、补充、兼容或呈现形式范围，不是 Unicode 官方 mandatory 要求。",
    };
  }

  return {
    key: "optional",
    label: "Optional block",
    description: "Product policy: 相关但更偏辅助、历史、语音或特殊用途的范围。",
  };
}

function getScriptUnicodeCoverageReference(scriptName) {
  const chartEntries = unicodeChartData.chartEntries.filter(
    (entry) => entry.sectionKey === "scripts" && entry.scriptName === scriptName
  );

  if (chartEntries.length === 0) {
    return null;
  }

  const mergedRanges = mergeRanges(
    chartEntries.map((entry) => ({
      start: entry.start,
      end: entry.end,
    }))
  );
  const rangesByChartLabel = new Map();

  for (const entry of getSpecificChartEntries(chartEntries)) {
    if (!rangesByChartLabel.has(entry.chartLabel)) {
      rangesByChartLabel.set(entry.chartLabel, []);
    }

    rangesByChartLabel.get(entry.chartLabel).push({
      start: entry.start,
      end: entry.end,
    });
  }
  const unicodeSubranges = Array.from(rangesByChartLabel.entries())
    .map(([chartLabel, ranges]) => {
      const mergedSubranges = mergeRanges(ranges);
      const coveragePolicy = getCoveragePolicy(scriptName, chartLabel);

      return {
        name: chartLabel,
        coveragePolicyKey: coveragePolicy.key,
        coveragePolicyLabel: coveragePolicy.label,
        coveragePolicyDescription: coveragePolicy.description,
        unicodeTotalCharacterCount: countRangeCodePoints(mergedSubranges),
        unicodeRangeCount: mergedSubranges.length,
        codePointRanges: serializeRanges(mergedSubranges),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    scriptName,
    unicodeTotalCharacterCount: countRangeCodePoints(mergedRanges),
    unicodeRangeCount: mergedRanges.length,
    codePointRanges: serializeRanges(mergedRanges),
    unicodeBlockCount: new Set(chartEntries.map((entry) => entry.blockName || entry.chartLabel)).size,
    unicodeBlocks: Array.from(new Set(chartEntries.map((entry) => entry.chartLabel))).sort((left, right) =>
      left.localeCompare(right)
    ),
    coveragePolicyKey: "script",
    coveragePolicyLabel: "Script total",
    coveragePolicyDescription: "汇总该 script 在 Unicode charts 中相关 ranges 的并集；Unicode 本身不定义 mandatory/optional 字体覆盖要求。",
    unicodeSubranges,
  };
}

module.exports = {
  findUnicodeBlock,
  getUnicodeMetadata,
  getScriptUnicodeCoverageReference,
};
