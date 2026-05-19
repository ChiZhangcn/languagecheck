#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractFontCharacters } = require("./index");

function printUsage() {
  console.error("Usage: node src/cli.js <font-file.ttf|font-file.otf> [--output output.json] [--include-non-text]");
}

function parseArguments(argv) {
  const args = argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exitCode = 1;
    return null;
  }

  let fontFilePath = null;
  let outputPath = null;
  let includeNonTextCodePoints = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--output" || arg === "-o") {
      outputPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--include-non-text") {
      includeNonTextCodePoints = true;
      continue;
    }

    if (!fontFilePath) {
      fontFilePath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!fontFilePath) {
    throw new Error("A font file path is required.");
  }

  if ((args.includes("--output") || args.includes("-o")) && !outputPath) {
    throw new Error("The --output option requires a file path.");
  }

  return { fontFilePath, outputPath, includeNonTextCodePoints };
}

function run() {
  const parsedArgs = parseArguments(process.argv);

  if (!parsedArgs) {
    return;
  }

  const result = extractFontCharacters(parsedArgs.fontFilePath, {
    includeNonTextCodePoints: parsedArgs.includeNonTextCodePoints,
  });
  const serialized = JSON.stringify(result, null, 2);

  if (parsedArgs.outputPath) {
    const absoluteOutputPath = path.resolve(parsedArgs.outputPath);
    fs.writeFileSync(absoluteOutputPath, serialized, "utf8");
    console.log(`Wrote ${result.characterCount} characters to ${absoluteOutputPath}`);
    return;
  }

  console.log(serialized);
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
