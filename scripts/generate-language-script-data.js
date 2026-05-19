"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IANA_LANGUAGE_REGISTRY_URL = "https://www.iana.org/assignments/language-subtag-registry";
const ISO_15924_CODES_URL = "https://unicode.org/iso15924/iso15924-codes.html";
const CLDR_SUPPLEMENTAL_DATA_URL =
  "https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/supplementalData.xml";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "language-script-data.js");

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

function parseAttributes(value) {
  const attributes = {};

  for (const match of value.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeHtmlEntities(match[2]);
  }

  return attributes;
}

function unfoldRegistryLines(text) {
  const output = [];

  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && output.length > 0) {
      output[output.length - 1] += ` ${line.trim()}`;
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

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

function parseIanaRegistry(text) {
  const records = unfoldRegistryLines(text)
    .split("\n%%")
    .map((recordText) => {
      const record = {};

      for (const line of recordText.trim().split("\n")) {
        const match = line.match(/^([^:]+):\s*(.*)$/);

        if (!match) {
          continue;
        }

        addRecordValue(record, match[1], match[2]);
      }

      return record;
    });

  const metadataRecord = records.find((record) => record["File-Date"]);
  const languages = records
    .filter((record) => record.Type === "language" && record.Subtag)
    .map((record) => ({
      code: record.Subtag,
      name: asArray(record.Description)[0] || record.Subtag,
      descriptions: asArray(record.Description),
      scope: record.Scope || null,
      added: record.Added || null,
      deprecated: record.Deprecated || null,
      preferredValue: record["Preferred-Value"] || null,
      suppressScript: record["Suppress-Script"] || null,
      macrolanguage: record.Macrolanguage || null,
      comments: asArray(record.Comments),
      source: "IANA",
    }))
    .sort((left, right) => left.code.localeCompare(right.code));

  return {
    fileDate: metadataRecord ? metadataRecord["File-Date"] : null,
    languages,
  };
}

function parseIso15924Scripts(html) {
  return Array.from(html.matchAll(/<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td[^>]*>([\s\S]*?)<\/td><\/tr>/g))
    .map((match) => ({
      code: stripTags(match[1]),
      numericCode: stripTags(match[2]),
      name: stripTags(match[3]),
      frenchName: stripTags(match[4]),
      alias: stripTags(match[5]) || null,
      age: stripTags(match[6]) || null,
      date: stripTags(match[7]) || null,
      source: "ISO 15924",
    }))
    .filter((script) => /^[A-Z][a-z]{3}$/.test(script.code))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function parseCldrLanguageScripts(xmlText) {
  const sectionMatch = xmlText.match(/<languageData>([\s\S]*?)<\/languageData>/);

  if (!sectionMatch) {
    throw new Error("Could not find CLDR <languageData> section.");
  }

  const relations = [];

  for (const match of sectionMatch[1].matchAll(/<language\s+([^>]*)\/>/g)) {
    const attributes = parseAttributes(match[1]);

    if (!attributes.type || !attributes.scripts) {
      continue;
    }

    for (const scriptCode of attributes.scripts.split(/\s+/).filter(Boolean)) {
      relations.push({
        languageCode: attributes.type,
        scriptCode,
        usage: attributes.alt === "secondary" ? "secondary" : "primary",
        alt: attributes.alt || null,
        territories: attributes.territories ? attributes.territories.split(/\s+/) : [],
        source: "CLDR languageData",
      });
    }
  }

  return relations.sort((left, right) => {
    const languageDelta = left.languageCode.localeCompare(right.languageCode);

    if (languageDelta !== 0) {
      return languageDelta;
    }

    return left.scriptCode.localeCompare(right.scriptCode);
  });
}

function attachNames(relations, languages, scripts) {
  const languageByCode = new Map(languages.map((language) => [language.code, language]));
  const scriptByCode = new Map(scripts.map((script) => [script.code, script]));

  return relations.map((relation) => {
    const language = languageByCode.get(relation.languageCode);
    const script = scriptByCode.get(relation.scriptCode);

    return {
      ...relation,
      languageName: language ? language.name : null,
      scriptName: script ? script.name : null,
    };
  });
}

function findUnmappedLanguages(languages, languageScripts) {
  const mappedLanguageCodes = new Set(languageScripts.map((relation) => relation.languageCode));

  return languages
    .filter((language) => !mappedLanguageCodes.has(language.code))
    .map((language) => language.code)
    .sort((left, right) => left.localeCompare(right));
}

function summarize(languageScripts) {
  const primaryRelations = languageScripts.filter((relation) => relation.usage === "primary");
  const secondaryRelations = languageScripts.filter((relation) => relation.usage === "secondary");
  const languagesWithPrimary = new Set(primaryRelations.map((relation) => relation.languageCode));
  const scriptsWithRelations = new Set(languageScripts.map((relation) => relation.scriptCode));

  return {
    languageScriptRelations: languageScripts.length,
    primaryRelations: primaryRelations.length,
    secondaryRelations: secondaryRelations.length,
    languagesWithPrimaryScript: languagesWithPrimary.size,
    scriptsWithLanguageRelations: scriptsWithRelations.size,
  };
}

async function downloadText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const [ianaRegistryText, iso15924Html, cldrSupplementalXml] = await Promise.all([
    downloadText(IANA_LANGUAGE_REGISTRY_URL),
    downloadText(ISO_15924_CODES_URL),
    downloadText(CLDR_SUPPLEMENTAL_DATA_URL),
  ]);

  const iana = parseIanaRegistry(ianaRegistryText);
  const scripts = parseIso15924Scripts(iso15924Html);
  const languageScripts = attachNames(parseCldrLanguageScripts(cldrSupplementalXml), iana.languages, scripts);
  const unmappedLanguageCodes = findUnmappedLanguages(iana.languages, languageScripts);

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      languages: {
        name: "IANA Language Subtag Registry",
        url: IANA_LANGUAGE_REGISTRY_URL,
        fileDate: iana.fileDate,
      },
      scripts: {
        name: "ISO 15924 code list",
        url: ISO_15924_CODES_URL,
      },
      languageScripts: {
        name: "Unicode CLDR supplementalData.xml languageData",
        url: CLDR_SUPPLEMENTAL_DATA_URL,
      },
    },
    summary: {
      languages: iana.languages.length,
      scripts: scripts.length,
      unmappedLanguages: unmappedLanguageCodes.length,
      ...summarize(languageScripts),
    },
    languages: iana.languages,
    scripts,
    languageScripts,
    unmappedLanguageCodes,
  };

  const output = `"use strict";\n\nmodule.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(
    `Generated ${payload.summary.languages} languages, ${payload.summary.scripts} scripts, and ${payload.summary.languageScriptRelations} language-script relations at ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
