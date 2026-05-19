"use strict";

const fs = require("node:fs");
const path = require("node:path");
const languageScriptData = require("../src/language-script-data");
const googleLanguageData = require("../src/google-language-data");

const CLDR_ZH_LOCALE_URL = "https://raw.githubusercontent.com/unicode-org/cldr/main/common/main/zh.xml";
const CLDR_SUPPLEMENTAL_METADATA_URL =
  "https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/supplementalMetadata.xml";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "language-translation-data.js");
const ARABIC_VARIANT_PREFIX_TRANSLATIONS = {
  Algerian: "阿尔及利亚",
  Baharna: "巴林",
  Chadian: "乍得",
  Cypriot: "塞浦路斯",
  Dhofari: "佐法尔",
  Egyptian: "埃及",
  Gulf: "海湾",
  Hadrami: "哈德拉毛",
  Hijazi: "汉志",
  Judeo: "犹太",
  Levantine: "黎凡特",
  Libyan: "利比亚",
  Mesopotamian: "美索不达米亚",
  Moroccan: "摩洛哥",
  Najdi: "内志",
  Omani: "阿曼",
  Saidi: "赛义迪",
  Sanaani: "萨那",
  Standard: "标准",
  Sudanese: "苏丹",
  Tajiki: "塔吉克",
  Tunisian: "突尼斯",
  Uzbeki: "乌兹别克",
};
const MODIFIER_TRANSLATIONS = {
  North: "北部",
  Northern: "北部",
  Northeast: "东北部",
  Northeastern: "东北部",
  Northwest: "西北部",
  Northwestern: "西北部",
  South: "南部",
  Southern: "南部",
  Southeast: "东南部",
  Southeastern: "东南部",
  Southwest: "西南部",
  Southwestern: "西南部",
  East: "东部",
  Eastern: "东部",
  West: "西部",
  Western: "西部",
  Central: "中部",
  Highland: "高地",
  Lowland: "低地",
  Upper: "上",
  Lower: "下",
  Old: "古",
  Ancient: "古代",
  Classical: "古典",
  Modern: "现代",
  Standard: "标准",
  Middle: "中古",
  Literary: "文言",
  Saint: "圣",
  Lucian: "卢西亚",
  Min: "闽",
  Dong: "东",
  Ping: "平",
  Assyrian: "亚述",
  Neo: "新",
  American: "美国",
  Argentine: "阿根廷",
  Armenian: "亚美尼亚",
  Afghan: "阿富汗",
  Algerian: "阿尔及利亚",
  Australian: "澳大利亚",
  Austrian: "奥地利",
  Belgian: "比利时",
  Brazilian: "巴西",
  British: "英国",
  Canadian: "加拿大",
  Chinese: "中国",
  Danish: "丹麦",
  Dutch: "荷兰",
  Finnish: "芬兰",
  French: "法国",
  German: "德国",
  Greek: "希腊",
  Indian: "印度",
  Indonesian: "印度尼西亚",
  Irish: "爱尔兰",
  Israeli: "以色列",
  Italian: "意大利",
  Japanese: "日本",
  Korean: "韩国",
  Mexican: "墨西哥",
  Norwegian: "挪威",
  Polish: "波兰",
  Portuguese: "葡萄牙",
  Russian: "俄罗斯",
  Spanish: "西班牙",
  Swedish: "瑞典",
  Swiss: "瑞士",
  Thai: "泰国",
  Turkish: "土耳其",
  Ukrainian: "乌克兰",
  Vietnamese: "越南",
  Bolivian: "玻利维亚",
  Chilean: "智利",
  Peruvian: "秘鲁",
  Ecuadorian: "厄瓜多尔",
  Colombian: "哥伦比亚",
  Venezuelan: "委内瑞拉",
  Nepal: "尼泊尔",
  Nepalese: "尼泊尔",
  India: "印度",
  Pakistan: "巴基斯坦",
  Bangladesh: "孟加拉",
  Nigeria: "尼日利亚",
  Cameroon: "喀麦隆",
  Congo: "刚果",
  Guinea: "几内亚",
  Papua: "巴布亚",
  New: "新",
  Republic: "共和国",
  Hong: "香港",
  Kong: "",
};
const BASE_LANGUAGE_TRANSLATIONS = {
  Arabic: "阿拉伯语",
  Aramaic: "阿拉姆语",
  Berber: "柏柏尔语",
  Cham: "占语",
  Chinese: "汉语",
  Chin: "钦语",
  Chinantec: "奇南特克语",
  Creole: "克里奥尔语",
  Dogon: "多贡语",
  Dutch: "荷兰语",
  English: "英语",
  French: "法语",
  Fulfulde: "富拉语",
  Gbe: "格贝语",
  Gondi: "贡德语",
  Hmong: "苗语",
  Karen: "克伦语",
  Kurdish: "库尔德语",
  Malay: "马来语",
  Manobo: "马诺博语",
  Mixtec: "米斯特克语",
  Naga: "纳加语",
  Nahuatl: "纳瓦特尔语",
  Quechua: "克丘亚语",
  Romani: "罗姆语",
  Talysh: "塔里什语",
  Tamang: "塔芒语",
  Tatar: "鞑靼语",
  Thai: "泰语",
  Tibetan: "藏语",
  Totonac: "托托纳克语",
  Tulu: "图卢语",
  Zapotec: "萨波特克语",
  Zhuang: "壮语",
};
const SCRIPT_SUFFIX_PATTERN =
  /,\s*(Adlam|Arabic|Bangla|Brahmi|Cyrillic|Devanagari|Ethiopic|Greek|Gujarati|Gurmukhi|Hebrew|Kannada|Latin|Malayalam|Myanmar|Odia|Ol Chiki|Sinhala|Syriac|Tamil|Telugu|Thai|Tibetan|Tifinagh)$/;
const EXACT_RULE_TRANSLATIONS = {
  "Assyrian Neo-Aramaic": "亚述新阿拉姆语",
  "Chinese Pidgin English": "中国洋泾浜英语",
  "Jin Chinese": "晋语",
  "Literary Chinese": "文言文",
  "Min Dong Chinese": "闽东语",
  "Northern Ping Chinese": "北部平话",
  "Saint Lucian Creole French": "圣卢西亚克里奥尔法语",
  "Southern Ping Chinese": "南部平话",
  "Tunisian Darija": "突尼斯达里贾语",
};

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal) => String.fromCodePoint(Number(decimal)));
}

function parseDisplayNames(xmlText, sectionName, itemName) {
  const sectionMatch = xmlText.match(new RegExp(`<${sectionName}>([\\s\\S]*?)<\\/${sectionName}>`));

  if (!sectionMatch) {
    throw new Error(`Could not find CLDR <${sectionName}> section.`);
  }

  const names = {};
  const itemPattern = new RegExp(`<${itemName}\\s+type="([^"]+)"(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${itemName}>`, "g");

  for (const match of sectionMatch[1].matchAll(itemPattern)) {
    names[match[1]] = decodeXmlEntities(match[2].replace(/<[^>]+>/g, "").trim());
  }

  return names;
}

function parseLanguageAliases(xmlText) {
  const aliases = {};

  for (const match of xmlText.matchAll(/<languageAlias\s+([^>]*)\/>/g)) {
    const attributes = {};

    for (const attributeMatch of match[1].matchAll(/([:\w-]+)="([^"]*)"/g)) {
      attributes[attributeMatch[1]] = attributeMatch[2];
    }

    if (attributes.type && attributes.replacement) {
      aliases[attributes.type] = attributes.replacement.split(/\s+/)[0];
    }
  }

  return aliases;
}

function getLanguageDisplayName(languageCode, languageNames, languageAliases) {
  const aliasCode = languageAliases[languageCode];

  return languageNames[languageCode] || (aliasCode ? languageNames[aliasCode] : null);
}

function translateArabicVariant(englishName) {
  const normalizedName = englishName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const match = normalizedName.match(/^(.+?)\s+Arabic$/);

  if (!match) {
    return null;
  }

  const translatedPrefix = match[1]
    .split(/[-\s]+/)
    .map((word) => ARABIC_VARIANT_PREFIX_TRANSLATIONS[word] || null)
    .filter(Boolean)
    .join("");

  return translatedPrefix ? `${translatedPrefix}阿拉伯语` : null;
}

function translateModifierPhrase(value) {
  return value
    .replace(/\bSt\.\b/g, "Saint")
    .split(/([\s-]+)/)
    .map((part) => {
      if (/^[\s-]+$/.test(part)) {
        return "";
      }

      return MODIFIER_TRANSLATIONS[part] ?? part;
    })
    .join("")
    .replace(/\s+/g, "")
    .trim();
}

function translateBaseLanguagePattern(englishName) {
  const normalizedName = englishName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const scriptStrippedName = normalizedName.replace(SCRIPT_SUFFIX_PATTERN, "");
  const reversedMatch = scriptStrippedName.match(/^([A-Z][A-Za-z-]+),\s*(.+)$/);

  if (reversedMatch && BASE_LANGUAGE_TRANSLATIONS[reversedMatch[1]]) {
    return `${translateModifierPhrase(reversedMatch[2])}${BASE_LANGUAGE_TRANSLATIONS[reversedMatch[1]]}`;
  }

  for (const [baseEnglishName, baseChineseName] of Object.entries(BASE_LANGUAGE_TRANSLATIONS)) {
    if (scriptStrippedName === baseEnglishName) {
      return baseChineseName;
    }

    if (scriptStrippedName.endsWith(` ${baseEnglishName}`)) {
      const modifier = scriptStrippedName.slice(0, -baseEnglishName.length).trim();

      return `${translateModifierPhrase(modifier)}${baseChineseName}`;
    }
  }

  return null;
}

function translateSignLanguage(englishName) {
  const match = englishName.match(/^(.+?)\s+Sign Language$/);

  return match ? `${translateModifierPhrase(match[1])}手语` : null;
}

function translateCreole(englishName) {
  const normalizedName = englishName.replace(SCRIPT_SUFFIX_PATTERN, "");
  const basedMatch = normalizedName.match(/^(.+?)-based Creoles$/);

  if (basedMatch) {
    const base = BASE_LANGUAGE_TRANSLATIONS[basedMatch[1]] || `${translateModifierPhrase(basedMatch[1])}语`;
    return `${base}克里奥尔语`;
  }

  const match = normalizedName.match(/^(.+?)\s+Creole\s+(English|French|Dutch|Portuguese|Arabic|Malay)$/);

  if (!match) {
    return null;
  }

  const base = BASE_LANGUAGE_TRANSLATIONS[match[2]] || `${translateModifierPhrase(match[2])}语`;

  return `${translateModifierPhrase(match[1])}克里奥尔${base}`;
}

function getRuleBasedTranslation(englishName) {
  const normalizedName = englishName.replace(SCRIPT_SUFFIX_PATTERN, "");

  return (
    EXACT_RULE_TRANSLATIONS[normalizedName] ||
    translateArabicVariant(englishName) ||
    translateSignLanguage(englishName) ||
    translateCreole(englishName) ||
    translateBaseLanguagePattern(englishName)
  );
}

function getGoogleTranslation(language, languageNames, scriptNames, languageAliases, baseLanguageCounts) {
  const baseName =
    getLanguageDisplayName(language.languageCode, languageNames, languageAliases) ||
    getRuleBasedTranslation(language.name || "") ||
    getLanguageDisplayName(language.id, languageNames, languageAliases) ||
    language.preferredName ||
    language.name ||
    language.id;
  const shouldIncludeScript =
    baseLanguageCounts.get(language.languageCode) > 1 &&
    language.scriptCode !== "Latn" &&
    (/[(),]/.test(language.name || "") || ["Hans", "Hant"].includes(language.scriptCode));
  const scriptName = shouldIncludeScript ? scriptNames[language.scriptCode] : null;

  return scriptName ? `${baseName}（${scriptName}）` : baseName;
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

async function main() {
  const [cldrZhXml, cldrSupplementalMetadataXml] = await Promise.all([
    downloadText(CLDR_ZH_LOCALE_URL),
    downloadText(CLDR_SUPPLEMENTAL_METADATA_URL),
  ]);
  const languageNames = parseDisplayNames(cldrZhXml, "languages", "language");
  const scriptNames = parseDisplayNames(cldrZhXml, "scripts", "script");
  const languageAliases = parseLanguageAliases(cldrSupplementalMetadataXml);
  const googleBaseLanguageCounts = googleLanguageData.languages.reduce((counts, language) => {
    counts.set(language.languageCode, (counts.get(language.languageCode) || 0) + 1);
    return counts;
  }, new Map());
  const wikiUnicode = Object.fromEntries(
    languageScriptData.languages.map((language) => {
      const cldrName = getLanguageDisplayName(language.code, languageNames, languageAliases);
      const ruleBasedName = getRuleBasedTranslation(language.name);

      return [
        language.code,
        {
          code: language.code,
          englishName: language.name,
          chineseName: cldrName || ruleBasedName || language.name,
          source: cldrName
            ? "CLDR zh language display names"
            : ruleBasedName
              ? "LanguageCheck rule-based translation"
              : "fallback English name",
        },
      ];
    })
  );
  const google = Object.fromEntries(
    googleLanguageData.languages.map((language) => {
      const cldrName = getLanguageDisplayName(language.languageCode, languageNames, languageAliases);
      const ruleBasedName = getRuleBasedTranslation(language.name);

      return [
        language.id,
        {
          code: language.id,
          baseLanguageCode: language.languageCode,
          scriptCode: language.scriptCode,
          englishName: language.name,
          chineseName: getGoogleTranslation(language, languageNames, scriptNames, languageAliases, googleBaseLanguageCounts),
          source: cldrName
            ? "CLDR zh language display names"
            : ruleBasedName
              ? "LanguageCheck rule-based translation"
              : "fallback Google language name",
        },
      ];
    })
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      cldrZhLocale: {
        name: "Unicode CLDR zh locale display names",
        url: CLDR_ZH_LOCALE_URL,
      },
      cldrSupplementalMetadata: {
        name: "Unicode CLDR language aliases",
        url: CLDR_SUPPLEMENTAL_METADATA_URL,
      },
      wikiUnicode: "LanguageCheck Wiki+Unicode language codes",
      google: "LanguageCheck googlefonts/lang language entries",
    },
    summary: {
      wikiUnicodeLanguages: Object.keys(wikiUnicode).length,
      wikiUnicodeTranslated: Object.values(wikiUnicode).filter((entry) => entry.source.startsWith("CLDR")).length,
      googleLanguages: Object.keys(google).length,
      googleTranslated: Object.values(google).filter((entry) => entry.source.startsWith("CLDR")).length,
      cldrLanguageNames: Object.keys(languageNames).length,
      cldrLanguageAliases: Object.keys(languageAliases).length,
      cldrScriptNames: Object.keys(scriptNames).length,
    },
    wikiUnicode,
    google,
  };
  const output = `"use strict";\n\nmodule.exports = ${JSON.stringify(payload, null, 2)};\n`;

  fs.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(
    `Generated language translations: ${payload.summary.wikiUnicodeTranslated}/${payload.summary.wikiUnicodeLanguages} Wiki+Unicode and ${payload.summary.googleTranslated}/${payload.summary.googleLanguages} Google entries at ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
