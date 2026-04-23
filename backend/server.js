require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const exifParser = require("exif-parser");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const OpenAI = require("openai");
const mongoose = require("mongoose");
const piexif = require("piexifjs");
const Tesseract = require("tesseract.js");
const extractPngChunks = require("png-chunks-extract");
const encodePngChunks = require("png-chunks-encode");
const pngText = require("png-chunk-text");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, "data");
const CASES_FILE = path.join(DATA_DIR, "cases.json");
const MONGO_URI = process.env.MONGO_URI || "";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const textExtensions = new Set([
  ".txt",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".cs",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".kts",
  ".sh",
  ".bat",
  ".ps1",
  ".sql",
  ".json",
  ".md",
  ".html",
  ".css",
  ".xml",
  ".csv",
  ".log",
  ".yml",
  ".yaml",
]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const caseSchema = new mongoose.Schema(
  {
    caseId: { type: String, unique: true, index: true },
    masterFile: mongoose.Schema.Types.Mixed,
    revisions: [mongoose.Schema.Types.Mixed],
    aiHistory: [mongoose.Schema.Types.Mixed],
  },
  { timestamps: true }
);

let CaseModel = null;
let storageMode = "json-fallback";
let memoryCases = null;

function readFallbackCases() {
  if (memoryCases) {
    return memoryCases;
  }

  if (!fs.existsSync(CASES_FILE)) {
    memoryCases = [];
    return memoryCases;
  }

  try {
    memoryCases = JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  } catch (_error) {
    memoryCases = [];
  }

  return memoryCases;
}

function writeFallbackCases(cases) {
  memoryCases = cases;
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2), "utf8");
}

async function connectDatabase() {
  if (!MONGO_URI) {
    return;
  }

  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    CaseModel = mongoose.models.MetaInsightCase || mongoose.model("MetaInsightCase", caseSchema);
    storageMode = "mongodb";
  } catch (error) {
    console.warn("MongoDB unavailable, using JSON fallback:", error.message);
    storageMode = "json-fallback";
  }
}

async function listCases() {
  if (storageMode === "mongodb" && CaseModel) {
    const cases = await CaseModel.find().sort({ updatedAt: -1 }).lean();
    return cases.map(compactCase);
  }

  return readFallbackCases()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(compactCase);
}

async function getCaseById(caseId) {
  if (storageMode === "mongodb" && CaseModel) {
    return CaseModel.findOne({ caseId }).lean();
  }

  return readFallbackCases().find((entry) => entry.caseId === caseId) || null;
}

async function upsertCaseRecord(record) {
  if (storageMode === "mongodb" && CaseModel) {
    await CaseModel.findOneAndUpdate({ caseId: record.caseId }, record, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    return;
  }

  const cases = readFallbackCases();
  const index = cases.findIndex((entry) => entry.caseId === record.caseId);
  if (index >= 0) {
    cases[index] = record;
  } else {
    cases.push(record);
  }
  writeFallbackCases(cases);
}

function compactCase(record) {
  return {
    caseId: record.caseId,
    name: record.masterFile?.name || "Unnamed evidence",
    type: record.masterFile?.type || "unknown",
    mimeType: record.masterFile?.mimeType || "application/octet-stream",
    updatedAt: record.updatedAt || record.masterFile?.lastSavedAt || new Date().toISOString(),
    revisionCount: record.revisions?.length || 0,
    aiCount: record.aiHistory?.length || 0,
    steganography: record.masterFile?.metadata?.steganography || null,
  };
}

function safeSerialize(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => safeSerialize(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, safeSerialize(entry)]));
  }

  return value;
}

function getPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const blockLength = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function getImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") {
    return getPngDimensions(buffer);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return getJpegDimensions(buffer);
  }
  return null;
}

function detectContentKind(extension, mimeType, content) {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return "document";
  }

  const codeHint = /(?:\bfunction\b|\bconst\b|\blet\b|\bimport\b|\bexport\b|=>|class\s+\w+)/.test(content || "");
  if (
    codeHint ||
    [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".html",
      ".css",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".cs",
      ".php",
      ".rb",
      ".go",
      ".rs",
      ".swift",
      ".kt",
      ".kts",
      ".sh",
      ".bat",
      ".ps1",
      ".sql",
    ].includes(extension)
  ) {
    return "code";
  }
  return "text";
}

function buildSteganographyReport(file) {
  const suspiciousReasons = [];
  if (file.size > 5 * 1024 * 1024) {
    suspiciousReasons.push("Image size exceeds 5MB threshold.");
  }
  if (file.originalname.toLowerCase().includes("copy")) {
    suspiciousReasons.push("Filename pattern suggests repeated export or duplication.");
  }

  return {
    suspicious: suspiciousReasons.length > 0,
    score: suspiciousReasons.length > 0 ? 72 : 18,
    reasons: suspiciousReasons.length > 0 ? suspiciousReasons : ["No size-based or filename-based steganography triggers were detected."],
    recommendation:
      suspiciousReasons.length > 0
        ? "Perform binary diffing and visual histogram analysis before trusting this asset."
        : "No immediate signs of payload hiding were found by the heuristic.",
  };
}

function computeIntegrity(buffer) {
  return {
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    md5: crypto.createHash("md5").update(buffer).digest("hex"),
  };
}

function buildExplainSummary({ mode, filename, content }) {
  const trimmed = (content || "").trim();
  const excerpt = trimmed.slice(0, 1000);
  const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;

  const lowered = trimmed.toLowerCase();
  const looksLikeInstallerChecklist =
    /(directx|redis(t)?|install|download|x86|x64|runtime|visual c\+\+|c\+\+)/.test(lowered);
  const looksLikeMenuOrLauncher =
    /(main game files|launcher|setup|patch|update)/.test(lowered);
  const looksLikeCredentialsOrSensitive =
    /(password|username|email|otp|token|license key|serial)/.test(lowered);

  if (mode === "code") {
    return {
      title: `Code intelligence for ${filename}`,
      overview:
        "This source file contains executable or declarative logic. MetaInsight evaluated structure, likely trust boundaries, and patterns that deserve secure review.",
      highlights: [
        `The file contains approximately ${lines} lines and ${words} lexical units.`,
        "The parser classified the upload as code based on syntax features such as imports, declarations, or function signatures.",
        "Review should prioritize file IO, request handling, parser logic, secret handling, and any implicit trust in external inputs.",
      ],
      risks: [
        "Look for injection paths, weak validation, and unsafe assumptions around user-controlled content.",
        "Dependencies should be checked for vulnerabilities and lockfile drift before deployment.",
        "Generated or copied code can hide hard-coded secrets, test backdoors, or weak cryptographic usage.",
      ],
      sample: excerpt,
    };
  }

  if (looksLikeInstallerChecklist || looksLikeMenuOrLauncher) {
    return {
      title: `Operational text analysis for ${filename}`,
      overview:
        "This text appears to be a software setup or launcher instruction list rather than normal prose. It looks like a small checklist of dependencies or prerequisites that a user is expected to install before running an application, game, or launcher.",
      highlights: [
        `The extracted text contains approximately ${lines} lines and ${words} words.`,
        "Terms such as DirectX, C++ Redistributable, x86, and x64 indicate Windows runtime dependency instructions.",
        "The heading suggests the text may come from a launcher, installer page, setup screen, or help panel related to game/application startup files.",
      ],
      risks: [
        looksLikeCredentialsOrSensitive
          ? "The text may also include sensitive identifiers or account-related data and should be reviewed carefully before sharing."
          : "If this screenshot is from third-party software, verify the download source before following install instructions.",
        "Attackers sometimes mimic dependency-install screens to trick users into downloading malicious installers.",
        "If this image is part of an incident or forensic review, preserve the original screenshot and compare the extracted text against the visible source for OCR mistakes.",
      ],
      sample: excerpt,
      interpretation:
        "In plain terms, this text is most likely telling the user to install required Windows components such as DirectX and Visual C++ Redistributables so the target software can run correctly.",
      usage:
        "This kind of text is commonly used in installers, launchers, repacks, setup guides, or troubleshooting screens to explain missing dependencies.",
    };
  }

  if (looksLikeCredentialsOrSensitive) {
    return {
      title: `Sensitive text analysis for ${filename}`,
      overview:
        "This text appears to contain account, access, or identity-related content. It should be treated as potentially sensitive operational information rather than casual document text.",
      highlights: [
        `The extracted text contains approximately ${lines} lines and ${words} words.`,
        "The wording suggests the content may relate to access credentials, account recovery, or service authentication.",
        "Even short screenshots like this can reveal enough information to support phishing, account recovery abuse, or impersonation attempts.",
      ],
      risks: [
        "Do not share the screenshot publicly without reviewing and redacting sensitive tokens or identifiers.",
        "Credential-like text in screenshots often remains searchable even when users think it is harmless.",
        "If this is incident evidence, retain the original image hash and record when OCR extraction was performed.",
      ],
      sample: excerpt,
      interpretation:
        "This text is likely being used to identify, authenticate, or recover access to an account, service, or protected resource.",
      usage:
        "In practice, this type of text is used in login flows, account recovery steps, email confirmations, or security verification screens.",
    };
  }

  return {
    title: `Document intelligence for ${filename}`,
    overview:
      "This upload reads like document or prose content. MetaInsight interpreted what the text appears to be about, what it may be used for, and what operational meaning it could carry.",
    highlights: [
      `The extracted text contains approximately ${lines} lines and ${words} words.`,
      "The document classification is driven by its natural-language dominant structure rather than executable syntax.",
      "The text likely serves an informational, procedural, or descriptive purpose depending on its wording and context.",
    ],
    risks: [
      "PDF and text exports can expose confidential workflows, access patterns, and internal references even when no explicit secret is visible.",
      "Layout loss during extraction means tables and legal clauses should be checked against the original evidence before acting on them.",
      "If this material is evidence, preserve the original hash and avoid destructive edits without audit logging.",
    ],
    sample: excerpt,
    interpretation:
      "This text appears to be general written content intended to inform, instruct, or describe something to the reader.",
    usage:
      "Depending on the source, this kind of extracted text is usually used in documents, notices, screenshots, manuals, posts, or user-interface content.",
  };
}

function buildVisionSummary({ filename, metadata, steganography }) {
  const hiddenKeys = Object.keys(metadata || {});
  const extractedText = typeof metadata?.extractedText === "string" ? metadata.extractedText.trim() : "";

  if (extractedText) {
    return {
      title: `Document-style image insight for ${filename}`,
      overview:
        "The image appears to contain readable text or document-like content. MetaInsight is treating this image as a text-bearing visual asset rather than a purely scenic photo.",
      highlights: [
        `Readable text was detected and extracted for downstream analysis and selective encryption.`,
        `The image exposes ${hiddenKeys.length} metadata properties for review or rewrite.`,
        steganography?.suspicious
          ? "The heuristic still flagged the image for deeper covert-payload inspection."
          : "No immediate covert-payload trigger was raised by the current heuristic set.",
      ],
      risks: [
        "Document screenshots and photographed papers can leak policy text, credentials, IDs, and operational details.",
        "Image metadata can still reveal device, time, software, and collection chain information.",
        "OCR-like extraction may lose formatting, so sensitive details should be verified against the original image.",
      ],
      metadataSnapshot: hiddenKeys.slice(0, 12),
      sample: extractedText.slice(0, 1000),
    };
  }

  return {
    title: `Visual intelligence for ${filename}`,
    overview:
      "This asset was treated as visual image evidence. No meaningful text payload was detected, so the review focuses on a neutral scene description together with EXIF visibility, provenance signals, and payload-hiding heuristics.",
    highlights: [
      `The image exposes ${hiddenKeys.length} metadata properties for review or rewrite.`,
      steganography?.suspicious
        ? "The heuristic flagged this upload for deeper covert-payload inspection."
        : "No immediate covert-payload trigger was raised by the current heuristic set.",
      "For non-document images, the expected output is a neutral descriptive summary that helps a reviewer understand the setting, subject, and visible context.",
    ],
    risks: [
      "Metadata can leak location, device, software chain, editing traces, and collection history.",
      "Mismatched timestamps or oversized payloads can indicate repackaging or staging.",
      "Evidence handling should preserve original hashes and maintain a revision trail for all rewrites.",
    ],
    metadataSnapshot: hiddenKeys.slice(0, 12),
    sceneDescription:
      "The current fallback mode cannot inspect the actual pixels in detail, so use a live vision-capable model for a richer neutral scene description.",
  };
}

function fallbackImageDetection({ filename, metadata }) {
  const lowered = String(filename || "").toLowerCase();
  const metadataString = JSON.stringify(metadata || {}).toLowerCase();
  const looksDocument =
    /(scan|invoice|receipt|statement|id|passport|form|document|page|paper)/.test(lowered) ||
    /(ocr|document|pdf|scan)/.test(metadataString);

  if (looksDocument) {
    return {
      hasReadableText: true,
      extractedText:
        "The image appears to contain document-like content. In mock mode, MetaInsight cannot recover exact OCR text, but it classifies this upload as likely containing readable text suitable for selective encryption and summary.",
      summary:
        "Image classified as a document-style asset. Treat this as extractable text content and review it before encryption or forensic export.",
    };
  }

  return {
    hasReadableText: false,
    extractedText: "",
    summary:
      "No reliable text payload was detected in the image. This appears more like a scene, object, or portrait-style image, so there is no useful extracted text to encrypt.",
  };
}

async function detectImageTextWithOCR(imageDataUrl) {
  const base64 = String(imageDataUrl || "").split(",")[1];
  if (!base64) {
    return null;
  }

  const imageBuffer = Buffer.from(base64, "base64");
  const result = await Tesseract.recognize(imageBuffer, "eng", {
    logger: () => {},
  });
  const text = (result?.data?.text || "").replace(/\r/g, "").trim();
  const meaningfulText = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  if (!meaningfulText || meaningfulText.replace(/[^a-zA-Z0-9]/g, "").length < 12) {
    return {
      hasReadableText: false,
      extractedText: "",
      summary:
        "OCR did not find enough readable document text in this image, so there is no useful extracted text to encrypt.",
    };
  }

  return {
    hasReadableText: true,
    extractedText: meaningfulText,
    summary:
      "Readable text was extracted from the image using OCR and is ready for selective encryption.",
  };
}

async function generateRealTextInsight({ filename, mode, content }) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: "You are a cyber security forensic analyst. Return JSON with keys: title, overview, highlights, risks, sample.",
      },
      {
        role: "user",
        content: `Analyze this ${mode} file named ${filename}. Content:\n${content.slice(0, 12000)}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "forensic_insight",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            overview: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            sample: { type: "string" },
          },
          required: ["title", "overview", "highlights", "risks", "sample"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function generateRealVisionInsight({ filename, metadata, imageDataUrl }) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a cyber forensic analyst. Describe images neutrally and factually. Do not sexualize people, do not guess protected attributes unless visually clear, and avoid erotic wording. Return JSON with keys: title, overview, sceneDescription, highlights, risks, metadataSnapshot.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Analyze this image evidence named ${filename}. Provide a neutral but detailed description of what is visibly happening in the image, including subject, clothing, pose, setting, lighting, and background context when clear. Metadata snapshot: ${JSON.stringify(metadata).slice(0, 4000)}`,
          },
          ...(imageDataUrl
            ? [
                {
                  type: "input_image",
                  image_url: imageDataUrl,
                },
              ]
            : []),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "vision_forensic_insight",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            overview: { type: "string" },
            sceneDescription: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } },
            metadataSnapshot: { type: "array", items: { type: "string" } },
          },
          required: ["title", "overview", "sceneDescription", "highlights", "risks", "metadataSnapshot"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function detectImageTextWithAI({ filename, imageDataUrl, metadata }) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are an image forensic assistant. Decide if the image contains meaningful readable text. Return JSON with keys: hasReadableText, extractedText, summary.",
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Analyze the uploaded image named ${filename}. Metadata: ${JSON.stringify(metadata).slice(0, 4000)}`,
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "image_text_detection",
        schema: {
          type: "object",
          properties: {
            hasReadableText: { type: "boolean" },
            extractedText: { type: "string" },
            summary: { type: "string" },
          },
          required: ["hasReadableText", "extractedText", "summary"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

async function generateRealCodeWalkthrough({ filename, content }) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You are a senior secure software engineer. Return JSON with keys: title, overview, sections, risks. Each section must have heading and explanation.",
      },
      {
        role: "user",
        content: `Explain this code file named ${filename} in detail, including how each major section works.\n${content.slice(0, 12000)}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "code_walkthrough",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            overview: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  explanation: { type: "string" },
                },
                required: ["heading", "explanation"],
                additionalProperties: false,
              },
            },
            risks: { type: "array", items: { type: "string" } },
          },
          required: ["title", "overview", "sections", "risks"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

function buildFallbackCodeWalkthrough({ filename, content }) {
  const lines = String(content || "").split(/\r?\n/);
  const sections = [];

  if (/(import|require)\s/.test(content)) {
    sections.push({
      heading: "Imports and dependencies",
      explanation:
        "The file begins by pulling in external modules or local dependencies. This is where the code declares what services, libraries, or helpers it relies on.",
    });
  }

  if (/\bfunction\b|\=\>\s*{?/.test(content)) {
    sections.push({
      heading: "Executable logic",
      explanation:
        "The main logic is implemented through functions, methods, or arrow expressions. These sections define what the code does with incoming data and how control flows through the file.",
    });
  }

  if (/\breturn\b/.test(content)) {
    sections.push({
      heading: "Outputs and returned values",
      explanation:
        "Return statements indicate the result of the file's logic. These outputs are the values that other parts of the application can consume.",
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: "General structure",
      explanation:
        "The code does not expose obvious structural markers in fallback mode, but it still appears to define a sequence of statements or declarations that should be reviewed top to bottom.",
    });
  }

  return {
    title: `Detailed code walkthrough for ${filename}`,
    overview:
      `This is a section-by-section explanation generated without live AI. The file contains approximately ${lines.length} lines and has been broken into the major responsibilities that can be inferred from its syntax.`,
    sections,
    risks: [
      "Review any direct input handling and dynamic execution paths.",
      "Confirm imported packages are trusted and pinned.",
      "Check whether secrets or environment-dependent assumptions are embedded in the file.",
    ],
  };
}

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatExifDate(date) {
  if (!date) {
    return undefined;
  }

  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function buildImageDescription(masterFile) {
  return JSON.stringify(
    {
      fileSystem: masterFile.metadata?.fileSystem || {},
      hidden: masterFile.metadata?.hidden || {},
      currentContent: masterFile.currentContent || "",
      rewrittenBy: "MetaInsight",
    },
    null,
    2
  ).slice(0, 60000);
}

function buildEmbeddedPayload(masterFile) {
  return {
    fileSystem: masterFile.metadata?.fileSystem || {},
    hidden: masterFile.metadata?.hidden || {},
    currentContent: masterFile.currentContent || "",
    rewrittenBy: "MetaInsight",
    embeddedAt: new Date().toISOString(),
  };
}

function parseEmbeddedPayload(rawValue) {
  if (!rawValue) {
    return null;
  }

  const asString = Array.isArray(rawValue)
    ? rawValue.join("")
    : Buffer.isBuffer(rawValue)
      ? rawValue.toString("utf8")
      : String(rawValue);
  const trimmed = asString.trim();
  const prefixed = trimmed.startsWith("METAINSIGHT::") ? trimmed.slice("METAINSIGHT::".length) : trimmed;

  try {
    const parsed = JSON.parse(prefixed);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function mergeEmbeddedMetadata(hiddenMetadata, embeddedPayload) {
  if (!embeddedPayload || typeof embeddedPayload !== "object") {
    return hiddenMetadata;
  }

  return safeSerialize({
    ...hiddenMetadata,
    ...(embeddedPayload.hidden || {}),
    metaInsightFileSystem: embeddedPayload.fileSystem || {},
    metaInsightEmbeddedAt: embeddedPayload.embeddedAt || "",
    metaInsightRewrittenBy: embeddedPayload.rewrittenBy || "MetaInsight",
  });
}

function extractPngTextChunks(buffer) {
  try {
    return extractPngChunks(buffer)
      .filter((chunk) => chunk.name === "tEXt")
      .map((chunk) => {
        try {
          return pngText.decode(chunk.data);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function extractPdfEmbeddedPayload(parsed) {
  const keywordsValue = parsed?.info?.Keywords;
  const keywordTokens = Array.isArray(keywordsValue)
    ? keywordsValue
    : String(keywordsValue || "")
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const payloadToken = keywordTokens.find((entry) => entry.startsWith("MI:"));
  if (!payloadToken) {
    return null;
  }

  try {
    const json = Buffer.from(payloadToken.slice(3), "base64url").toString("utf8");
    return JSON.parse(json);
  } catch (_error) {
    return null;
  }
}

function buildTextMetadataFooter(masterFile) {
  const payload = Buffer.from(JSON.stringify(buildEmbeddedPayload(masterFile))).toString("base64url");
  const extension = (masterFile.extension || "").toLowerCase();

  if ([".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".swift", ".kt", ".kts", ".css", ".php"].includes(extension)) {
    return `\n/* METAINSIGHT_METADATA_START\n${payload}\nMETAINSIGHT_METADATA_END */\n`;
  }

  if ([".py", ".rb", ".sh", ".ps1", ".yml", ".yaml"].includes(extension)) {
    return `\n# METAINSIGHT_METADATA_START\n# ${payload}\n# METAINSIGHT_METADATA_END\n`;
  }

  if (extension === ".sql") {
    return `\n-- METAINSIGHT_METADATA_START\n-- ${payload}\n-- METAINSIGHT_METADATA_END\n`;
  }

  if (extension === ".bat") {
    return `\nREM METAINSIGHT_METADATA_START\nREM ${payload}\nREM METAINSIGHT_METADATA_END\n`;
  }

  if ([".html", ".xml"].includes(extension)) {
    return `\n<!-- METAINSIGHT_METADATA_START\n${payload}\nMETAINSIGHT_METADATA_END -->\n`;
  }

  return `\n[METAINSIGHT_METADATA_START]\n${payload}\n[METAINSIGHT_METADATA_END]\n`;
}

function extractEmbeddedTextPayload(rawText, extension) {
  const normalizedExtension = (extension || "").toLowerCase();
  const matchers = [];

  if ([".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".swift", ".kt", ".kts", ".css", ".php"].includes(normalizedExtension)) {
    matchers.push(/(?:\r?\n)?\/\*\s*METAINSIGHT_METADATA_START\s*([\s\S]*?)\s*METAINSIGHT_METADATA_END\s*\*\/\s*$/m);
  }

  if ([".py", ".rb", ".sh", ".ps1", ".yml", ".yaml"].includes(normalizedExtension)) {
    matchers.push(/(?:\r?\n)?#\s*METAINSIGHT_METADATA_START\s*\r?\n([\s\S]*?)\r?\n#\s*METAINSIGHT_METADATA_END\s*$/m);
  }

  if (normalizedExtension === ".sql") {
    matchers.push(/(?:\r?\n)?--\s*METAINSIGHT_METADATA_START\s*\r?\n([\s\S]*?)\r?\n--\s*METAINSIGHT_METADATA_END\s*$/m);
  }

  if (normalizedExtension === ".bat") {
    matchers.push(/(?:\r?\n)?REM\s+METAINSIGHT_METADATA_START\s*\r?\n([\s\S]*?)\r?\nREM\s+METAINSIGHT_METADATA_END\s*$/m);
  }

  if ([".html", ".xml"].includes(normalizedExtension)) {
    matchers.push(/(?:\r?\n)?<!--\s*METAINSIGHT_METADATA_START\s*([\s\S]*?)\s*METAINSIGHT_METADATA_END\s*-->\s*$/m);
  }

  matchers.push(/(?:\r?\n)?\[METAINSIGHT_METADATA_START\]\s*([\s\S]*?)\s*\[METAINSIGHT_METADATA_END\]\s*$/m);

  for (const matcher of matchers) {
    const match = rawText.match(matcher);
    if (!match) {
      continue;
    }

    const rawPayload = match[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:#|--|REM\s+)\s?/, "").trim())
      .join("");

    try {
      const json = Buffer.from(rawPayload, "base64url").toString("utf8");
      const payload = JSON.parse(json);
      return {
        content: rawText.replace(match[0], "").replace(/\s+$/, ""),
        payload,
      };
    } catch (_error) {
      return {
        content: rawText,
        payload: null,
      };
    }
  }

  return {
    content: rawText,
    payload: null,
  };
}
function rewriteJpeg(masterFile) {
  const source = masterFile.originalBinary.split(",")[1];
  const binaryString = Buffer.from(source, "base64").toString("binary");
  const hidden = masterFile.metadata?.hidden || {};
  const fileSystem = masterFile.metadata?.fileSystem || {};
  const exifDate = formatExifDate(parseDate(fileSystem.modified || fileSystem.created));
  const description = buildImageDescription(masterFile);
  const embeddedPayload = `METAINSIGHT::${JSON.stringify(buildEmbeddedPayload(masterFile))}`;
  const exif = {
    "0th": {
      [piexif.ImageIFD.Software]: "MetaInsight Forensic Rewrite",
      [piexif.ImageIFD.Artist]: "MetaInsight",
      [piexif.ImageIFD.ImageDescription]: description.slice(0, 2000),
      [piexif.ImageIFD.XPComment]: embeddedPayload,
    },
    Exif: {
      [piexif.ExifIFD.UserComment]: embeddedPayload,
    },
    GPS: {},
    "1st": {},
  };

  if (exifDate) {
    exif["0th"][piexif.ImageIFD.DateTime] = exifDate;
    exif.Exif[piexif.ExifIFD.DateTimeOriginal] = exifDate;
    exif.Exif[piexif.ExifIFD.DateTimeDigitized] = exifDate;
  }
  if (typeof hidden.Make === "string") {
    exif["0th"][piexif.ImageIFD.Make] = hidden.Make;
  }
  if (typeof hidden.Model === "string") {
    exif["0th"][piexif.ImageIFD.Model] = hidden.Model;
  }

  const exifBytes = piexif.dump(exif);
  const rewritten = piexif.insert(exifBytes, binaryString);
  return Buffer.from(rewritten, "binary");
}

function rewritePng(masterFile) {
  const source = Buffer.from(masterFile.originalBinary.split(",")[1], "base64");
  const chunks = extractPngChunks(source).filter((chunk) => chunk.name !== "tEXt");
  const insertIndex = Math.max(chunks.findIndex((chunk) => chunk.name === "IEND"), 0);
  const payload = JSON.stringify(buildEmbeddedPayload(masterFile), null, 2);

  chunks.splice(insertIndex, 0, pngText.encode("MetaInsight", payload));
  return Buffer.from(encodePngChunks(chunks));
}

async function rewritePdf(masterFile) {
  const pdf = await PDFDocument.create();
  const title = masterFile.metadata?.hidden?.Title || masterFile.metadata?.fileSystem?.name || masterFile.name;
  const author = masterFile.metadata?.hidden?.Author || "MetaInsight";
  const subject = masterFile.metadata?.hidden?.Subject || "Forensic rewrite";
  const existingKeywords = typeof masterFile.metadata?.hidden?.Keywords === "string"
    ? masterFile.metadata.hidden.Keywords.split(",").map((item) => item.trim()).filter(Boolean)
    : ["MetaInsight", "forensic", "rewrite"];
  const embeddedKeyword = `MI:${Buffer.from(JSON.stringify(buildEmbeddedPayload(masterFile))).toString("base64url")}`;
  const keywords = [...existingKeywords.filter((item) => !item.startsWith("MI:")), embeddedKeyword];

  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setSubject(subject);
  pdf.setKeywords(keywords);
  pdf.setCreator("MetaInsight");
  pdf.setProducer("MetaInsight");
  const modified = parseDate(masterFile.metadata?.fileSystem?.modified);
  if (modified) {
    pdf.setModificationDate(modified);
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const lines = String(masterFile.currentContent || masterFile.originalContent || "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const chunks = [];
      let current = line;
      while (current.length > 90) {
        chunks.push(current.slice(0, 90));
        current = current.slice(90);
      }
      chunks.push(current);
      return chunks;
    });

  lines.forEach((line) => {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 40, y, size: 10, font });
    y -= 14;
  });

  return Buffer.from(await pdf.save());
}

function rewriteText(masterFile) {
  const body = masterFile.currentContent || "";
  const footer = buildTextMetadataFooter(masterFile);
  const normalizedBody = body.replace(/\s+$/, "");
  return Buffer.from(`${normalizedBody}${footer}`, "utf8");
}

async function buildRewrittenArtifact(masterFile) {
  const extension = (masterFile.extension || "").toLowerCase();

  if (textExtensions.has(extension)) {
    return {
      buffer: rewriteText(masterFile),
      mimeType: masterFile.mimeType || "text/plain",
      filename: masterFile.name,
    };
  }
  if (extension === ".pdf") {
    return {
      buffer: await rewritePdf(masterFile),
      mimeType: "application/pdf",
      filename: masterFile.name.replace(/\.pdf$/i, "") + "_rewritten.pdf",
    };
  }
  if (extension === ".png") {
    return {
      buffer: rewritePng(masterFile),
      mimeType: "image/png",
      filename: masterFile.name.replace(/\.png$/i, "") + "_rewritten.png",
    };
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return {
      buffer: rewriteJpeg(masterFile),
      mimeType: "image/jpeg",
      filename: masterFile.name.replace(/\.(jpg|jpeg)$/i, "") + "_rewritten.jpg",
    };
  }

  return {
    buffer: rewriteText(masterFile),
    mimeType: "text/plain",
    filename: masterFile.name.replace(/\.[^/.]+$/, "") + "_rewritten.txt",
  };
}

async function buildMasterFile(file, requestLastModified) {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype || "application/octet-stream";
  const lastModified = requestLastModified
    ? new Date(Number(requestLastModified)).toISOString()
    : new Date().toISOString();

  let extractedContent = "";
  let hiddenMetadata = {};
  let originalBinary = null;
  let embeddedPayload = null;

  if (extension === ".pdf" || mimeType === "application/pdf") {
    const parsed = await pdfParse(file.buffer);
    extractedContent = (parsed.text || "").trim();
    hiddenMetadata = safeSerialize({
      Title: parsed.info?.Title || "",
      Author: parsed.info?.Author || "",
      Subject: parsed.info?.Subject || "",
      Keywords: parsed.info?.Keywords || "",
      Creator: parsed.info?.Creator || "",
      Producer: parsed.info?.Producer || "",
      pdfInfo: parsed.info || {},
      pdfMetadata: parsed.metadata || {},
      pages: parsed.numpages || 0,
      version: parsed.version || "unknown",
    });
    embeddedPayload = extractPdfEmbeddedPayload(parsed);
    hiddenMetadata = mergeEmbeddedMetadata(hiddenMetadata, embeddedPayload);
  } else if (mimeType.startsWith("image/")) {
    originalBinary = `data:${mimeType};base64,${file.buffer.toString("base64")}`;
    try {
      const parsedExif = exifParser.create(file.buffer).parse();
      const manualDimensions = getImageDimensions(file.buffer, mimeType);
      hiddenMetadata = safeSerialize({
        ...parsedExif.tags,
        imageSize: parsedExif.imageSize || manualDimensions || {},
        thumbnailOffset: parsedExif.thumbnailOffset || null,
        thumbnailLength: parsedExif.thumbnailLength || null,
        hasThumbnail: Boolean(parsedExif.thumbnailLength),
      });
      embeddedPayload = parseEmbeddedPayload(
        parsedExif.tags?.UserComment || parsedExif.tags?.XPComment || parsedExif.tags?.ImageDescription
      );
      hiddenMetadata = mergeEmbeddedMetadata(hiddenMetadata, embeddedPayload);
    } catch (_error) {
      hiddenMetadata = {
        exifError: "No EXIF block could be parsed from this image.",
        imageSize: getImageDimensions(file.buffer, mimeType) || {},
      };
    }

    if (mimeType === "image/png") {
      const textChunks = extractPngTextChunks(file.buffer);
      const metaInsightChunk = textChunks.find((entry) => entry.keyword === "MetaInsight");
      if (metaInsightChunk?.text) {
        embeddedPayload = parseEmbeddedPayload(metaInsightChunk.text) || embeddedPayload;
        hiddenMetadata = mergeEmbeddedMetadata(hiddenMetadata, embeddedPayload);
      }

      if (textChunks.length > 0) {
        hiddenMetadata = safeSerialize({
          ...hiddenMetadata,
          pngTextChunks: textChunks.reduce((accumulator, entry) => {
            accumulator[entry.keyword] = entry.text;
            return accumulator;
          }, {}),
        });
      }
    }
  } else if (textExtensions.has(extension) || mimeType.startsWith("text/")) {
    const parsedTextPayload = extractEmbeddedTextPayload(file.buffer.toString("utf8"), extension);
    extractedContent = parsedTextPayload.content;
    embeddedPayload = parsedTextPayload.payload;
    hiddenMetadata = mergeEmbeddedMetadata(hiddenMetadata, embeddedPayload);
  } else {
    extractedContent = file.buffer.toString("utf8");
  }

  const embeddedFileSystem = embeddedPayload?.fileSystem || {};
  const resolvedFileSystem = {
    name: file.originalname,
    size: `${(file.size / 1024).toFixed(2)} KB`,
    created: new Date().toISOString(),
    modified: lastModified,
    ...safeSerialize(embeddedFileSystem),
  };

  return {
    name: file.originalname,
    extension,
    mimeType,
    size: file.size,
    type: detectContentKind(extension, mimeType, extractedContent),
    originalFormat: extension.replace(".", "") || "bin",
    originalContent: extractedContent,
    currentContent: extractedContent,
    originalBinary,
    integrity: computeIntegrity(file.buffer),
    forensicNotes: [],
    lastSavedAt: new Date().toISOString(),
    metadata: {
      fileSystem: resolvedFileSystem,
      hidden: hiddenMetadata,
      steganography: mimeType.startsWith("image/")
        ? buildSteganographyReport(file)
        : {
            suspicious: false,
            score: 0,
            reasons: ["Steganography check is only relevant for supported image uploads."],
            recommendation: "Upload a JPEG or PNG to run the image-focused heuristic.",
          },
    },
  };
}

function appendRevision(record, label, masterFile) {
  return [
    {
      revisionId: crypto.randomUUID(),
      label,
      savedAt: new Date().toISOString(),
      integrity: masterFile.integrity,
      fileName: masterFile.name,
    },
    ...(record.revisions || []),
  ].slice(0, 25);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "MetaInsight API",
    aiMode: openai ? "live-openai" : "mock-local",
    storageMode,
  });
});

app.get("/api/cases", async (_req, res) => {
  try {
    res.json({ cases: await listCases(), storageMode });
  } catch (error) {
    res.status(500).json({ error: "Unable to list cases.", details: error.message });
  }
});

app.get("/api/cases/:caseId", async (req, res) => {
  try {
    const record = await getCaseById(req.params.caseId);
    if (!record) {
      return res.status(404).json({ error: "Case not found." });
    }

    return res.json({
      caseId: record.caseId,
      masterFile: record.masterFile,
      revisions: record.revisions || [],
      aiHistory: record.aiHistory || [],
      updatedAt: record.updatedAt || record.masterFile?.lastSavedAt,
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load case.", details: error.message });
  }
});

app.post("/api/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const masterFile = await buildMasterFile(req.file, req.body.lastModified);
    const caseId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      caseId,
      masterFile,
      revisions: appendRevision({ revisions: [] }, "Initial ingest", masterFile),
      aiHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    await upsertCaseRecord(record);
    return res.json({
      success: true,
      caseId,
      storageMode,
      file: masterFile,
      revisions: record.revisions,
      aiHistory: [],
    });
  } catch (error) {
    console.error("Analyze route failed:", error);
    return res.status(500).json({ error: "Unable to analyze file.", details: error.message });
  }
});

app.post("/api/cases/:caseId/save", async (req, res) => {
  try {
    const record = await getCaseById(req.params.caseId);
    if (!record) {
      return res.status(404).json({ error: "Case not found." });
    }

    const incomingMaster = req.body.masterFile;
    if (!incomingMaster) {
      return res.status(400).json({ error: "masterFile payload is required." });
    }

    const nextMaster = {
      ...record.masterFile,
      ...incomingMaster,
      metadata: {
        ...(record.masterFile?.metadata || {}),
        ...(incomingMaster?.metadata || {}),
      },
      lastSavedAt: new Date().toISOString(),
    };

    const nextRecord = {
      ...record,
      masterFile: nextMaster,
      revisions: appendRevision(record, req.body.label || "Manual save", nextMaster),
      updatedAt: new Date().toISOString(),
    };

    await upsertCaseRecord(nextRecord);
    return res.json({
      success: true,
      caseId: nextRecord.caseId,
      masterFile: nextMaster,
      revisions: nextRecord.revisions,
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save case.", details: error.message });
  }
});

app.post("/api/cases/:caseId/rewrite", async (req, res) => {
  try {
    const record = await getCaseById(req.params.caseId);
    if (!record) {
      return res.status(404).json({ error: "Case not found." });
    }

    const incomingMaster = req.body.masterFile || record.masterFile;
    const preserveName = Boolean(req.body.preserveName);
    const masterFile = {
      ...record.masterFile,
      ...incomingMaster,
      metadata: {
        ...(record.masterFile?.metadata || {}),
        ...(incomingMaster?.metadata || {}),
      },
    };

    const artifact = await buildRewrittenArtifact(masterFile);
    const integrity = computeIntegrity(artifact.buffer);
    const nextName = preserveName ? masterFile.name : artifact.filename;
    const rewrittenMaster = {
      ...masterFile,
      name: nextName,
      mimeType: artifact.mimeType,
      size: artifact.buffer.length,
      integrity,
      rewrittenBinary: `data:${artifact.mimeType};base64,${artifact.buffer.toString("base64")}`,
      lastSavedAt: new Date().toISOString(),
    };

    const nextRecord = {
      ...record,
      masterFile: rewrittenMaster,
      revisions: appendRevision(record, "Forensic rewrite export", rewrittenMaster),
      updatedAt: new Date().toISOString(),
    };

    await upsertCaseRecord(nextRecord);
    res.setHeader("Content-Type", artifact.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${nextName}"`);
    res.setHeader("X-MetaInsight-Case-Id", nextRecord.caseId);
    res.setHeader("X-MetaInsight-SHA256", integrity.sha256);
    return res.send(artifact.buffer);
  } catch (error) {
    console.error("Rewrite route failed:", error);
    return res.status(500).json({ error: "Unable to rewrite file.", details: error.message });
  }
});

app.post("/api/ai/explain", async (req, res) => {
  try {
    const { content = "", filename = "uploaded-file", mode = "text", caseId } = req.body || {};
    let insight = null;
    let provider = "mock-local";

    if (openai) {
      try {
        insight = await generateRealTextInsight({ filename, mode, content });
        provider = "openai";
      } catch (error) {
        console.warn("OpenAI text insight failed, using fallback:", error.message);
      }
    }

    if (!insight) {
      await delay(700);
      insight = buildExplainSummary({ mode, filename, content });
    }

    if (caseId) {
      const record = await getCaseById(caseId);
      if (record) {
        record.aiHistory = [
          {
            generatedAt: new Date().toISOString(),
            provider,
            mode,
            insight,
          },
          ...(record.aiHistory || []),
        ].slice(0, 20);
        record.updatedAt = new Date().toISOString();
        await upsertCaseRecord(record);
      }
    }

    return res.json({ provider, mode, generatedAt: new Date().toISOString(), insight });
  } catch (error) {
    console.error("AI explain route failed:", error);
    return res.status(500).json({ error: "Unable to generate textual insight.", details: error.message });
  }
});

app.post("/api/ai/detect-content", async (req, res) => {
  try {
    const {
      filename = "uploaded-file",
      mode = "text",
      content = "",
      imageDataUrl = "",
      metadata = {},
      currentContent = "",
    } = req.body || {};

    if (mode === "image") {
      let detection = null;
      let provider = "mock-local";

      if (imageDataUrl) {
        try {
          detection = await detectImageTextWithOCR(imageDataUrl);
          provider = "ocr";
        } catch (error) {
          console.warn("OCR image text detection failed, trying vision fallback:", error.message);
        }
      }

      if (!detection && openai && imageDataUrl) {
        try {
          detection = await detectImageTextWithAI({ filename, imageDataUrl, metadata });
          provider = "openai";
        } catch (error) {
          console.warn("Image text detection failed, using fallback:", error.message);
        }
      }

      if (!detection) {
        await delay(500);
        detection = fallbackImageDetection({ filename, metadata });
      }

      return res.json({
        provider,
        mode,
        generatedAt: new Date().toISOString(),
        detection,
      });
    }

    const extractedText = currentContent || content || "";
    const normalizedMode = mode === "code" ? "code" : "document";
    return res.json({
      provider: "direct-extraction",
      mode: normalizedMode,
      generatedAt: new Date().toISOString(),
      detection: {
        hasReadableText: extractedText.trim().length > 0,
        extractedText,
        summary:
          extractedText.trim().length > 0
            ? "Readable text was extracted successfully and is ready for selective encryption."
            : "No readable content could be extracted for encryption.",
      },
    });
  } catch (error) {
    console.error("AI detect-content route failed:", error);
    return res.status(500).json({ error: "Unable to detect content.", details: error.message });
  }
});

app.post("/api/ai/explain-code", async (req, res) => {
  try {
    const { filename = "uploaded-code", content = "" } = req.body || {};
    let walkthrough = null;
    let provider = "mock-local";

    if (openai) {
      try {
        walkthrough = await generateRealCodeWalkthrough({ filename, content });
        provider = "openai";
      } catch (error) {
        console.warn("Detailed code walkthrough failed, using fallback:", error.message);
      }
    }

    if (!walkthrough) {
      await delay(600);
      walkthrough = buildFallbackCodeWalkthrough({ filename, content });
    }

    return res.json({
      provider,
      generatedAt: new Date().toISOString(),
      walkthrough,
    });
  } catch (error) {
    console.error("AI explain-code route failed:", error);
    return res.status(500).json({ error: "Unable to explain code.", details: error.message });
  }
});

app.post("/api/ai/vision", async (req, res) => {
  try {
    const {
      filename = "uploaded-image",
      metadata = {},
      steganography = {},
      imageDataUrl = "",
      caseId,
    } = req.body || {};
    let insight = null;
    let provider = "mock-local";
    let fallbackReason = "";
    let fallbackCode = "";

    if (openai) {
      try {
        insight = await generateRealVisionInsight({ filename, metadata, imageDataUrl });
        provider = "openai";
      } catch (error) {
        fallbackReason = error.message || "Vision request failed.";
        if (String(error?.message || "").includes("429")) {
          fallbackCode = "quota_exceeded";
        } else if (String(error?.message || "").toLowerCase().includes("model")) {
          fallbackCode = "model_error";
        } else {
          fallbackCode = "vision_request_failed";
        }
        console.warn("OpenAI vision insight failed, using fallback:", error.message);
      }
    }

    if (!insight) {
      await delay(850);
      insight = buildVisionSummary({ filename, metadata, steganography });
    }

    if (caseId) {
      const record = await getCaseById(caseId);
      if (record) {
        record.aiHistory = [
          {
            generatedAt: new Date().toISOString(),
            provider,
            mode: "image",
            insight,
          },
          ...(record.aiHistory || []),
        ].slice(0, 20);
        record.updatedAt = new Date().toISOString();
        await upsertCaseRecord(record);
      }
    }

    return res.json({
      provider,
      mode: "image",
      generatedAt: new Date().toISOString(),
      insight,
      fallbackReason,
      fallbackCode,
    });
  } catch (error) {
    console.error("AI vision route failed:", error);
    return res.status(500).json({ error: "Unable to generate visual insight.", details: error.message });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: "Upload failed.", details: error.message });
  }

  console.error("Unhandled server error:", error);
  return res.status(500).json({ error: "Unexpected server error.", details: error.message });
});

connectDatabase().finally(() => {
  app.listen(PORT, () => {
    console.log(`MetaInsight API listening on port ${PORT}`);
  });
});
