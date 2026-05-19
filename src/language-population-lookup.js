"use strict";

const languagePopulationData = require("./language-population-data");
const { languageScriptData } = require("./language-script-lookup");

const populationByLanguageCode = new Map(
  languagePopulationData.languagePopulations.map((population) => [population.languageCode, population])
);
const languageByCode = new Map(languageScriptData.languages.map((language) => [language.code, language]));
const topLanguagesByPopulation = [...languagePopulationData.languagePopulations]
  .filter((language) => {
    const languageMetadata = languageByCode.get(language.languageCode);

    return !languageMetadata || !["collection", "private-use", "special"].includes(languageMetadata.scope);
  })
  .sort((left, right) => {
    if (right.population !== left.population) {
      return right.population - left.population;
    }

    return left.languageName.localeCompare(right.languageName);
  })
  .map((language, index) => ({
    ...language,
    populationRank: index + 1,
  }));
const populationRankByLanguageCode = new Map(
  topLanguagesByPopulation.map((language) => [language.languageCode, language.populationRank])
);
const top200LanguageCodes = new Set(topLanguagesByPopulation.slice(0, 200).map((language) => language.languageCode));

function getPopulationForLanguage(languageCode) {
  return populationByLanguageCode.get(languageCode) || null;
}

function getPopulationRankForLanguage(languageCode) {
  return populationRankByLanguageCode.get(languageCode) || null;
}

function isTop200Language(languageCode) {
  return top200LanguageCodes.has(languageCode);
}

function formatPopulation(population) {
  if (population === null || population === undefined) {
    return null;
  }

  if (population >= 1_000_000_000) {
    return `${(population / 1_000_000_000).toFixed(population >= 10_000_000_000 ? 0 : 1)}B`;
  }

  if (population >= 1_000_000) {
    return `${(population / 1_000_000).toFixed(population >= 100_000_000 ? 0 : 1)}M`;
  }

  if (population >= 1_000) {
    return `${(population / 1_000).toFixed(population >= 100_000 ? 0 : 1)}K`;
  }

  return population.toLocaleString("en-US");
}

module.exports = {
  formatPopulation,
  getPopulationForLanguage,
  getPopulationRankForLanguage,
  isTop200Language,
  languagePopulationData,
  topLanguagesByPopulation,
};
