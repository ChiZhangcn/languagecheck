"use strict";

const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFontCharacters, extractFontCharactersFromBuffer, formatCodePoint, isTextCodePoint, summarizeSupportedScripts } = require("../src/index");
const { getScriptUnicodeCoverageReference, getUnicodeMetadata } = require("../src/unicode-chart-lookup");
const {
  getLanguage,
  getLanguageDataSourceOptions,
  getLanguagesForScript,
  getScript,
  getScriptByName,
  getScriptsForLanguage,
  googleLanguageData,
  languageScriptData,
} = require("../src/language-script-lookup");
const {
  formatPopulation,
  getPopulationForLanguage,
  getPopulationRankForLanguage,
  isTop200Language,
  languagePopulationData,
  topLanguagesByPopulation,
} = require("../src/language-population-lookup");
const { cjkStandardData, summarizeCjkStandardCoverage } = require("../src/cjk-standard-lookup");
const { getLanguageChineseName, languageTranslationData } = require("../src/language-translation-lookup");
const { app } = require("../src/server");

const candidateFonts = [
  "/System/Library/Fonts/Symbol.ttf",
  "/System/Library/Fonts/Geneva.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
];

test("formatCodePoint formats uppercase Unicode values", () => {
  assert.equal(formatCodePoint(65), "U+0041");
  assert.equal(formatCodePoint(0x1f600), "U+1F600");
});

test("isTextCodePoint filters out control and noncharacter code points", () => {
  assert.equal(isTextCodePoint(0x0000), false);
  assert.equal(isTextCodePoint(0x009f), false);
  assert.equal(isTextCodePoint(0xffff), false);
  assert.equal(isTextCodePoint(0xfdd0), false);
  assert.equal(isTextCodePoint(0x0627), true);
  assert.equal(isTextCodePoint(0x200d), true);
});

test("getUnicodeMetadata maps code points to block, family, and script names", () => {
  assert.deepEqual(getUnicodeMetadata(0x0041), {
    blockName: "Basic Latin",
    scriptFamilyName: "European Scripts",
    scriptName: "Latin",
    blockChartName: "Basic Latin (ASCII)",
    chartSectionName: "Scripts",
  });

  assert.deepEqual(getUnicodeMetadata(0x0627), {
    blockName: "Arabic",
    scriptFamilyName: "West Asian Scripts",
    scriptName: "Arabic",
    blockChartName: "Arabic",
    chartSectionName: "Scripts",
  });

  assert.deepEqual(getUnicodeMetadata(0x0905), {
    blockName: "Devanagari",
    scriptFamilyName: "South Asian Scripts",
    scriptName: "Devanagari",
    blockChartName: "Devanagari",
    chartSectionName: "Scripts",
  });
});

test("getScriptUnicodeCoverageReference counts Unicode ranges for a script", () => {
  const devanagariReference = getScriptUnicodeCoverageReference("Devanagari");

  assert.equal(devanagariReference.unicodeTotalCharacterCount, 256);
  assert.equal(devanagariReference.unicodeBlockCount, 3);
  assert.equal(devanagariReference.unicodeBlocks.includes("Devanagari"), true);
  assert.deepEqual(devanagariReference.codePointRanges, [
    [0x0900, 0x097f],
    [0xa8e0, 0xa8ff],
    [0x11b00, 0x11b5f],
  ]);
  assert.deepEqual(
    devanagariReference.unicodeSubranges.map((range) => [range.name, range.coveragePolicyKey]),
    [
      ["Devanagari", "core"],
      ["Devanagari Extended", "extended"],
      ["Devanagari Extended-A", "extended"],
    ]
  );
});

test("extractFontCharacters returns supported code points for an installed font", async (t) => {
  const fontPath = candidateFonts.find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    t.skip("No system TTF/OTF font available for verification.");
    return;
  }

  const result = extractFontCharacters(fontPath);

  assert.equal(result.fontPath, fontPath);
  assert.ok(result.characterCount > 0);
  assert.equal(result.characters.length, result.characterCount);
  assert.equal(result.rawCharacterCount >= result.characterCount, true);
  assert.equal(result.filteredOutCount, result.rawCharacterCount - result.characterCount);
  assert.equal(result.characters.every((entry) => isTextCodePoint(entry.decimalCodePoint)), true);
  assert.equal(typeof result.characters[0].blockName, "string");
  assert.equal(typeof result.characters[0].scriptFamilyName === "string" || result.characters[0].scriptFamilyName === null, true);
  assert.equal(typeof result.characters[0].scriptName === "string" || result.characters[0].scriptName === null, true);
  assert.match(result.characters[0].unicode, /^U\+[0-9A-F]+$/);
  assert.equal(result.supportedScriptCount, result.supportedScripts.length);
  assert.equal(result.supportedScripts.length > 0, true);
  assert.equal(result.supportedScripts.every((script) => typeof script.completenessPercent === "number"), true);
});

test("extractFontCharactersFromBuffer parses uploaded font data", async (t) => {
  const fontPath = candidateFonts.find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    t.skip("No system TTF/OTF font available for verification.");
    return;
  }

  const fontBuffer = fs.readFileSync(fontPath);
  const result = extractFontCharactersFromBuffer(fontBuffer, "sample-font.ttf");

  assert.equal(result.sourceName, "sample-font.ttf");
  assert.equal(result.fontPath, null);
  assert.ok(result.characterCount > 0);
  assert.equal(result.characters.length, result.characterCount);
  assert.equal(result.characters.every((entry) => isTextCodePoint(entry.decimalCodePoint)), true);
});

test("extractFontCharacters can include non-text code points when explicitly requested", async (t) => {
  const fontPath = candidateFonts.find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    t.skip("No system TTF/OTF font available for verification.");
    return;
  }

  const result = extractFontCharacters(fontPath, {
    includeNonTextCodePoints: true,
  });

  assert.equal(result.characterCount, result.rawCharacterCount);
  assert.equal(result.filteredOutCount, 0);
});

test("server exports an express app instance", () => {
  assert.equal(typeof app, "function");
  assert.equal(typeof app.use, "function");
});

test("language-script data includes global language and script source lists", () => {
  assert.equal(languageScriptData.summary.languages > 8000, true);
  assert.equal(languageScriptData.summary.scripts > 200, true);
  assert.equal(languageScriptData.summary.languageScriptRelations > 900, true);

  assert.equal(getLanguage("en").name, "English");
  assert.equal(getLanguage("zh").name, "Chinese");
  assert.equal(getLanguage("ar").name, "Arabic");

  assert.equal(getScript("Latn").name, "Latin");
  assert.equal(getScript("Arab").name, "Arabic");
  assert.equal(getScript("Deva").alias, "Devanagari");
  assert.equal(getScriptByName("Devanagari").code, "Deva");
  assert.equal(getScriptByName("CJK Unified Ideographs (Han) (43MB)").code, "Hani");
});

test("Google language data includes language, region, and script relations", () => {
  assert.equal(googleLanguageData.summary.languages > 1600, true);
  assert.equal(googleLanguageData.summary.regions > 200, true);
  assert.equal(googleLanguageData.summary.scripts > 150, true);
  assert.equal(googleLanguageData.summary.languageScriptRelations, googleLanguageData.summary.languages);

  assert.equal(getLanguageDataSourceOptions().some((source) => source.key === "google"), true);
  assert.equal(getLanguage("en_Latn", { sourceKey: "google" }).name, "English");
  assert.equal(getScript("Latn", { sourceKey: "google" }).name, "Latin");
  assert.equal(getScriptByName("Devanagari", { sourceKey: "google" }).code, "Deva");
  assert.equal(
    getLanguagesForScript("Deva", { sourceKey: "google" }).some(
      (relation) => relation.languageCode === "hi_Deva" && relation.population > 100_000_000
    ),
    true
  );
});

test("language translation data provides Chinese names for both language sources", () => {
  assert.equal(languageTranslationData.summary.wikiUnicodeTranslated > 500, true);
  assert.equal(languageTranslationData.summary.googleTranslated > 700, true);
  assert.equal(getLanguageChineseName("wikiUnicode", "en"), "英语");
  assert.equal(getLanguageChineseName("wikiUnicode", "hi"), "印地语");
  assert.equal(getLanguageChineseName("wikiUnicode", "apd"), "苏丹阿拉伯语");
  assert.equal(getLanguageChineseName("wikiUnicode", "acf"), "圣卢西亚克里奥尔法语");
  assert.equal(getLanguageChineseName("wikiUnicode", "lzh"), "文言文");
  assert.equal(getLanguageChineseName("google", "en_Latn"), "英语");
  assert.equal(getLanguageChineseName("google", "arq_Arab"), "阿尔及利亚阿拉伯语");
  assert.equal(getLanguageChineseName("google", "acf_Latn"), "圣卢西亚克里奥尔法语");
  assert.equal(getLanguageChineseName("google", "az_Arab"), "阿塞语（波斯阿拉伯文）");
});

test("language-script lookup maps common primary and secondary script relations", () => {
  assert.deepEqual(
    getScriptsForLanguage("en", { usage: "primary" }).map((relation) => relation.scriptCode),
    ["Latn"]
  );

  assert.deepEqual(
    getScriptsForLanguage("sr", { usage: "primary" }).map((relation) => relation.scriptCode),
    ["Cyrl", "Latn"]
  );

  assert.deepEqual(
    getScriptsForLanguage("zh").map((relation) => relation.scriptCode),
    ["Bopo", "Hans", "Hant", "Latn", "Phag"]
  );

  assert.equal(getScriptsForLanguage("az").some((relation) => relation.scriptCode === "Arab" && relation.usage === "secondary"), true);
  assert.equal(getLanguagesForScript("Deva", { usage: "primary" }).some((relation) => relation.languageCode === "hi"), true);
});

test("language population data maps language codes to speaker estimates", () => {
  assert.equal(languagePopulationData.summary.languagesWithPopulation > 1000, true);
  assert.equal(languagePopulationData.summary.wikidataEstimates >= languagePopulationData.summary.languagesWithPopulation, true);
  assert.equal(topLanguagesByPopulation.length > 1000, true);
  assert.equal(topLanguagesByPopulation.length <= languagePopulationData.summary.languagesWithPopulation, true);
  assert.equal(topLanguagesByPopulation[0].population >= topLanguagesByPopulation[199].population, true);

  const englishPopulation = getPopulationForLanguage("en");

  assert.equal(englishPopulation.population > 1_000_000_000, true);
  assert.equal(englishPopulation.populationType, "total");
  assert.equal(formatPopulation(englishPopulation.population).endsWith("B"), true);
  assert.equal(getPopulationRankForLanguage("en") <= 200, true);
  assert.equal(isTop200Language("en"), true);
});

test("summarizeSupportedScripts groups parsed characters and attaches language relations", () => {
  const supportedScripts = summarizeSupportedScripts([
    { scriptName: "Latin", scriptFamilyName: "European Scripts", chartSectionName: "Scripts" },
    { scriptName: "Latin", scriptFamilyName: "European Scripts", chartSectionName: "Scripts" },
    { scriptName: "Devanagari", scriptFamilyName: "South Asian Scripts", chartSectionName: "Scripts" },
    { scriptName: "General Punctuation", blockChartName: "General Punctuation", chartSectionName: "Symbols and Punctuation" },
  ]);

  assert.deepEqual(
    supportedScripts.map((script) => [script.scriptName, script.scriptCode, script.characterCount]),
    [
      ["Latin", "Latn", 2],
      ["Devanagari", "Deva", 1],
    ]
  );
  assert.equal(supportedScripts[0].unicodeTotalCharacterCount, 1878);
  assert.equal(supportedScripts[0].completenessPercent > 0, true);
  assert.equal(supportedScripts[0].codePointRanges.length > 0, true);
  assert.equal(supportedScripts[0].completenessChildren.some((child) => child.name === "Basic Latin (ASCII)"), true);
  assert.equal(supportedScripts[1].completenessChildren.some((child) => child.name === "Devanagari"), true);
  assert.equal(supportedScripts[1].completenessChildren.find((child) => child.name === "Devanagari").coveragePolicyKey, "core");
  assert.deepEqual(supportedScripts[1].completenessChildren.find((child) => child.name === "Devanagari").codePointRanges, [
    [0x0900, 0x097f],
  ]);
  assert.equal(supportedScripts[0].languages.some((language) => language.code === "en"), true);
  assert.equal(supportedScripts[0].languages.some((language) => language.code === "en" && language.chineseName === "英语"), true);
  assert.equal(supportedScripts[1].languages.some((language) => language.code === "hi"), true);
  assert.equal(supportedScripts[0].languageSources.google.languages.some((language) => language.code === "en_Latn"), true);
  assert.equal(
    supportedScripts[1].languageSources.google.languages.some(
      (language) => language.code === "hi_Deva" && language.spokenPopulation > 100_000_000
    ),
    true
  );
  assert.equal(supportedScripts[0].languages.some((language) => language.code === "en" && language.spokenPopulation > 1_000_000_000), true);
  assert.equal(supportedScripts[0].languages.some((language) => language.code === "en" && language.isTop200Language), true);
});

test("CJK standard data includes language-specific coverage profiles", () => {
  assert.equal(cjkStandardData.summary.profileCount, 16);

  const profileTotals = Object.fromEntries(
    cjkStandardData.profiles.map((profile) => [profile.key, profile.totalCharacterCount])
  );
  const profilesByLanguage = cjkStandardData.profiles.reduce((groups, profile) => {
    groups[profile.languageName] = (groups[profile.languageName] || 0) + 1;
    return groups;
  }, {});

  assert.equal(profileTotals.gb2312 > 7000, true);
  assert.equal(profileTotals.gbk > profileTotals.gb2312, true);
  assert.equal(profileTotals["gb18030-2022-level-2"] > profileTotals.gbk, true);
  assert.equal(profileTotals["gb18030-2022-level-3"] > profileTotals["gb18030-2022-level-2"], true);
  assert.equal(profileTotals["adobe-gb1-6"] > 30000, true);
  assert.equal(profileTotals.big5 > 10000, true);
  assert.equal(profileTotals["adobe-cns1-7"] > profileTotals.big5, true);
  assert.equal(profileTotals["jis-x-0208"] > 7000, true);
  assert.equal(profileTotals["adobe-japan1-7"] >= profileTotals["jis-x-0213-2004"], true);
  assert.equal(profileTotals["ks-x-1001"] > 8000, true);
  assert.equal(profileTotals["ks-x-1002"], 11172);
  assert.equal(profileTotals["adobe-kr-9"] > profileTotals["ks-x-1001"], true);
  assert.deepEqual(profilesByLanguage, {
    "Simplified Chinese": 6,
    "Traditional Chinese": 4,
    Japanese: 3,
    Korean: 3,
  });
});

test("summarizeCjkStandardCoverage detects Han fonts and counts standards", () => {
  const coverage = summarizeCjkStandardCoverage([
    {
      decimalCodePoint: 0x4e00,
      scriptFamilyName: "East Asian Scripts",
      scriptName: "CJK Unified Ideographs (Han) (43MB)",
      blockName: "CJK Unified Ideographs",
    },
    {
      decimalCodePoint: 0x4e01,
      scriptFamilyName: "East Asian Scripts",
      scriptName: "CJK Unified Ideographs (Han) (43MB)",
      blockName: "CJK Unified Ideographs",
    },
  ]);

  assert.equal(coverage.detected, true);
  assert.equal(coverage.languageProfiles[0].languageName, "Simplified Chinese");
  assert.equal(coverage.languageProfiles[0].profiles.length, 6);
  assert.equal(coverage.languageProfiles[0].profiles[0].codePointRanges.length > 0, true);
  assert.equal(coverage.languageProfiles.length, 4);
  assert.equal(
    coverage.languageProfiles[0].profiles.some(
      (profile) => profile.key === "gb2312" && profile.supportedCharacterCount > 0
    ),
    true
  );
  assert.equal(
    coverage.languageProfiles.some(
      (group) => group.languageName === "Korean" && group.profiles.some((profile) => profile.key === "adobe-kr-9")
    ),
    true
  );
});
