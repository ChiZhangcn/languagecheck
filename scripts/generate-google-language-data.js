"use strict";

const fs = require("node:fs");
const path = require("node:path");

const GITHUB_TREE_URL = "https://api.github.com/repos/googlefonts/lang/git/trees/main?recursive=1";
const RAW_BASE_URL = "https://raw.githubusercontent.com/googlefonts/lang/main/";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "google-language-data.js");
const DATA_PREFIX = "Lib/gflanguages/data/";
const DATA_SETS = {
  languages: `${DATA_PREFIX}languages/`,
  regions: `${DATA_PREFIX}regions/`,
  scripts: `${DATA_PREFIX}scripts/`,
};

function addRecordValue(record, key, value) {
  if (record[key] === undefined) {
    record[key] = value;
    return;
  }

  if (!Array.isArray(record[key])) {
    record[key] = [record[key]];
  }

  record[key].push(value);
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function parseScalar(value) {
  const trimmedValue = value.trim();

  if (trimmedValue === "true") {
    return true;
  }

  if (trimmedValue === "false") {
    return false;
  }

  if (/^-?\d+$/.test(trimmedValue)) {
    return Number(trimmedValue);
  }

  if (trimmedValue.startsWith("\"") && trimmedValue.endsWith("\"")) {
    try {
      return JSON.parse(trimmedValue);
    } catch (_error) {
      return trimmedValue.slice(1, -1);
    }
  }

  return trimmedValue;
}

function parseTopLevelTextproto(text) {
  const record = {};
  let depth = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.endsWith("{")) {
      depth += 1;
      continue;
    }

    if (line === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth > 0) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][\w]*):\s*(.+)$/);

    if (!match) {
      continue;
    }

    addRecordValue(record, match[1], parseScalar(match[2]));
  }

  return record;
}

function formatPopulation(population) {
  if (!population || population <= 0) {
    return null;
  }

  if (population >= 1_000_000_000) {
    return `${(population / 1_000_000_000).toFixed(population >= 10_000_000_000 ? 0 : 1)}B`;
  }

  if (population >= 1_000_000) {
    return `${(population / 1_000_000).toFixed(population >= 10_000_000 ? 0 : 1)}M`;
  }

  if (population >= 1_000) {
    return `${(population / 1_000).toFixed(population >= 10_000 ? 0 : 1)}K`;
  }

  return population.toLocaleString("en");
}

function getDataPaths(tree, prefix) {
  return tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix) && entry.path.endsWith(".textproto"))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

async function downloadJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LanguageCheck data generator",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LanguageCheck data generator",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

  return output;
}

async function downloadRecords(paths) {
  return mapWithConcurrency(paths, 16, async (filePath) => ({
    filePath,
    record: parseTopLevelTextproto(await downloadText(`${RAW_BASE_URL}${filePath}`)),
  }));
}

function normalizeLanguage(entry) {
  const record = entry.record;

  return {
    id: record.id || path.basename(entry.filePath, ".textproto"),
    languageCode: record.language || null,
    scriptCode: record.script || null,
    name: record.preferred_name || record.name || record.id || null,
    originalName: record.name || null,
    preferredName: record.preferred_name || null,
    autonym: record.autonym || null,
    population: typeof record.population === "number" ? record.population : null,
    regions: asArray(record.region).sort((left, right) => left.localeCompare(right)),
    historical: record.historical === true,
    sources: asArray(record.source),
    note: record.note || null,
    source: "googlefonts/lang",
  };
}

function normalizeRegion(entry) {
  const record = entry.record;

  return {
    code: record.id || path.basename(entry.filePath, ".textproto"),
    name: record.name || record.id || null,
    population: typeof record.population === "number" ? record.population : null,
    regionGroups: asArray(record.region_group).sort((left, right) => left.localeCompare(right)),
    source: "googlefonts/lang",
  };
}

function normalizeScript(entry) {
  const record = entry.record;

  return {
    code: record.id || path.basename(entry.filePath, ".textproto"),
    name: record.name || record.id || null,
    family: record.family || null,
    historical: record.historical === true,
    fictional: record.fictional === true,
    summary: record.summary || null,
    source: "googlefonts/lang",
  };
}

function buildLanguageScripts(languages, regions, scripts) {
  const regionByCode = new Map(regions.map((region) => [region.code, region]));
  const scriptByCode = new Map(scripts.map((script) => [script.code, script]));
  const populationRanks = new Map(
    [...languages]
      .filter((language) => typeof language.population === "number")
      .sort((left, right) => right.population - left.population)
      .map((language, index) => [language.id, index + 1])
  );

  return languages
    .filter((language) => language.scriptCode)
    .map((language) => {
      const script = scriptByCode.get(language.scriptCode);
      const populationRank = populationRanks.get(language.id) || null;

      return {
        languageCode: language.id,
        baseLanguageCode: language.languageCode,
        languageName: language.name,
        preferredName: language.preferredName,
        autonym: language.autonym,
        scriptCode: language.scriptCode,
        scriptName: script ? script.name : null,
        usage: "primary",
        regions: language.regions,
        regionNames: language.regions.map((regionCode) => regionByCode.get(regionCode)?.name || regionCode),
        population: language.population,
        populationLabel: formatPopulation(language.population),
        populationRank,
        isTop200Language: populationRank !== null && populationRank <= 200,
        historical: language.historical,
        source: "googlefonts/lang",
      };
    })
    .sort((left, right) => {
      if (left.scriptCode !== right.scriptCode) {
        return left.scriptCode.localeCompare(right.scriptCode);
      }

      return (left.languageName || left.languageCode).localeCompare(right.languageName || right.languageCode);
    });
}

function summarize(languages, regions, scripts, languageScripts) {
  return {
    languages: languages.length,
    regions: regions.length,
    scripts: scripts.length,
    languageScriptRelations: languageScripts.length,
    languagesWithPopulation: languages.filter((language) => typeof language.population === "number").length,
    scriptsWithLanguageRelations: new Set(languageScripts.map((relation) => relation.scriptCode)).size,
    regionLanguageRelations: languageScripts.reduce((total, relation) => total + relation.regions.length, 0),
  };
}

async function main() {
  const treePayload = await downloadJson(GITHUB_TREE_URL);
  const tree = treePayload.tree || [];
  const languagePaths = getDataPaths(tree, DATA_SETS.languages);
  const regionPaths = getDataPaths(tree, DATA_SETS.regions);
  const scriptPaths = getDataPaths(tree, DATA_SETS.scripts);
  const [languageEntries, regionEntries, scriptEntries] = await Promise.all([
    downloadRecords(languagePaths),
    downloadRecords(regionPaths),
    downloadRecords(scriptPaths),
  ]);

  const languages = languageEntries.map(normalizeLanguage).sort((left, right) => left.id.localeCompare(right.id));
  const regions = regionEntries.map(normalizeRegion).sort((left, right) => left.code.localeCompare(right.code));
  const scripts = scriptEntries.map(normalizeScript).sort((left, right) => left.code.localeCompare(right.code));
  const languageScripts = buildLanguageScripts(languages, regions, scripts);
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      repository: {
        name: "googlefonts/lang",
        url: "https://github.com/googlefonts/lang",
        dataPath: "Lib/gflanguages/data",
      },
      languages: {
        name: "googlefonts/lang languages textproto",
        url: "https://github.com/googlefonts/lang/tree/main/Lib/gflanguages/data/languages",
      },
      regions: {
        name: "googlefonts/lang regions textproto",
        url: "https://github.com/googlefonts/lang/tree/main/Lib/gflanguages/data/regions",
      },
      scripts: {
        name: "googlefonts/lang scripts textproto",
        url: "https://github.com/googlefonts/lang/tree/main/Lib/gflanguages/data/scripts",
      },
    },
    summary: summarize(languages, regions, scripts, languageScripts),
    languages,
    regions,
    scripts,
    languageScripts,
  };
  const output = `"use strict";\n\nmodule.exports = ${JSON.stringify(payload, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(
    `Generated Google data: ${payload.summary.languages} languages, ${payload.summary.regions} regions, ${payload.summary.scripts} scripts, and ${payload.summary.languageScriptRelations} language-script relations at ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
