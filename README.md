# Font Unicode Reader

读取 `TTF` 或 `OTF` 字体文件中支持的全部字符，并输出每个字符对应的 Unicode 编码。现在同时支持命令行和本地 Web 页面。

## 安装

```bash
npm install
```

## 启动 Web App

```bash
npm start
```

启动后打开 [http://localhost:3000](http://localhost:3000)，上传字体文件即可查看字符表、搜索结果并下载 JSON。

默认会过滤掉控制字符和 Unicode 非字符码点，例如 `U+0000`、`U+FFFF`，避免这些占位项干扰实际字符检查。

页面里的每个字符现在还会显示：

- `blockName`：Unicode 官方 block 名称
- `scriptFamilyName`：Unicode charts 中的大类，例如 `South Asian Scripts`
- `scriptName`：Unicode charts 中的脚本子类，例如 `Devanagari`

这些映射数据来自 Unicode 官方的 `Blocks.txt` 和 code charts 索引页。如需刷新到最新官方版本，可以运行：

```bash
npm run generate-unicode-data
```

## 语言和 Script 数据

项目里也整理了一份“语言列表、script 列表、语言-script 关系”的本地数据，输出在 `src/language-script-data.js`。它使用三个官方/准官方开放来源：

- 语言列表：IANA Language Subtag Registry
- Script 列表：ISO 15924 code list
- 语言和 script 的关系：Unicode CLDR `supplementalData.xml` 里的 `languageData`

可以运行下面的命令刷新：

```bash
npm run generate-language-script-data
```

当前生成结果包含 8275 个语言子标签、226 个 scripts、999 条语言-script 关系。需要注意的是：IANA 的语言子标签非常完整，但 CLDR 的 `languageData` 更像“产品国际化里实际需要使用的主/次 script 映射”，不是每一种语言所有历史书写系统的穷尽百科。因此数据里会保留 `unmappedLanguageCodes`，方便后续用 Wikidata、Glottolog 或人工表继续补充。

代码里可以这样查询：

```js
const { getScriptsForLanguage, getLanguagesForScript } = require("./src/language-script-lookup");

console.log(getScriptsForLanguage("zh"));
console.log(getLanguagesForScript("Deva", { usage: "primary" }));
```

## 语言使用人数数据

项目里还整理了一份 `language -> spoken population` 的估算映射，输出在 `src/language-population-data.js`。当前版本使用 Wikidata 的 `number of speakers, writers, or signers (P1098)` 作为开放数据基线，并按 IANA language code 对齐。

可以运行下面的命令刷新：

```bash
npm run generate-language-population-data
```

当前生成结果覆盖 1915 个语言代码，来自 2362 条 Wikidata 估算。选择规则会优先使用 `total / whole / sum` 这类总使用人数；如果没有总数，再选择 L1、一类未标注估算或 L2。由于语言使用人数本身高度依赖年份、统计口径和来源，这份数据会保留 `populationType`、`estimateYear`、`references` 和所有候选 `estimates`，方便后续审计或替换成授权数据。

```js
const { getPopulationForLanguage, formatPopulation } = require("./src/language-population-lookup");

const english = getPopulationForLanguage("en");
console.log(formatPopulation(english.population));
```

## 命令行使用

直接输出到终端：

```bash
node src/cli.js /System/Library/Fonts/Symbol.ttf
```

如果你想保留这些非文本码点一起导出，可以加上：

```bash
node src/cli.js /System/Library/Fonts/Symbol.ttf --include-non-text
```

输出到 JSON 文件：

```bash
node src/cli.js /System/Library/Fonts/Symbol.ttf --output symbol.json
```

也可以通过 npm script：

```bash
npm run read-font -- /System/Library/Fonts/Symbol.ttf
```

## 返回结果示例

```json
{
  "fontPath": "/System/Library/Fonts/Symbol.ttf",
  "postscriptName": "Symbol",
  "fullName": "Symbol",
  "familyName": "Symbol",
  "subfamilyName": "Regular",
  "rawCharacterCount": 227,
  "characterCount": 227,
  "filteredOutCount": 0,
  "includeNonTextCodePoints": false,
  "characters": [
    {
      "character": " ",
      "unicode": "U+0020",
      "decimalCodePoint": 32,
      "blockName": "Basic Latin",
      "scriptFamilyName": "European Scripts",
      "scriptName": "Latin",
      "blockChartName": "Basic Latin (ASCII)",
      "chartSectionName": "Scripts",
      "glyphId": 3,
      "glyphName": "space"
    }
  ]
}
```

## 代码调用

```js
const { extractFontCharacters } = require("./src/index");

const result = extractFontCharacters("/System/Library/Fonts/Symbol.ttf");
console.log(result.characterCount);
console.log(result.characters[0]);
```
