"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { languageScriptData } = require("../src/language-script-lookup");

const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "language-population-data.js");

const WIKIDATA_LANGUAGE_POPULATION_QUERY = `
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX pr: <http://www.wikidata.org/prop/reference/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT ?item ?itemLabel ?iso6391 ?iso6392 ?iso6393 ?speakers ?rank ?pointInTime ?startTime ?endTime ?appliesToLabel ?determinationMethodLabel ?statedInLabel ?referenceUrl ?retrieved WHERE {
  ?item p:P1098 ?statement.
  ?statement ps:P1098 ?speakers;
    wikibase:rank ?rank.

  OPTIONAL { ?item wdt:P218 ?iso6391. }
  OPTIONAL { ?item wdt:P219 ?iso6392. }
  OPTIONAL { ?item wdt:P220 ?iso6393. }
  FILTER(BOUND(?iso6391) || BOUND(?iso6392) || BOUND(?iso6393))

  OPTIONAL { ?statement pq:P585 ?pointInTime. }
  OPTIONAL { ?statement pq:P580 ?startTime. }
  OPTIONAL { ?statement pq:P582 ?endTime. }
  OPTIONAL { ?statement pq:P518 ?appliesTo. }
  OPTIONAL { ?statement pq:P459 ?determinationMethod. }
  OPTIONAL {
    ?statement prov:wasDerivedFrom ?reference.
    OPTIONAL { ?reference pr:P248 ?statedIn. }
    OPTIONAL { ?reference pr:P854 ?referenceUrl. }
    OPTIONAL { ?reference pr:P813 ?retrieved. }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;

function parseWikidataValue(binding, key) {
  return binding[key] ? binding[key].value : null;
}

function parseQuantity(value) {
  if (!value) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? Math.round(number) : null;
}

function parseYear(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(-?\d{1,6})/);

  return match ? Number(match[1]) : null;
}

function getRankWeight(rank) {
  if (rank && rank.endsWith("#PreferredRank")) {
    return 3;
  }

  if (rank && rank.endsWith("#NormalRank")) {
    return 2;
  }

  return 1;
}

function sanitizeOptionalLabel(value) {
  if (!value || value.startsWith("http://www.wikidata.org/.well-known/genid/")) {
    return null;
  }

  return value;
}

function normalizePopulationType(appliesTo) {
  const normalizedAppliesTo = appliesTo ? appliesTo.toLowerCase() : "";

  if (/(whole|sum|total|all)/.test(normalizedAppliesTo)) {
    return "total";
  }

  if (/first language|native|l1/.test(normalizedAppliesTo)) {
    return "firstLanguage";
  }

  if (/second language|l2/.test(normalizedAppliesTo)) {
    return "secondLanguage";
  }

  return "unspecified";
}

function getPopulationTypeWeight(populationType) {
  return {
    total: 4,
    firstLanguage: 3,
    unspecified: 2,
    secondLanguage: 1,
  }[populationType] || 0;
}

function getIsoCodes(binding) {
  return [parseWikidataValue(binding, "iso6391"), parseWikidataValue(binding, "iso6392"), parseWikidataValue(binding, "iso6393")]
    .flatMap((value) => (value ? value.split(/[,\s;]+/) : []))
    .map((value) => value.trim())
    .filter(Boolean);
}

function getWikidataId(itemUrl) {
  const match = itemUrl ? itemUrl.match(/\/entity\/(Q\d+)$/) : null;

  return match ? match[1] : null;
}

function buildEstimateKey(binding) {
  return [
    parseWikidataValue(binding, "item"),
    parseWikidataValue(binding, "speakers"),
    parseWikidataValue(binding, "rank"),
    parseWikidataValue(binding, "pointInTime"),
    parseWikidataValue(binding, "startTime"),
    parseWikidataValue(binding, "endTime"),
    parseWikidataValue(binding, "appliesToLabel"),
    parseWikidataValue(binding, "determinationMethodLabel"),
  ].join("|");
}

function addReference(estimate, binding) {
  const reference = {
    statedIn: parseWikidataValue(binding, "statedInLabel"),
    url: parseWikidataValue(binding, "referenceUrl"),
    retrieved: parseWikidataValue(binding, "retrieved"),
  };

  if (!reference.statedIn && !reference.url && !reference.retrieved) {
    return;
  }

  const referenceKey = JSON.stringify(reference);

  if (!estimate.referenceKeys.has(referenceKey)) {
    estimate.referenceKeys.add(referenceKey);
    estimate.references.push(reference);
  }
}

function normalizeEstimate(binding) {
  const itemUrl = parseWikidataValue(binding, "item");
  const pointInTime = parseWikidataValue(binding, "pointInTime");
  const startTime = parseWikidataValue(binding, "startTime");
  const endTime = parseWikidataValue(binding, "endTime");
  const estimateYear = parseYear(pointInTime) || parseYear(endTime) || parseYear(startTime);
  const appliesTo = sanitizeOptionalLabel(parseWikidataValue(binding, "appliesToLabel"));

  return {
    languageName: parseWikidataValue(binding, "itemLabel"),
    wikidataId: getWikidataId(itemUrl),
    wikidataUrl: itemUrl,
    isoCodes: getIsoCodes(binding),
    population: parseQuantity(parseWikidataValue(binding, "speakers")),
    estimateYear,
    pointInTime,
    startTime,
    endTime,
    appliesTo,
    populationType: normalizePopulationType(appliesTo),
    determinationMethod: sanitizeOptionalLabel(parseWikidataValue(binding, "determinationMethodLabel")),
    rank: parseWikidataValue(binding, "rank"),
    references: [],
    referenceKeys: new Set(),
    source: "Wikidata P1098",
  };
}

function parseWikidataResults(results) {
  const estimatesByKey = new Map();

  for (const binding of results.results.bindings) {
    const key = buildEstimateKey(binding);

    if (!estimatesByKey.has(key)) {
      estimatesByKey.set(key, normalizeEstimate(binding));
    }

    addReference(estimatesByKey.get(key), binding);
  }

  return Array.from(estimatesByKey.values())
    .filter((estimate) => estimate.population !== null && estimate.isoCodes.length > 0)
    .map((estimate) => {
      delete estimate.referenceKeys;
      return estimate;
    });
}

function scoreEstimate(estimate) {
  return [
    getPopulationTypeWeight(estimate.populationType),
    getRankWeight(estimate.rank),
    estimate.estimateYear || -Infinity,
    estimate.references.length > 0 ? 1 : 0,
    estimate.population,
  ];
}

function compareEstimate(left, right) {
  const leftScore = scoreEstimate(left);
  const rightScore = scoreEstimate(right);

  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) {
      return rightScore[index] - leftScore[index];
    }
  }

  return (left.languageName || "").localeCompare(right.languageName || "");
}

function attachPopulationsToLanguages(estimates) {
  const languageCodes = new Set(languageScriptData.languages.map((language) => language.code));
  const estimatesByLanguageCode = new Map();

  for (const estimate of estimates) {
    for (const code of estimate.isoCodes) {
      if (!languageCodes.has(code)) {
        continue;
      }

      if (!estimatesByLanguageCode.has(code)) {
        estimatesByLanguageCode.set(code, []);
      }

      estimatesByLanguageCode.get(code).push(estimate);
    }
  }

  const languagePopulations = [];

  for (const language of languageScriptData.languages) {
    const languageEstimates = estimatesByLanguageCode.get(language.code) || [];

    if (languageEstimates.length === 0) {
      continue;
    }

    const sortedEstimates = [...languageEstimates].sort(compareEstimate);
    const selectedEstimate = sortedEstimates[0];

    languagePopulations.push({
      languageCode: language.code,
      languageName: language.name,
      population: selectedEstimate.population,
      populationType: selectedEstimate.populationType,
      estimateYear: selectedEstimate.estimateYear,
      appliesTo: selectedEstimate.appliesTo,
      determinationMethod: selectedEstimate.determinationMethod,
      wikidataId: selectedEstimate.wikidataId,
      wikidataUrl: selectedEstimate.wikidataUrl,
      source: selectedEstimate.source,
      references: selectedEstimate.references,
      estimates: sortedEstimates.map((estimate) => ({
        population: estimate.population,
        populationType: estimate.populationType,
        estimateYear: estimate.estimateYear,
        appliesTo: estimate.appliesTo,
        determinationMethod: estimate.determinationMethod,
        rank: estimate.rank,
        references: estimate.references,
      })),
    });
  }

  return languagePopulations.sort((left, right) => left.languageCode.localeCompare(right.languageCode));
}

function findUnmappedLanguageCodes(languagePopulations) {
  const mappedLanguageCodes = new Set(languagePopulations.map((entry) => entry.languageCode));

  return languageScriptData.languages
    .filter((language) => !mappedLanguageCodes.has(language.code))
    .map((language) => language.code)
    .sort((left, right) => left.localeCompare(right));
}

async function fetchWikidataLanguagePopulationResults() {
  const url = new URL(WIKIDATA_SPARQL_URL);
  url.searchParams.set("query", WIKIDATA_LANGUAGE_POPULATION_QUERY);
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": "LanguageCheck/1.0 (local font coverage tool)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to query Wikidata: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const results = await fetchWikidataLanguagePopulationResults();
  const wikidataEstimates = parseWikidataResults(results);
  const languagePopulations = attachPopulationsToLanguages(wikidataEstimates);
  const unmappedLanguageCodes = findUnmappedLanguageCodes(languagePopulations);

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      population: {
        name: "Wikidata number of speakers, writers, or signers (P1098)",
        url: "https://www.wikidata.org/wiki/Property:P1098",
        queryEndpoint: WIKIDATA_SPARQL_URL,
      },
      languages: languageScriptData.sources.languages,
    },
    summary: {
      languages: languageScriptData.languages.length,
      languagesWithPopulation: languagePopulations.length,
      unmappedLanguages: unmappedLanguageCodes.length,
      wikidataEstimates: wikidataEstimates.length,
    },
    languagePopulations,
    unmappedLanguageCodes,
  };

  const output = `"use strict";\n\nmodule.exports = ${JSON.stringify(payload, null, 2)};\n`;
  fs.writeFileSync(OUTPUT_PATH, output, "utf8");
  console.log(
    `Generated ${payload.summary.languagesWithPopulation} language population mappings from ${payload.summary.wikidataEstimates} Wikidata estimates at ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
