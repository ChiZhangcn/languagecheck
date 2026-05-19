"use strict";

const PAGE_SIZE = 200;
const CORE_SCRIPT_SUPPORT_THRESHOLD = 50;
const SCRIPT_COLUMN_WIDTH_KEY = "font-reader-script-column-width";
const DEFAULT_SCRIPT_COLUMN_WIDTH = 58;
const MIN_SCRIPT_COLUMN_WIDTH = 25;
const MAX_SCRIPT_COLUMN_WIDTH = 75;
const DEFAULT_LANGUAGE_DATA_SOURCE = "wikiUnicode";

const state = {
  result: null,
  query: "",
  page: 1,
  onlyTopLanguages: false,
  languageDataSource: DEFAULT_LANGUAGE_DATA_SOURCE,
  expandedCompletenessScripts: new Set(),
  expandedCjkLanguages: new Set(),
  scriptColumnWidth: DEFAULT_SCRIPT_COLUMN_WIDTH,
};

const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#font-file");
const selectedFile = document.querySelector("#selected-file");
const statusMessage = document.querySelector("#status-message");
const submitButton = document.querySelector("#submit-button");
const downloadButton = document.querySelector("#download-button");
const searchInput = document.querySelector("#search-input");
const summaryCards = document.querySelector("#summary-cards");
const scriptCoverageCount = document.querySelector("#script-coverage-count");
const scriptCoverageShell = document.querySelector(".script-coverage-shell");
const scriptCoverageTable = document.querySelector(".script-coverage-table");
const scriptCoverageBody = document.querySelector("#script-coverage-body");
const scriptThresholdNotices = document.querySelector("#script-threshold-notices");
const scriptColumnResizer = document.querySelector("#script-column-resizer");
const languageDataSourceSelect = document.querySelector("#language-data-source");
const topLanguageToggle = document.querySelector("#top-language-toggle");
const exportLanguagesEnButton = document.querySelector("#export-languages-en");
const exportLanguagesZhButton = document.querySelector("#export-languages-zh");
const cjkStandardCount = document.querySelector("#cjk-standard-count");
const cjkStandardList = document.querySelector("#cjk-standard-list");
const completenessCount = document.querySelector("#completeness-count");
const completenessList = document.querySelector("#completeness-list");
const resultsBody = document.querySelector("#results-body");
const resultCount = document.querySelector("#result-count");
const pagination = document.querySelector("#pagination");
const pageLabel = document.querySelector("#page-label");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const languageTooltip = document.createElement("div");
const missingDownloadRegistry = new Map();

const POPULATION_TYPE_LABELS = {
  total: "total",
  firstLanguage: "L1",
  secondLanguage: "L2",
  unspecified: "est.",
};

function updateStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? "#9e4224" : "";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readStoredScriptColumnWidth() {
  const rawStoredValue = window.localStorage.getItem(SCRIPT_COLUMN_WIDTH_KEY);

  if (rawStoredValue === null) {
    return DEFAULT_SCRIPT_COLUMN_WIDTH;
  }

  const storedValue = Number(rawStoredValue);

  return Number.isFinite(storedValue)
    ? clamp(storedValue, MIN_SCRIPT_COLUMN_WIDTH, MAX_SCRIPT_COLUMN_WIDTH)
    : DEFAULT_SCRIPT_COLUMN_WIDTH;
}

function setScriptColumnWidth(width, shouldPersist = true) {
  state.scriptColumnWidth = clamp(width, MIN_SCRIPT_COLUMN_WIDTH, MAX_SCRIPT_COLUMN_WIDTH);
  scriptCoverageTable.style.setProperty("--script-column-width", `${state.scriptColumnWidth}%`);
  scriptColumnResizer.setAttribute("aria-valuenow", Math.round(state.scriptColumnWidth));

  if (shouldPersist) {
    window.localStorage.setItem(SCRIPT_COLUMN_WIDTH_KEY, String(state.scriptColumnWidth));
  }
}

function setScriptColumnWidthFromPointer(clientX, shouldPersist = true) {
  const shellRect = scriptCoverageShell.getBoundingClientRect();
  const rawWidth = ((clientX - shellRect.left + scriptCoverageShell.scrollLeft) / shellRect.width) * 100;

  setScriptColumnWidth(rawWidth, shouldPersist);
}

languageTooltip.className = "language-tooltip";
languageTooltip.hidden = true;
document.body.appendChild(languageTooltip);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDisplayCharacter(character, decimalCodePoint) {
  const isControl =
    decimalCodePoint <= 31 ||
    decimalCodePoint === 127 ||
    (decimalCodePoint >= 128 && decimalCodePoint <= 159);

  if (isControl) {
    return { label: `CTRL ${decimalCodePoint}`, isControl: true };
  }

  if (!character || character.trim() === "") {
    return { label: "SPACE", isControl: true };
  }

  return { label: character, isControl: false };
}

function formatCodePoint(codePoint) {
  const width = codePoint > 0xffff ? 6 : 4;

  return `U+${codePoint.toString(16).toUpperCase().padStart(width, "0")}`;
}

function makeSafeFileName(value) {
  return String(value || "font")
    .replace(/\.(ttf|otf)$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "font";
}

function getSupportedCodePointSet() {
  const characters = state.result ? state.result.characters || [] : [];

  return new Set(characters.map((entry) => entry.decimalCodePoint));
}

function normalizeCodePointRange(range) {
  if (Array.isArray(range)) {
    return { start: Number(range[0]), end: Number(range[1]) };
  }

  return { start: Number(range.start), end: Number(range.end) };
}

function getMissingCodePoints(codePointRanges) {
  const supportedCodePoints = getSupportedCodePointSet();
  const missingCodePoints = [];

  for (const rawRange of codePointRanges || []) {
    const { start, end } = normalizeCodePointRange(rawRange);

    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      continue;
    }

    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (!supportedCodePoints.has(codePoint)) {
        missingCodePoints.push(formatCodePoint(codePoint));
      }
    }
  }

  return missingCodePoints;
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getFilteredCharacters() {
  if (!state.result) {
    return [];
  }

  const query = state.query.trim().toLowerCase();

  if (!query) {
    return state.result.characters;
  }

  return state.result.characters.filter((entry) => {
    return [
      entry.character,
      entry.unicode,
      String(entry.decimalCodePoint),
      entry.blockName || "",
      entry.scriptFamilyName || "",
      entry.scriptName || "",
      entry.blockChartName || "",
      entry.glyphName || "",
      String(entry.glyphId ?? ""),
    ].some((value) => value.toLowerCase().includes(query));
  });
}

function getScriptCoreCoverage(script) {
  const coreChildren = (script.completenessChildren || []).filter((child) => child.coveragePolicyKey === "core");
  const supportedCount = coreChildren.reduce((total, child) => total + Number(child.characterCount || 0), 0);
  const totalCount = coreChildren.reduce((total, child) => total + Number(child.unicodeTotalCharacterCount || 0), 0);

  return {
    supportedCount,
    totalCount,
    percent: totalCount > 0 ? Math.min(100, (supportedCount / totalCount) * 100) : 0,
    blockNames: coreChildren.map((child) => child.name),
  };
}

function isScriptAboveSupportThreshold(script) {
  return getScriptCoreCoverage(script).percent > CORE_SCRIPT_SUPPORT_THRESHOLD;
}

function getThresholdExcludedScripts(scripts) {
  return (scripts || []).filter((script) => !isScriptAboveSupportThreshold(script));
}

function getSelectedLanguageDataSource() {
  const sources = state.result ? state.result.languageDataSources || [] : [];

  return (
    sources.find((source) => source.key === state.languageDataSource) ||
    sources.find((source) => source.key === DEFAULT_LANGUAGE_DATA_SOURCE) ||
    {
      key: DEFAULT_LANGUAGE_DATA_SOURCE,
      label: "Wiki+Unicode",
      description: "IANA + ISO 15924 + Unicode CLDR",
    }
  );
}

function getScriptLanguageSource(script) {
  return (
    script.languageSources?.[state.languageDataSource] ||
    script.languageSources?.[DEFAULT_LANGUAGE_DATA_SOURCE] ||
    {
      sourceKey: DEFAULT_LANGUAGE_DATA_SOURCE,
      scriptCode: script.scriptCode,
      isoScriptName: script.isoScriptName,
      scriptFamilyName: null,
      languageCount: script.languageCount || 0,
      languages: script.languages || [],
    }
  );
}

function getScriptCoverageRows() {
  if (!state.result) {
    return {
      supportedScripts: [],
      eligibleScripts: [],
      thresholdExcludedScripts: [],
      filteredScripts: [],
    };
  }

  const supportedScripts = state.result.supportedScripts || [];
  const eligibleScripts = supportedScripts.filter(isScriptAboveSupportThreshold);
  const thresholdExcludedScripts = getThresholdExcludedScripts(supportedScripts);
  const filteredScripts = eligibleScripts
    .map((script) => {
      const selectedLanguageSource = getScriptLanguageSource(script);
      const sourceLanguages = selectedLanguageSource.languages || [];

      return {
        ...script,
        selectedLanguageSource,
        displayedLanguages: state.onlyTopLanguages
          ? sourceLanguages.filter(
              (language) =>
                language.isTop200Language ||
                (typeof language.populationRank === "number" && language.populationRank <= 200)
            )
          : sourceLanguages,
      };
    })
    .filter((script) => !state.onlyTopLanguages || script.displayedLanguages.length > 0);

  return {
    supportedScripts,
    eligibleScripts,
    thresholdExcludedScripts,
    filteredScripts,
  };
}

function getVisibleLanguageExportGroups() {
  return getScriptCoverageRows().filteredScripts.map((script) => {
    const languageByKey = new Map();

    for (const language of script.displayedLanguages || []) {
      const key = language.code || `${language.name}-${script.scriptName}`;

      if (!languageByKey.has(key)) {
        languageByKey.set(key, {
          code: language.code,
          englishName: language.name || language.code,
          chineseName: language.chineseName || language.name || language.code,
        });
      }
    }

    return {
      scriptName: script.scriptName,
      scriptCode: script.selectedLanguageSource?.scriptCode || script.scriptCode || null,
      languages: Array.from(languageByKey.values()).sort((left, right) =>
        (left.englishName || left.code).localeCompare(right.englishName || right.code)
      ),
    };
  }).filter((group) => group.languages.length > 0);
}

function getVisibleLanguageExportCount() {
  return getVisibleLanguageExportGroups().reduce((total, group) => total + group.languages.length, 0);
}

function setLanguageExportButtonsEnabled(enabled) {
  exportLanguagesEnButton.disabled = !enabled;
  exportLanguagesZhButton.disabled = !enabled;
}

function renderLanguageDataSourceOptions() {
  const sources = state.result?.languageDataSources || [
    {
      key: DEFAULT_LANGUAGE_DATA_SOURCE,
      label: "Wiki+Unicode",
    },
    {
      key: "google",
      label: "Google 数据",
    },
  ];

  languageDataSourceSelect.innerHTML = sources
    .map(
      (source) => `
        <option value="${escapeHtml(source.key)}" ${source.key === state.languageDataSource ? "selected" : ""}>
          ${escapeHtml(source.label)}
        </option>
      `
    )
    .join("");
}

function renderThresholdMessage(script) {
  return `当前字体没有达到“${escapeHtml(script.scriptName)}”字库判断阈值，因此暂不显示“${escapeHtml(script.scriptName)}”字符集标准覆盖率。`;
}

function renderScriptThresholdNotices(scripts) {
  if (!scriptThresholdNotices) {
    return;
  }

  const excludedScripts = getThresholdExcludedScripts(scripts);

  if (excludedScripts.length === 0) {
    scriptThresholdNotices.hidden = true;
    scriptThresholdNotices.innerHTML = "";
    return;
  }

  scriptThresholdNotices.hidden = false;
  scriptThresholdNotices.innerHTML = excludedScripts
    .map((script) => {
      const coreCoverage = getScriptCoreCoverage(script);
      const coreBlockLabel =
        coreCoverage.blockNames.length > 0 ? coreCoverage.blockNames.join(", ") : "No core block reference";

      return `
        <div class="threshold-notice">
          ${renderThresholdMessage(script)}
          <span>Core block 覆盖率 ${formatPercent(coreCoverage.percent)}，需要超过 ${CORE_SCRIPT_SUPPORT_THRESHOLD}%。Core block: ${escapeHtml(coreBlockLabel)}。</span>
        </div>
      `;
    })
    .join("");
}

function renderCompletenessThresholdNotice(script) {
  const coreCoverage = getScriptCoreCoverage(script);
  const coreBlockLabel =
    coreCoverage.blockNames.length > 0 ? coreCoverage.blockNames.join(", ") : "No core block reference";

  return `
    <div class="empty-cell threshold-notice">
      ${renderThresholdMessage(script)}
      <span>Core block 覆盖率 ${formatPercent(coreCoverage.percent)}，需要超过 ${CORE_SCRIPT_SUPPORT_THRESHOLD}%。Core block: ${escapeHtml(coreBlockLabel)}。</span>
    </div>
  `;
}

function renderSummary() {
  if (!state.result) {
    summaryCards.innerHTML = `
      <article class="summary-card">
        <span class="summary-label">Font</span>
        <strong>等待解析</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Family</span>
        <strong>等待解析</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Visible</span>
        <strong>0</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Filtered</span>
        <strong>0</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Scripts</span>
        <strong>0</strong>
      </article>
    `;
    return;
  }

  summaryCards.innerHTML = `
    <article class="summary-card">
      <span class="summary-label">Font</span>
      <strong>${escapeHtml(state.result.fullName || state.result.sourceName)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">Family</span>
      <strong>${escapeHtml(state.result.familyName || "Unknown")}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">Visible</span>
      <strong>${state.result.characterCount.toLocaleString("zh-CN")}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">Filtered</span>
      <strong>${state.result.filteredOutCount.toLocaleString("zh-CN")}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">Scripts</span>
      <strong>${(state.result.supportedScriptCount || 0).toLocaleString("zh-CN")}</strong>
    </article>
  `;
}

function renderScriptCoverage() {
  renderLanguageDataSourceOptions();

  if (!state.result) {
    scriptCoverageCount.textContent = "还没有结果";
    setLanguageExportButtonsEnabled(false);
    renderScriptThresholdNotices([]);
    scriptCoverageBody.innerHTML = `
      <tr>
        <td colspan="2" class="empty-cell">上传字体后，这里会列出它覆盖到的 scripts 和语言。</td>
      </tr>
    `;
    return;
  }

  const { supportedScripts, eligibleScripts, thresholdExcludedScripts, filteredScripts } = getScriptCoverageRows();
  const selectedDataSource = getSelectedLanguageDataSource();
  const thresholdLabel =
    thresholdExcludedScripts.length > 0
      ? ` · ${thresholdExcludedScripts.length.toLocaleString("zh-CN")} 个未达阈值`
      : "";
  scriptCoverageCount.textContent = state.onlyTopLanguages
    ? `${selectedDataSource.label} · Top 200 过滤后：${filteredScripts.length.toLocaleString("zh-CN")} / ${eligibleScripts.length.toLocaleString("zh-CN")} 个 scripts${thresholdLabel}`
    : `${selectedDataSource.label} · 共 ${eligibleScripts.length.toLocaleString("zh-CN")} 个 scripts${thresholdLabel}`;
  setLanguageExportButtonsEnabled(getVisibleLanguageExportCount() > 0);
  renderScriptThresholdNotices(supportedScripts);

  if (filteredScripts.length === 0) {
    scriptCoverageBody.innerHTML = `
      <tr>
        <td colspan="2" class="empty-cell">${
          state.onlyTopLanguages
            ? "Top 200 most spoken languages 里没有匹配当前字体 scripts 的语言。"
            : thresholdExcludedScripts.length > 0
              ? "当前字体识别到的 scripts 都没有达到字库判断阈值。"
              : "没有识别到可映射到语言关系的 script。"
        }</td>
      </tr>
    `;
    return;
  }

  scriptCoverageBody.innerHTML = filteredScripts
    .map((script) => {
      const languages = script.displayedLanguages || [];
      const selectedLanguageSource = script.selectedLanguageSource || {};
      const languageList =
        languages.length > 0
          ? languages
              .map((language) => {
                const usageClass = language.usage === "secondary" ? "secondary" : "primary";
                const usageLabel = language.usage === "secondary" ? "secondary" : "primary";
                const populationTypeLabel = POPULATION_TYPE_LABELS[language.populationType] || "est.";
                const regionLabel =
                  language.regionNames && language.regionNames.length > 0
                    ? `Regions: ${language.regionNames.slice(0, 8).join(", ")}${language.regionNames.length > 8 ? " ..." : ""}`
                    : null;
                const populationTooltip = language.spokenPopulationLabel
                  ? [
                      `${language.name || language.code}`,
                      `Spoken population: about ${language.spokenPopulationLabel} users`,
                      language.populationRank ? `Population rank: #${language.populationRank}` : null,
                      `Population type: ${populationTypeLabel}`,
                      language.populationEstimateYear ? `Estimate year: ${language.populationEstimateYear}` : null,
                      regionLabel,
                    ]
                      .filter(Boolean)
                      .join("\n")
                  : [`${language.name || language.code}`, "Spoken population: no open estimate available", regionLabel]
                      .filter(Boolean)
                      .join("\n");

                return `
                  <span class="language-chip ${usageClass}" data-tooltip="${escapeHtml(populationTooltip)}" tabindex="0">
                    ${escapeHtml(language.name || language.code)}
                    <span>${escapeHtml(language.code)} · ${escapeHtml(language.chineseName || "中文名待补充")} · ${usageLabel}${language.populationRank ? ` · #${language.populationRank}` : ""}</span>
                  </span>
                `;
              })
              .join("")
          : `<span class="language-empty">暂时没有 CLDR 语言映射</span>`;

      return `
        <tr>
          <td>
            <div class="script-name">${escapeHtml(script.scriptName)}</div>
            <div class="script-meta">
              ${selectedLanguageSource.scriptCode ? `<span><b>ISO code</b>${escapeHtml(selectedLanguageSource.scriptCode)}</span>` : ""}
              ${selectedLanguageSource.isoScriptName ? `<span><b>标准名称</b>${escapeHtml(selectedLanguageSource.isoScriptName)}</span>` : ""}
              <span><b>字体字符数</b>${script.characterCount.toLocaleString("zh-CN")} chars</span>
            </div>
          </td>
          <td>
            <div class="language-summary">
              ${languages.length.toLocaleString("zh-CN")} languages
              ${
                state.onlyTopLanguages
                  ? `<span>from ${selectedLanguageSource.languageCount.toLocaleString("zh-CN")} mapped languages</span>`
                  : ""
              }
            </div>
            <div class="language-list">${languageList}</div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  if (value >= 99.95) {
    return "100%";
  }

  if (value >= 10) {
    return `${value.toFixed(1)}%`;
  }

  return `${value.toFixed(2)}%`;
}

function renderCompletenessCheck() {
  if (!state.result) {
    completenessCount.textContent = "还没有结果";
    completenessList.innerHTML = `
      <div class="empty-cell">上传字体后，这里会显示每个 script 的 Unicode block 覆盖比例。</div>
    `;
    return;
  }

  const allSupportedScripts = state.result.supportedScripts || [];
  const supportedScripts = allSupportedScripts.filter(isScriptAboveSupportThreshold);
  const thresholdExcludedScripts = getThresholdExcludedScripts(allSupportedScripts);
  completenessCount.textContent = `共 ${supportedScripts.length.toLocaleString("zh-CN")} 个 scripts${
    thresholdExcludedScripts.length > 0
      ? ` · ${thresholdExcludedScripts.length.toLocaleString("zh-CN")} 个未达阈值`
      : ""
  }`;

  if (supportedScripts.length === 0) {
    completenessList.innerHTML = `
      ${
        thresholdExcludedScripts.length > 0
          ? thresholdExcludedScripts.map(renderCompletenessThresholdNotice).join("")
          : `<div class="empty-cell">没有可计算完整性的 script。</div>`
      }
    `;
    return;
  }

  completenessList.innerHTML = supportedScripts
    .map((script, scriptIndex) => {
      const unicodeTotal = script.unicodeTotalCharacterCount;
      const unicodeBlocks = script.unicodeBlocks || [];
      const selectedLanguageSource = getScriptLanguageSource(script);
      const scriptKey = String(scriptIndex);
      const isExpanded = state.expandedCompletenessScripts.has(scriptKey);
      const blockLabel =
        unicodeBlocks.length > 0
          ? `${unicodeBlocks.slice(0, 4).map(escapeHtml).join(", ")}${unicodeBlocks.length > 4 ? " ..." : ""}`
          : "No Unicode block reference";
      const childRows = (script.completenessChildren || [])
        .map((child, childIndex) =>
          renderCompletenessRow({
            name: child.name,
            characterCount: child.characterCount,
            unicodeTotalCharacterCount: child.unicodeTotalCharacterCount,
            unicodeBlockCount: child.unicodeRangeCount,
            codePointRanges: child.codePointRanges,
            completenessPercent: child.completenessPercent,
            coveragePolicyKey: child.coveragePolicyKey,
            coveragePolicyLabel: child.coveragePolicyLabel,
            coveragePolicyDescription: child.coveragePolicyDescription,
            blocksLabel: `${child.unicodeRangeCount.toLocaleString("zh-CN")} range${child.unicodeRangeCount === 1 ? "" : "s"}`,
            isChild: true,
            showBlocksLabel: false,
            downloadKey: `unicode-script-${scriptIndex}-block-${childIndex}`,
            downloadFileName: `${makeSafeFileName(state.result.sourceName)}-${makeSafeFileName(script.scriptName)}-${makeSafeFileName(child.name)}-missing-unicode.txt`,
          })
        )
        .join("");

      return `
        <article class="completeness-group">
          ${renderCompletenessRow({
            name: script.scriptName,
            scriptCode: selectedLanguageSource.scriptCode,
            characterCount: script.characterCount,
            unicodeTotalCharacterCount: unicodeTotal,
            unicodeBlockCount: script.unicodeBlockCount,
            codePointRanges: script.codePointRanges,
            completenessPercent: script.completenessPercent,
            coveragePolicyKey: script.coveragePolicyKey,
            coveragePolicyLabel: script.coveragePolicyLabel,
            coveragePolicyDescription: script.coveragePolicyDescription,
            blocksLabel: blockLabel,
            isChild: false,
            childCount: script.completenessChildren ? script.completenessChildren.length : 0,
            isExpanded,
            toggleKey: scriptKey,
            showBlocksLabel: false,
            downloadKey: `unicode-script-${scriptIndex}`,
            downloadFileName: `${makeSafeFileName(state.result.sourceName)}-${makeSafeFileName(script.scriptName)}-missing-unicode.txt`,
          })}
          <div class="completeness-children" data-completeness-children="${escapeHtml(scriptKey)}" ${isExpanded ? "" : "hidden"}>${childRows}</div>
        </article>
      `;
    })
    .join("") + thresholdExcludedScripts.map(renderCompletenessThresholdNotice).join("");
}

function renderCjkStandardCheck() {
  if (!state.result) {
    cjkStandardCount.textContent = "还没有结果";
    cjkStandardList.innerHTML = `
      <div class="empty-cell">上传 CJK 字体后，这里会显示中日韩相关字符集标准的覆盖比例。</div>
    `;
    return;
  }

  const coverage = state.result.cjkStandardCoverage;

  if (!coverage || !coverage.detected) {
    cjkStandardCount.textContent = coverage
      ? `识别到 ${coverage.cjkCharacterCount.toLocaleString("zh-CN")} 个 CJK 相关字符`
      : "未检测到 CJK";
    cjkStandardList.innerHTML = `
      <div class="empty-cell">当前字体没有达到 CJK 字库判断阈值，因此暂不显示 CJK 字符集标准覆盖率。</div>
    `;
    return;
  }

  const languageProfiles = coverage.languageProfiles || [];
  const profileCount = languageProfiles.reduce((total, language) => total + (language.profiles || []).length, 0);
  cjkStandardCount.textContent = `${coverage.cjkCharacterCount.toLocaleString("zh-CN")} 个 CJK 相关字符 · ${languageProfiles.length} 个语言组 · ${profileCount} 个标准 profile`;

  cjkStandardList.innerHTML = languageProfiles
    .map((language, languageIndex) => {
      const languageKey = `${language.languageCode || language.languageName}-${languageIndex}`;
      const isExpanded = state.expandedCjkLanguages.has(languageKey);
      const profiles = language.profiles || [];
      const bestProfile = profiles.reduce((best, profile) => {
        if (!best || (profile.completenessPercent || 0) > (best.completenessPercent || 0)) {
          return profile;
        }

        return best;
      }, null);
      const childRows = profiles
        .map((profile, profileIndex) =>
          renderCompletenessRow({
            name: profile.name,
            characterCount: profile.supportedCharacterCount,
            unicodeTotalCharacterCount: profile.totalCharacterCount,
            unicodeBlockCount: profile.rangeCount,
            codePointRanges: profile.codePointRanges,
            completenessPercent: profile.completenessPercent,
            coveragePolicyKey: profile.category === "adobe_collection" ? "adobe" : "standard",
            coveragePolicyLabel: profile.category === "adobe_collection" ? "Adobe collection" : "Standard",
            coveragePolicyDescription: profile.description,
            blocksLabel: `${profile.standard} · ${profile.source}`,
            isChild: true,
            metaLabel: "Ranges",
            showBlocksLabel: false,
            downloadKey: `cjk-${languageIndex}-profile-${profileIndex}`,
            downloadFileName: `${makeSafeFileName(state.result.sourceName)}-${makeSafeFileName(language.languageName)}-${makeSafeFileName(profile.name)}-missing-unicode.txt`,
          })
        )
        .join("");
      const profileNames = profiles.map((profile) => profile.name).join(", ");

      return `
        <article class="completeness-group cjk-standard-group">
          ${renderCompletenessRow({
            name: language.languageName,
            scriptCode: language.languageCode,
            characterCount: bestProfile ? bestProfile.supportedCharacterCount : coverage.cjkCharacterCount,
            unicodeTotalCharacterCount: bestProfile ? bestProfile.totalCharacterCount : null,
            unicodeBlockCount: profiles.length,
            completenessPercent: bestProfile ? bestProfile.completenessPercent : null,
            coveragePolicyKey: "language",
            coveragePolicyLabel: "Language profile",
            coveragePolicyDescription: "CJK standard coverage grouped by language/market.",
            blocksLabel: profileNames,
            isChild: false,
            childCount: profiles.length,
            isExpanded,
            toggleKey: languageKey,
            toggleAttribute: "data-cjk-standard-toggle",
            expandedLabel: "收起标准",
            collapsedLabel: `展开 ${profiles.length} 个标准`,
            metaLabel: "Profiles",
            showBlocksLabel: false,
          })}
          <div class="completeness-children" data-cjk-standard-children="${escapeHtml(languageKey)}" ${isExpanded ? "" : "hidden"}>${childRows}</div>
        </article>
      `;
    })
    .join("");
}

function renderCompletenessRow(item) {
  const completenessPercent = item.completenessPercent ?? 0;
  const barWidth = Math.max(0, Math.min(100, completenessPercent));
  const toggleAttribute = item.toggleAttribute || "data-completeness-toggle";
  const expandedLabel = item.expandedLabel || "收起子 block";
  const collapsedLabel = item.collapsedLabel || `展开 ${item.childCount} 个子 block`;
  const metaLabel = item.metaLabel || (item.isChild ? "Ranges" : "Blocks");
  const blocksLabelHtml =
    item.showBlocksLabel === false
      ? ""
      : `<p class="completeness-blocks">${escapeHtml(item.blocksLabel)}</p>`;
  const supportedCharacterCount = Number(item.characterCount);
  const totalCharacterCount = Number(item.unicodeTotalCharacterCount);
  const hasIncompleteCoverage =
    Number.isFinite(supportedCharacterCount) &&
    Number.isFinite(totalCharacterCount) &&
    supportedCharacterCount < totalCharacterCount;
  const canDownloadMissing =
    item.downloadKey &&
    item.codePointRanges &&
    item.codePointRanges.length > 0 &&
    totalCharacterCount > 0 &&
    hasIncompleteCoverage;
  const missingDownloadButton = canDownloadMissing
    ? `<button class="missing-download-button secondary" type="button" data-missing-download="${escapeHtml(item.downloadKey)}">下载缺少字符表</button>`
    : "";

  if (canDownloadMissing) {
    missingDownloadRegistry.set(item.downloadKey, {
      name: item.name,
      codePointRanges: item.codePointRanges,
      fileName: item.downloadFileName,
    });
  }

  return `
    <div class="completeness-row ${item.isChild ? "child" : "parent"}">
      <div class="completeness-info">
        <div class="completeness-title-line">
          ${
            !item.isChild && item.childCount > 0
              ? `<button class="completeness-toggle" type="button" ${toggleAttribute}="${escapeHtml(item.toggleKey)}" aria-expanded="${item.isExpanded ? "true" : "false"}">
                  ${item.isExpanded ? expandedLabel : collapsedLabel}
                </button>`
              : ""
          }
          <div class="script-name">${escapeHtml(item.name)}</div>
          ${
            item.coveragePolicyLabel
              ? `<span class="coverage-policy ${escapeHtml(item.coveragePolicyKey || "optional")}" title="${escapeHtml(item.coveragePolicyDescription || "")}">
                  ${escapeHtml(item.coveragePolicyLabel)}
                </span>`
              : ""
          }
        </div>
        <div class="script-meta">
          ${item.scriptCode ? `<span><b>ISO code</b>${escapeHtml(item.scriptCode)}</span>` : ""}
          <span><b>字体字符数</b>${item.characterCount.toLocaleString("zh-CN")}</span>
          <span><b>Unicode 总量</b>${item.unicodeTotalCharacterCount ? item.unicodeTotalCharacterCount.toLocaleString("zh-CN") : "-"}</span>
          <span><b>${escapeHtml(metaLabel)}</b>${item.unicodeBlockCount ?? "-"}</span>
        </div>
        ${blocksLabelHtml}
      </div>
      <div class="completeness-visual" aria-label="${escapeHtml(item.name)} completeness ${formatPercent(completenessPercent)}">
        <div class="completeness-percent">${formatPercent(completenessPercent)}</div>
        <div class="completeness-bar-line">
          <div class="completeness-bar">
            <span style="width: ${barWidth}%"></span>
          </div>
          ${missingDownloadButton}
        </div>
      </div>
    </div>
  `;
}

function renderTable() {
  const filteredCharacters = getFilteredCharacters();
  const totalPages = Math.max(1, Math.ceil(filteredCharacters.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);

  const startIndex = (state.page - 1) * PAGE_SIZE;
  const pageItems = filteredCharacters.slice(startIndex, startIndex + PAGE_SIZE);

  if (pageItems.length === 0) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">没有找到匹配的字符结果。</td>
      </tr>
    `;
  } else {
    resultsBody.innerHTML = pageItems
      .map((entry) => {
        const displayCharacter = formatDisplayCharacter(entry.character, entry.decimalCodePoint);

        return `
          <tr>
            <td>
              <span class="character-chip ${displayCharacter.isControl ? "control" : ""}">
                ${escapeHtml(displayCharacter.label)}
              </span>
            </td>
            <td class="mono">${escapeHtml(entry.unicode)}</td>
            <td>${escapeHtml(entry.blockName || "-")}</td>
            <td>${escapeHtml(entry.scriptFamilyName || "-")}</td>
            <td>${escapeHtml(entry.scriptName || entry.blockChartName || "-")}</td>
            <td class="mono">${entry.decimalCodePoint}</td>
            <td class="mono">${entry.glyphId ?? "-"}</td>
            <td class="mono">${escapeHtml(entry.glyphName || "-")}</td>
          </tr>
        `;
      })
      .join("");
  }

  const visibleCount = pageItems.length === 0 ? 0 : startIndex + 1;
  const endCount = Math.min(startIndex + pageItems.length, filteredCharacters.length);

  resultCount.textContent = state.result
    ? `共 ${filteredCharacters.length.toLocaleString("zh-CN")} 条结果，当前显示 ${visibleCount}-${endCount}`
    : "还没有结果";

  pagination.hidden = !state.result || filteredCharacters.length <= PAGE_SIZE;
  pageLabel.textContent = `第 ${state.page} / ${totalPages} 页`;
  prevPageButton.disabled = state.page <= 1;
  nextPageButton.disabled = state.page >= totalPages;
}

function renderAll() {
  missingDownloadRegistry.clear();
  renderSummary();
  renderScriptCoverage();
  renderCjkStandardCheck();
  renderCompletenessCheck();
  renderTable();
}

function handleMissingDownloadClick(event) {
  const button = event.target.closest("[data-missing-download]");

  if (!button) {
    return false;
  }

  event.preventDefault();

  const downloadItem = missingDownloadRegistry.get(button.dataset.missingDownload);

  if (!downloadItem) {
    updateStatus("没有找到可下载的缺失字符数据，请重新解析字体。", true);
    return true;
  }

  const missingCodePoints = getMissingCodePoints(downloadItem.codePointRanges);

  if (missingCodePoints.length === 0) {
    updateStatus(`${downloadItem.name} 当前没有缺失字符。`);
    return true;
  }

  downloadTextFile(downloadItem.fileName, `${missingCodePoints.join("\n")}\n`);
  updateStatus(
    `已生成 ${downloadItem.name} 缺失字符表：${missingCodePoints.length.toLocaleString("zh-CN")} 个 Unicode。`
  );

  return true;
}

function exportVisibleLanguages(languageKey) {
  if (!state.result) {
    return;
  }

  const groups = getVisibleLanguageExportGroups();
  const languageCount = groups.reduce((total, group) => total + group.languages.length, 0);

  if (languageCount === 0) {
    updateStatus("当前没有可导出的语言列表。", true);
    return;
  }

  const selectedDataSource = getSelectedLanguageDataSource();
  const label = languageKey === "chineseName" ? "中文" : "英文";
  const sourceName = selectedDataSource.label === "Google 数据" ? "google" : "wiki-unicode";
  const topLanguageSuffix = state.onlyTopLanguages ? "-top-200" : "";
  const fileName = `${makeSafeFileName(state.result.sourceName)}-${sourceName}-languages-${label}${topLanguageSuffix}.txt`;
  const content = `${groups
    .map((group) => {
      const header = group.scriptCode ? `${group.scriptName} (${group.scriptCode})` : group.scriptName;
      const languageLines = group.languages.map((row) => `- ${row[languageKey] || row.englishName || row.code}`);

      return [header, ...languageLines].join("\n");
    })
    .join("\n\n")}\n`;

  downloadTextFile(fileName, content);
  updateStatus(
    `已导出 ${selectedDataSource.label} ${label}语言列表：${groups.length.toLocaleString("zh-CN")} 个 scripts，${languageCount.toLocaleString("zh-CN")} 个语言。`
  );
}

function moveLanguageTooltip(event) {
  const tooltipWidth = languageTooltip.offsetWidth || 280;
  const tooltipHeight = languageTooltip.offsetHeight || 80;
  const margin = 16;
  const x = Math.min(event.clientX + margin, window.innerWidth - tooltipWidth - margin);
  const y = Math.min(event.clientY + margin, window.innerHeight - tooltipHeight - margin);

  languageTooltip.style.left = `${Math.max(margin, x)}px`;
  languageTooltip.style.top = `${Math.max(margin, y)}px`;
}

function showLanguageTooltip(target, event) {
  const tooltip = target.dataset.tooltip;

  if (!tooltip) {
    return;
  }

  languageTooltip.textContent = tooltip;
  languageTooltip.hidden = false;
  moveLanguageTooltip(event);
}

function hideLanguageTooltip() {
  languageTooltip.hidden = true;
}

async function uploadFont(file) {
  const formData = new FormData();
  formData.append("fontFile", file);

  const response = await fetch("/api/extract", {
    method: "POST",
    body: formData,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Font parsing failed.");
  }

  return payload;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  selectedFile.textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "还没有选择文件";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];

  if (!file) {
    updateStatus("请先选择一个字体文件。", true);
    return;
  }

  submitButton.disabled = true;
  downloadButton.disabled = true;
  searchInput.disabled = true;
  updateStatus(`正在解析 ${file.name} ...`);

  try {
    state.result = await uploadFont(file);
    state.query = "";
    state.page = 1;
    state.expandedCompletenessScripts = new Set();
    state.expandedCjkLanguages = new Set();
    searchInput.value = "";
    searchInput.disabled = false;
    downloadButton.disabled = false;
    updateStatus(
      state.result.filteredOutCount > 0
        ? `解析完成：${state.result.sourceName}，显示 ${state.result.characterCount} 个字符，已过滤 ${state.result.filteredOutCount} 个非文本码点。`
        : `解析完成：${state.result.sourceName}，共 ${state.result.characterCount} 个字符。`
    );
    renderAll();
  } catch (error) {
    state.result = null;
    searchInput.value = "";
    searchInput.disabled = true;
    downloadButton.disabled = true;
    renderAll();
    updateStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.page = 1;
  renderTable();
});

topLanguageToggle.addEventListener("change", (event) => {
  state.onlyTopLanguages = event.target.checked;
  hideLanguageTooltip();
  renderScriptCoverage();
});

exportLanguagesEnButton.addEventListener("click", () => {
  exportVisibleLanguages("englishName");
});

exportLanguagesZhButton.addEventListener("click", () => {
  exportVisibleLanguages("chineseName");
});

languageDataSourceSelect.addEventListener("change", (event) => {
  state.languageDataSource = event.target.value || DEFAULT_LANGUAGE_DATA_SOURCE;
  hideLanguageTooltip();
  renderScriptCoverage();
  renderCompletenessCheck();
});

scriptColumnResizer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  scriptColumnResizer.setPointerCapture(event.pointerId);
  scriptColumnResizer.classList.add("dragging");
  document.body.classList.add("resizing-columns");
  setScriptColumnWidthFromPointer(event.clientX, false);
});

scriptColumnResizer.addEventListener("pointermove", (event) => {
  if (!scriptColumnResizer.classList.contains("dragging")) {
    return;
  }

  setScriptColumnWidthFromPointer(event.clientX, false);
});

scriptColumnResizer.addEventListener("pointerup", (event) => {
  if (scriptColumnResizer.hasPointerCapture(event.pointerId)) {
    scriptColumnResizer.releasePointerCapture(event.pointerId);
  }

  scriptColumnResizer.classList.remove("dragging");
  document.body.classList.remove("resizing-columns");
  setScriptColumnWidth(state.scriptColumnWidth, true);
});

scriptColumnResizer.addEventListener("pointercancel", (event) => {
  if (scriptColumnResizer.hasPointerCapture(event.pointerId)) {
    scriptColumnResizer.releasePointerCapture(event.pointerId);
  }

  scriptColumnResizer.classList.remove("dragging");
  document.body.classList.remove("resizing-columns");
  setScriptColumnWidth(state.scriptColumnWidth, true);
});

scriptColumnResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  event.preventDefault();

  if (event.key === "Home") {
    setScriptColumnWidth(MIN_SCRIPT_COLUMN_WIDTH);
  } else if (event.key === "End") {
    setScriptColumnWidth(MAX_SCRIPT_COLUMN_WIDTH);
  } else {
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey ? 5 : 2;
    setScriptColumnWidth(state.scriptColumnWidth + direction * step);
  }
});

completenessList.addEventListener("click", (event) => {
  if (handleMissingDownloadClick(event)) {
    return;
  }

  const toggleButton = event.target.closest(".completeness-toggle");

  if (!toggleButton) {
    return;
  }

  const scriptKey = toggleButton.dataset.completenessToggle;

  if (state.expandedCompletenessScripts.has(scriptKey)) {
    state.expandedCompletenessScripts.delete(scriptKey);
  } else {
    state.expandedCompletenessScripts.add(scriptKey);
  }

  renderCompletenessCheck();
});

cjkStandardList.addEventListener("click", (event) => {
  if (handleMissingDownloadClick(event)) {
    return;
  }

  const toggleButton = event.target.closest(".completeness-toggle");

  if (!toggleButton || !toggleButton.dataset.cjkStandardToggle) {
    return;
  }

  const languageKey = toggleButton.dataset.cjkStandardToggle;

  if (state.expandedCjkLanguages.has(languageKey)) {
    state.expandedCjkLanguages.delete(languageKey);
  } else {
    state.expandedCjkLanguages.add(languageKey);
  }

  renderCjkStandardCheck();
});

scriptCoverageBody.addEventListener("mouseover", (event) => {
  const chip = event.target.closest(".language-chip");

  if (chip) {
    showLanguageTooltip(chip, event);
  }
});

scriptCoverageBody.addEventListener("mousemove", (event) => {
  if (!languageTooltip.hidden) {
    moveLanguageTooltip(event);
  }
});

scriptCoverageBody.addEventListener("mouseout", (event) => {
  if (event.target.closest(".language-chip")) {
    hideLanguageTooltip();
  }
});

scriptCoverageBody.addEventListener("focusin", (event) => {
  const chip = event.target.closest(".language-chip");

  if (chip) {
    const rect = chip.getBoundingClientRect();
    showLanguageTooltip(chip, {
      clientX: rect.left,
      clientY: rect.bottom,
    });
  }
});

scriptCoverageBody.addEventListener("focusout", hideLanguageTooltip);

downloadButton.addEventListener("click", () => {
  if (!state.result) {
    return;
  }

  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const safeName = state.result.sourceName.replace(/\.(ttf|otf)$/i, "");

  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}-unicode-map.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

prevPageButton.addEventListener("click", () => {
  state.page -= 1;
  renderTable();
});

nextPageButton.addEventListener("click", () => {
  state.page += 1;
  renderTable();
});

setScriptColumnWidth(readStoredScriptColumnWidth(), false);
renderAll();
