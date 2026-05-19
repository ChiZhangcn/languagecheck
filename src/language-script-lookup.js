"use strict";

const languageScriptData = require("./language-script-data");
const googleLanguageData = require("./google-language-data");

const LANGUAGE_DATA_SOURCES = {
  wikiUnicode: {
    key: "wikiUnicode",
    label: "Wiki+Unicode",
    description: "IANA language list + ISO 15924 scripts + Unicode CLDR language/script relations.",
    data: languageScriptData,
  },
  google: {
    key: "google",
    label: "Google 数据",
    description: "googlefonts/lang languages, regions, and scripts metadata.",
    data: googleLanguageData,
  },
};
const DEFAULT_LANGUAGE_DATA_SOURCE = "wikiUnicode";
const chartScriptAliasByName = new Map(
  Object.entries({
    "CJK Unified Ideographs (Han) (43MB)": "Hani",
    "CJK Compatibility Ideographs": "Hani",
    "CJK Radicals / Kangxi Radicals": "Hani",
    "Hangul Jamo": "Hang",
    "Hangul Syllables": "Hang",
    "Kana Extended-A": "Kana",
    "Kana Extended-B": "Kana",
    "Kana Supplement": "Kana",
    "Small Kana Extension": "Kana",
  })
);

function getLanguageDataSource(sourceKey = DEFAULT_LANGUAGE_DATA_SOURCE) {
  return LANGUAGE_DATA_SOURCES[sourceKey] || LANGUAGE_DATA_SOURCES[DEFAULT_LANGUAGE_DATA_SOURCE];
}

function getLanguageDataSourceOptions() {
  return Object.values(LANGUAGE_DATA_SOURCES).map((source) => ({
    key: source.key,
    label: source.label,
    description: source.description,
    summary: source.data.summary,
    sources: source.data.sources,
  }));
}

function normalizeScriptName(value) {
  return value
    ? value
        .replace(/[^a-z0-9]+/gi, "")
        .toLowerCase()
    : "";
}

function buildLanguageByCode(data) {
  return new Map(
    data.languages.flatMap((language) => {
      const entries = [];

      if (language.code) {
        entries.push([language.code, language]);
      }

      if (language.id) {
        entries.push([language.id, language]);
      }

      if (language.languageCode) {
        entries.push([language.languageCode, language]);
      }

      return entries;
    })
  );
}

function buildScriptByCode(data) {
  return new Map(data.scripts.map((script) => [script.code, script]));
}

function buildScriptCodeByName(data) {
  const scriptCodeByName = new Map();

  for (const script of data.scripts) {
    const names = [
      script.code,
      script.name,
      script.alias,
      script.family,
    ];

    for (const name of names) {
      const normalizedName = normalizeScriptName(name);

      if (normalizedName && !scriptCodeByName.has(normalizedName)) {
        scriptCodeByName.set(normalizedName, script.code);
      }
    }
  }

  return scriptCodeByName;
}

const lookupBySource = new Map(
  Object.values(LANGUAGE_DATA_SOURCES).map((source) => [
    source.key,
    {
      languageByCode: buildLanguageByCode(source.data),
      scriptByCode: buildScriptByCode(source.data),
      scriptCodeByName: buildScriptCodeByName(source.data),
    },
  ])
);

function getLookup(sourceKey = DEFAULT_LANGUAGE_DATA_SOURCE) {
  return lookupBySource.get(getLanguageDataSource(sourceKey).key);
}

function normalizeUsageFilter(options = {}) {
  if (!options.usage) {
    return null;
  }

  return new Set(Array.isArray(options.usage) ? options.usage : [options.usage]);
}

function filterByUsage(relations, options = {}) {
  const allowedUsages = normalizeUsageFilter(options);

  if (!allowedUsages) {
    return relations;
  }

  return relations.filter((relation) => allowedUsages.has(relation.usage));
}

function getLanguage(code, options = {}) {
  return getLookup(options.sourceKey).languageByCode.get(code) || null;
}

function getScript(code, options = {}) {
  return getLookup(options.sourceKey).scriptByCode.get(code) || null;
}

function getScriptByName(scriptName, options = {}) {
  const aliasedCode = chartScriptAliasByName.get(scriptName);

  if (aliasedCode) {
    return getScript(aliasedCode, options);
  }

  const scriptCode = getLookup(options.sourceKey).scriptCodeByName.get(normalizeScriptName(scriptName));

  return scriptCode ? getScript(scriptCode, options) : null;
}

function getScriptsForLanguage(languageCode, options = {}) {
  const data = getLanguageDataSource(options.sourceKey).data;

  return filterByUsage(
    data.languageScripts.filter(
      (relation) => relation.languageCode === languageCode || relation.baseLanguageCode === languageCode
    ),
    options
  );
}

function getLanguagesForScript(scriptCode, options = {}) {
  const data = getLanguageDataSource(options.sourceKey).data;

  return filterByUsage(
    data.languageScripts.filter((relation) => relation.scriptCode === scriptCode),
    options
  );
}

module.exports = {
  DEFAULT_LANGUAGE_DATA_SOURCE,
  LANGUAGE_DATA_SOURCES,
  getLanguage,
  getLanguageDataSource,
  getLanguageDataSourceOptions,
  getScript,
  getScriptByName,
  getLanguagesForScript,
  getScriptsForLanguage,
  languageScriptData,
  googleLanguageData,
};
