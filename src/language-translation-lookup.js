"use strict";

const languageTranslationData = require("./language-translation-data");

function getLanguageChineseName(sourceKey, languageCode) {
  const sourceTranslations = languageTranslationData[sourceKey] || {};
  const translation = sourceTranslations[languageCode];

  return translation ? translation.chineseName : null;
}

function getLanguageTranslation(sourceKey, languageCode) {
  const sourceTranslations = languageTranslationData[sourceKey] || {};

  return sourceTranslations[languageCode] || null;
}

module.exports = {
  getLanguageChineseName,
  getLanguageTranslation,
  languageTranslationData,
};
