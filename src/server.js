"use strict";

const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { extractFontCharactersFromBuffer, isSupportedFont } = require("./index");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/extract", upload.single("fontFile"), (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "Please upload a TTF or OTF font file." });
      return;
    }

    if (!isSupportedFont(request.file.originalname)) {
      response.status(400).json({ error: "Only .ttf and .otf font files are supported." });
      return;
    }

    const result = extractFontCharactersFromBuffer(request.file.buffer, request.file.originalname);
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({ error: "Font file is too large. Please upload a file under 20 MB." });
    return;
  }

  response.status(500).json({ error: "Unexpected server error." });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  const server = app.listen(port, host, () => {
    console.log(`Font web app is running at http://${host}:${port}`);
  });

  server.on("error", (error) => {
    console.error(`Failed to start web app: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
};
