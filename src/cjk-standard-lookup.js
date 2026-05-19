"use strict";

const cjkStandardData = require("./cjk-standard-data");

const CJK_TRIGGER_SCRIPT_NAMES = new Set([
  "CJK Unified Ideographs (Han) (43MB)",
  "Hiragana",
  "Katakana",
  "Bopomofo",
  "Hangul Jamo",
  "Hangul Syllables",
  "Kana Extended-A",
  "Kana Extended-B",
  "Kana Supplement",
  "Small Kana Extension",
]);

function countRangeCharacters(ranges) {
  return ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
}

function isCjkCharacter(entry) {
  return (
    entry.scriptFamilyName === "East Asian Scripts" ||
    CJK_TRIGGER_SCRIPT_NAMES.has(entry.scriptName) ||
    /CJK|Han|Hangul|Hiragana|Katakana|Bopomofo|Kana/i.test(entry.scriptName || "") ||
    /CJK|Hangul|Hiragana|Katakana|Bopomofo|Kana/i.test(entry.blockName || "")
  );
}

function isCjkFont(characters) {
  const cjkCharacterCount = characters.filter(isCjkCharacter).length;

  return cjkCharacterCount >= 20 || cjkCharacterCount / Math.max(1, characters.length) >= 0.05;
}

function countSupportedCodePoints(profile, fontCodePoints) {
  let supportedCount = 0;

  for (const [start, end] of profile.codePointRanges) {
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (fontCodePoints.has(codePoint)) {
        supportedCount += 1;
      }
    }
  }

  return supportedCount;
}

function summarizeCjkStandardCoverage(characters) {
  const cjkCharacterCount = characters.filter(isCjkCharacter).length;
  const detected = isCjkFont(characters);

  if (!detected) {
    return {
      detected: false,
      cjkCharacterCount,
      languageProfiles: [],
    };
  }

  const fontCodePoints = new Set(characters.map((entry) => entry.decimalCodePoint));
  const profiles = cjkStandardData.profiles.map((profile) => {
    const supportedCharacterCount = countSupportedCodePoints(profile, fontCodePoints);
    const totalCharacterCount = profile.totalCharacterCount || countRangeCharacters(profile.codePointRanges);

    return {
      key: profile.key,
      name: profile.name,
      standard: profile.standard,
      category: profile.category,
      description: profile.description,
      source: profile.source,
      sourceUrl: profile.sourceUrl,
      languageName: profile.languageName,
      languageCode: profile.languageCode,
      codePointRanges: profile.codePointRanges,
      supportedCharacterCount,
      totalCharacterCount,
      rangeCount: profile.rangeCount,
      completenessPercent: totalCharacterCount
        ? Math.min(100, (supportedCharacterCount / totalCharacterCount) * 100)
        : null,
    };
  });
  const profileGroups = new Map();

  for (const profile of profiles) {
    const groupKey = profile.languageCode || profile.languageName;

    if (!profileGroups.has(groupKey)) {
      profileGroups.set(groupKey, {
        languageName: profile.languageName,
        languageCode: profile.languageCode,
        profileCount: 0,
        profiles: [],
      });
    }

    const group = profileGroups.get(groupKey);
    group.profiles.push(profile);
    group.profileCount = group.profiles.length;
  }

  return {
    detected: true,
    cjkCharacterCount,
    languageProfiles: Array.from(profileGroups.values()),
    dataSummary: cjkStandardData.summary,
  };
}

module.exports = {
  CJK_TRIGGER_SCRIPT_NAMES,
  cjkStandardData,
  isCjkCharacter,
  isCjkFont,
  summarizeCjkStandardCoverage,
};
