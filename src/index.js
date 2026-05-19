"use strict";

const fs = require("node:fs");
const path = require("node:path");
const fontkit = require("fontkit");
const { getScriptUnicodeCoverageReference, getUnicodeMetadata } = require("./unicode-chart-lookup");
const {
  getLanguageDataSourceOptions,
  getLanguagesForScript,
  getScriptByName,
} = require("./language-script-lookup");
const { getLanguageChineseName } = require("./language-translation-lookup");
const {
  formatPopulation,
  getPopulationForLanguage,
  getPopulationRankForLanguage,
  isTop200Language,
} = require("./language-population-lookup");
const { summarizeCjkStandardCoverage } = require("./cjk-standard-lookup");

function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function isSupportedFont(fontPath) {
  return /\.(ttf|otf)$/i.test(fontPath);
}

function isControlCodePoint(codePoint) {
  return (codePoint >= 0x0000 && codePoint <= 0x001f) || (codePoint >= 0x007f && codePoint <= 0x009f);
}

function isNonCharacterCodePoint(codePoint) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe;
}

function isTextCodePoint(codePoint) {
  return !isControlCodePoint(codePoint) && !isNonCharacterCodePoint(codePoint);
}

function normalizeOptions(options = {}) {
  return {
    includeNonTextCodePoints: options.includeNonTextCodePoints === true,
  };
}

function buildLanguagePayload(relation, sourceKey) {
  if (sourceKey === "google") {
    return {
      code: relation.languageCode,
      baseCode: relation.baseLanguageCode || relation.languageCode,
      name: relation.languageName,
      chineseName: getLanguageChineseName("google", relation.languageCode),
      autonym: relation.autonym || null,
      usage: relation.usage,
      regions: relation.regions || [],
      regionNames: relation.regionNames || [],
      spokenPopulation: relation.population || null,
      spokenPopulationLabel: relation.populationLabel || null,
      populationType: relation.population ? "total" : null,
      populationEstimateYear: null,
      populationSource: "googlefonts/lang",
      populationRank: relation.populationRank || null,
      isTop200Language: relation.isTop200Language === true,
      dataSource: "google",
    };
  }

  const population = getPopulationForLanguage(relation.languageCode);

  return {
    code: relation.languageCode,
    baseCode: relation.languageCode,
    name: relation.languageName,
    chineseName: getLanguageChineseName("wikiUnicode", relation.languageCode),
    usage: relation.usage,
    spokenPopulation: population ? population.population : null,
    spokenPopulationLabel: population ? formatPopulation(population.population) : null,
    populationType: population ? population.populationType : null,
    populationEstimateYear: population ? population.estimateYear : null,
    populationSource: population ? population.source : null,
    populationRank: getPopulationRankForLanguage(relation.languageCode),
    isTop200Language: isTop200Language(relation.languageCode),
    dataSource: "wikiUnicode",
  };
}

function buildLanguageSourcePayload(scriptName, sourceKey) {
  const script = getScriptByName(scriptName, { sourceKey });
  const languages = script
    ? getLanguagesForScript(script.code, { sourceKey }).map((relation) => buildLanguagePayload(relation, sourceKey))
    : [];

  return {
    sourceKey,
    scriptCode: script ? script.code : null,
    isoScriptName: script ? script.name : null,
    scriptFamilyName: script ? script.family || null : null,
    languageCount: languages.length,
    languages,
  };
}

function summarizeSupportedScripts(characters) {
  const scriptGroups = new Map();

  for (const entry of characters) {
    if (!entry.scriptName || entry.chartSectionName !== "Scripts") {
      continue;
    }

    const scriptName = entry.scriptName;

    if (!scriptGroups.has(scriptName)) {
      const languageSources = {
        wikiUnicode: buildLanguageSourcePayload(scriptName, "wikiUnicode"),
        google: buildLanguageSourcePayload(scriptName, "google"),
      };
      const defaultLanguageSource = languageSources.wikiUnicode;
      const coverageReference = getScriptUnicodeCoverageReference(scriptName);

      scriptGroups.set(scriptName, {
        scriptName,
        scriptFamilyName: entry.scriptFamilyName || null,
        scriptCode: defaultLanguageSource.scriptCode,
        isoScriptName: defaultLanguageSource.isoScriptName,
        characterCount: 0,
        unicodeTotalCharacterCount: coverageReference ? coverageReference.unicodeTotalCharacterCount : null,
        unicodeRangeCount: coverageReference ? coverageReference.unicodeRangeCount : null,
        codePointRanges: coverageReference ? coverageReference.codePointRanges : [],
        unicodeBlockCount: coverageReference ? coverageReference.unicodeBlockCount : null,
        unicodeBlocks: coverageReference ? coverageReference.unicodeBlocks : [],
        coveragePolicyKey: coverageReference ? coverageReference.coveragePolicyKey : null,
        coveragePolicyLabel: coverageReference ? coverageReference.coveragePolicyLabel : null,
        coveragePolicyDescription: coverageReference ? coverageReference.coveragePolicyDescription : null,
        completenessChildren: coverageReference
          ? coverageReference.unicodeSubranges.map((subrange) => ({
              name: subrange.name,
              coveragePolicyKey: subrange.coveragePolicyKey,
              coveragePolicyLabel: subrange.coveragePolicyLabel,
              coveragePolicyDescription: subrange.coveragePolicyDescription,
              characterCount: 0,
              unicodeTotalCharacterCount: subrange.unicodeTotalCharacterCount,
              unicodeRangeCount: subrange.unicodeRangeCount,
              codePointRanges: subrange.codePointRanges,
              completenessPercent: null,
            }))
          : [],
        completenessPercent: null,
        languageSources,
        languageCount: defaultLanguageSource.languageCount,
        languages: defaultLanguageSource.languages,
      });
    }

    scriptGroups.get(scriptName).characterCount += 1;
    const matchingChild = scriptGroups
      .get(scriptName)
      .completenessChildren.find((child) => child.name === entry.blockChartName);

    if (matchingChild) {
      matchingChild.characterCount += 1;
    }
  }

  return Array.from(scriptGroups.values()).map((script) => {
    const completenessPercent = script.unicodeTotalCharacterCount
      ? Math.min(100, (script.characterCount / script.unicodeTotalCharacterCount) * 100)
      : null;

    return {
      ...script,
      completenessPercent,
      completenessChildren: script.completenessChildren.map((child) => ({
        ...child,
        completenessPercent: child.unicodeTotalCharacterCount
          ? Math.min(100, (child.characterCount / child.unicodeTotalCharacterCount) * 100)
          : null,
      })),
    };
  }).sort((left, right) => {
    if (right.characterCount !== left.characterCount) {
      return right.characterCount - left.characterCount;
    }

    return left.scriptName.localeCompare(right.scriptName);
  });
}

function buildFontResult(font, sourceName, fontPath = null, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const rawCodePoints = Array.from(new Set(font.characterSet || [])).sort((a, b) => a - b);
  const codePoints = normalizedOptions.includeNonTextCodePoints
    ? rawCodePoints
    : rawCodePoints.filter(isTextCodePoint);
  const characters = codePoints.map((codePoint) => {
    const glyph = font.glyphForCodePoint(codePoint);
    const unicodeMetadata = getUnicodeMetadata(codePoint);

    return {
      character: String.fromCodePoint(codePoint),
      unicode: formatCodePoint(codePoint),
      decimalCodePoint: codePoint,
      blockName: unicodeMetadata.blockName,
      scriptFamilyName: unicodeMetadata.scriptFamilyName,
      scriptName: unicodeMetadata.scriptName,
      blockChartName: unicodeMetadata.blockChartName,
      chartSectionName: unicodeMetadata.chartSectionName,
      glyphId: typeof glyph?.id === "number" ? glyph.id : null,
      glyphName: glyph?.name || null,
    };
  });
  const supportedScripts = summarizeSupportedScripts(characters);
  const cjkStandardCoverage = summarizeCjkStandardCoverage(characters);

  return {
    sourceName,
    fontPath,
    postscriptName: font.postscriptName || null,
    fullName: font.fullName || null,
    familyName: font.familyName || null,
    subfamilyName: font.subfamilyName || null,
    rawCharacterCount: rawCodePoints.length,
    characterCount: codePoints.length,
    filteredOutCount: rawCodePoints.length - codePoints.length,
    includeNonTextCodePoints: normalizedOptions.includeNonTextCodePoints,
    supportedScriptCount: supportedScripts.length,
    supportedScripts,
    cjkStandardCoverage,
    languageDataSources: getLanguageDataSourceOptions(),
    characters,
  };
}

function extractFontCharacters(fontFilePath, options = {}) {
  if (!fontFilePath) {
    throw new Error("A font file path is required.");
  }

  const absolutePath = path.resolve(fontFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Font file not found: ${absolutePath}`);
  }

  if (!isSupportedFont(absolutePath)) {
    throw new Error("Only .ttf and .otf font files are supported.");
  }

  const font = fontkit.openSync(absolutePath);

  return buildFontResult(font, path.basename(absolutePath), absolutePath, options);
}

function extractFontCharactersFromBuffer(fontBuffer, sourceName = "uploaded-font", options = {}) {
  if (!fontBuffer || fontBuffer.length === 0) {
    throw new Error("A font buffer is required.");
  }

  const font = fontkit.create(fontBuffer);

  return buildFontResult(font, sourceName, null, options);
}

module.exports = {
  extractFontCharacters,
  extractFontCharactersFromBuffer,
  formatCodePoint,
  isTextCodePoint,
  isSupportedFont,
  summarizeSupportedScripts,
};
