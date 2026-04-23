import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  BrainCircuit,
  Download,
  LockKeyhole,
  RefreshCw,
  Unlock,
} from "lucide-react";
import { decryptText, encryptText } from "../../utils/crypto";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function buildTextView(masterFile, source) {
  if (source) {
    return source;
  }

  if (masterFile.mimeType?.startsWith("image/")) {
    return "";
  }

  return "";
}

function getMode(masterFile) {
  if (masterFile.mimeType?.startsWith("image/")) {
    return "image";
  }
  if (masterFile.type === "code") {
    return "code";
  }
  return "document";
}

function tokenizeSource(text) {
  const tokens = [];
  const pattern = /(\s+|[^\s]+)/g;
  let match = null;

  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    const start = match.index;
    tokens.push({
      value,
      start,
      end: start + value.length,
      isWhitespace: /^\s+$/.test(value),
    });
  }

  return tokens;
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function mergeRanges(ranges) {
  if (!ranges.length) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function buildPreviewFromRanges(sourceText, encryptedRanges) {
  if (!encryptedRanges.length) {
    return "";
  }

  const sorted = [...encryptedRanges].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let output = "";

  sorted.forEach((range) => {
    output += sourceText.slice(cursor, range.start);
    output += range.block;
    cursor = range.end;
  });

  output += sourceText.slice(cursor);
  return output;
}

function isTokenWithinRanges(token, ranges) {
  return ranges.some((range) => rangesOverlap({ start: token.start, end: token.end }, range));
}

function renderEncryptionPreview(sourceText, encryptedRanges) {
  if (!sourceText) {
    return null;
  }

  if (!encryptedRanges.length) {
    return <span className="text-emerald-300">{sourceText}</span>;
  }

  const sorted = [...encryptedRanges].sort((a, b) => a.start - b.start);
  const pieces = [];
  let cursor = 0;

  sorted.forEach((range, index) => {
    if (cursor < range.start) {
      pieces.push(
        <span key={`plain-${index}-${cursor}`} className="text-emerald-300">
          {sourceText.slice(cursor, range.start)}
        </span>
      );
    }

    pieces.push(
      <span key={`enc-${index}`} className="text-rose-300">
        {range.block}
      </span>
    );
    cursor = range.end;
  });

  if (cursor < sourceText.length) {
    pieces.push(
      <span key={`tail-${cursor}`} className="text-emerald-300">
        {sourceText.slice(cursor)}
      </span>
    );
  }

  return pieces;
}

function parseEncryptedBlocks(text) {
  const blocks = [];
  const startMarker = "[ENCRYPTED_BLOCK_START]";
  const endMarker = "[ENCRYPTED_BLOCK_END]";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(startMarker, cursor);
    if (start === -1) {
      break;
    }

    const end = text.indexOf(endMarker, start);
    if (end === -1) {
      break;
    }

    const raw = text.slice(start, end + endMarker.length);
    const innerLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const saltLine = innerLines.find((line) => line.startsWith("salt:"));
    const ivLine = innerLines.find((line) => line.startsWith("iv:"));
    const cipherLines = innerLines.filter(
      (line) =>
        line !== startMarker &&
        line !== endMarker &&
        !line.startsWith("salt:") &&
        !line.startsWith("iv:")
    );

    blocks.push({
      start,
      end: end + endMarker.length,
      salt: saltLine ? saltLine.slice(5).trim() : "",
      iv: ivLine ? ivLine.slice(3).trim() : "",
      cipherText: cipherLines.join(""),
      raw,
    });

    cursor = end + endMarker.length;
  }

  return blocks;
}

function buildPreviewFromBlocks(sourceText, decryptedBlocks) {
  if (!decryptedBlocks.length) {
    return "";
  }

  const sorted = [...decryptedBlocks].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let output = "";

  sorted.forEach((block) => {
    output += sourceText.slice(cursor, block.start);
    output += block.decryptedText;
    cursor = block.end;
  });

  output += sourceText.slice(cursor);
  return output;
}

function renderMixedPreview(sourceText, decryptedBlocks) {
  if (!sourceText) {
    return null;
  }

  if (!decryptedBlocks.length) {
    return <span className="text-rose-300">{sourceText}</span>;
  }

  const sorted = [...decryptedBlocks].sort((a, b) => a.start - b.start);
  const pieces = [];
  let cursor = 0;

  sorted.forEach((block, index) => {
    if (cursor < block.start) {
      pieces.push(
        <span key={`enc-${index}-${cursor}`} className="text-rose-300">
          {sourceText.slice(cursor, block.start)}
        </span>
      );
    }

    pieces.push(
      <span key={`dec-${index}`} className="text-emerald-300">
        {block.decryptedText}
      </span>
    );
    cursor = block.end;
  });

  if (cursor < sourceText.length) {
    pieces.push(
      <span key={`tail-${cursor}`} className="text-rose-300">
        {sourceText.slice(cursor)}
      </span>
    );
  }

  return pieces;
}

function EncryptionPanel({ masterFile }) {
  const dragStateRef = useRef({ active: false, additive: false, anchor: null, latest: null });
  const [sourcePreview, setSourcePreview] = useState(buildTextView(masterFile, masterFile.currentContent));
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedSummary, setDetectedSummary] = useState("");
  const [selectedRanges, setSelectedRanges] = useState([]);
  const [encryptedRanges, setEncryptedRanges] = useState([]);
  const [selectedBlockIndexes, setSelectedBlockIndexes] = useState([]);
  const [decryptedBlocks, setDecryptedBlocks] = useState([]);

  useEffect(() => {
    setSourcePreview(buildTextView(masterFile, masterFile.currentContent));
    setPassword("");
    setStatus("");
    setError("");
    setDetectedSummary("");
    setSelectedRanges([]);
    setEncryptedRanges([]);
    setSelectedBlockIndexes([]);
    setDecryptedBlocks([]);
  }, [masterFile]);

  useEffect(() => {
    const stopDrag = () => {
      dragStateRef.current.active = false;
    };

    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);

  const tokens = useMemo(() => tokenizeSource(sourcePreview), [sourcePreview]);
  const sourceEncryptedBlocks = useMemo(() => parseEncryptedBlocks(sourcePreview), [sourcePreview]);
  const hasEncryptedBlocks = sourceEncryptedBlocks.length > 0;
  const encryptionPreview = useMemo(
    () => buildPreviewFromRanges(sourcePreview, encryptedRanges),
    [sourcePreview, encryptedRanges]
  );
  const decryptionPreview = useMemo(
    () => buildPreviewFromBlocks(sourcePreview, decryptedBlocks),
    [sourcePreview, decryptedBlocks]
  );

  const updateDraggedSelection = (token) => {
    const drag = dragStateRef.current;
    if (!drag.anchor) {
      return;
    }

    drag.latest = token;
    const nextRange = {
      start: Math.min(drag.anchor.start, token.start),
      end: Math.max(drag.anchor.end, token.end),
    };

    setSelectedRanges((current) => {
      const base = drag.additive ? current : [];
      const withoutOverlaps = base.filter((range) => !rangesOverlap(range, nextRange));
      return mergeRanges([...withoutOverlaps, nextRange]);
    });
  };

  const handleTokenMouseDown = (token, event) => {
    if (token.isWhitespace || hasEncryptedBlocks) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      active: true,
      additive: Boolean(event.ctrlKey || event.metaKey),
      anchor: token,
      latest: token,
    };
    updateDraggedSelection(token);
  };

  const handleTokenMouseEnter = (token) => {
    if (!dragStateRef.current.active || token.isWhitespace || hasEncryptedBlocks) {
      return;
    }

    updateDraggedSelection(token);
  };

  const toggleBlockSelection = (index, event) => {
    setSelectedBlockIndexes((current) => {
      if (event.ctrlKey || event.metaKey) {
        return current.includes(index)
          ? current.filter((item) => item !== index)
          : [...current, index].sort((a, b) => a - b);
      }

      return [index];
    });
  };

  const handleAiDetect = async () => {
    setDetecting(true);
    setError("");
    setStatus("");

    try {
      const mode = getMode(masterFile);
      const response = await axios.post(`${API_BASE}/api/ai/detect-content`, {
        filename: masterFile.name,
        mode,
        content: masterFile.originalContent || "",
        currentContent: masterFile.currentContent || "",
        metadata: masterFile.metadata?.hidden || {},
        imageDataUrl: masterFile.originalBinary || masterFile.rewrittenBinary || "",
      });

      const detection = response.data.detection;
      setDetectedSummary(detection.summary || "");
      setEncryptedRanges([]);
      setSelectedRanges([]);
      setSelectedBlockIndexes([]);
      setDecryptedBlocks([]);

      if (detection.hasReadableText) {
        setSourcePreview(detection.extractedText || "");
        setStatus("AI Detect extracted text into the original preview for selective encryption.");
      } else {
        setSourcePreview("");
        setStatus(detection.summary || "No useful text was found to encrypt.");
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          requestError.message ||
          "AI Detect failed."
      );
    } finally {
      setDetecting(false);
    }
  };

  const encryptPreview = async () => {
    setError("");
    setStatus("");

    try {
      if (hasEncryptedBlocks) {
        throw new Error("This preview currently contains encrypted blocks. Press New or load plain text before encrypting again.");
      }

      const rangesToEncrypt = selectedRanges.filter(
        (range) => !encryptedRanges.some((encryptedRange) => rangesOverlap(range, encryptedRange))
      );

      if (!rangesToEncrypt.length) {
        throw new Error("Select one or more word ranges from the Original Preview before encrypting.");
      }

      const payloads = await Promise.all(
        rangesToEncrypt.map(async (range) => {
          const payload = await encryptText(sourcePreview.slice(range.start, range.end), password);
          return {
            ...range,
            block: [
              "[ENCRYPTED_BLOCK_START]",
              `salt:${payload.salt}`,
              `iv:${payload.iv}`,
              payload.cipherText,
              "[ENCRYPTED_BLOCK_END]",
            ].join("\n"),
          };
        })
      );

      const merged = [...encryptedRanges, ...payloads].sort((a, b) => a.start - b.start);
      setEncryptedRanges(merged);
      setSelectedRanges([]);
      setStatus(`${payloads.length} selected segment${payloads.length > 1 ? "s" : ""} encrypted and placed into the preview.`);
    } catch (encryptionError) {
      setError(encryptionError.message || "Encryption failed.");
    }
  };

  const decryptPreview = async () => {
    setError("");
    setStatus("");

    try {
      if (!hasEncryptedBlocks) {
        throw new Error("No encrypted blocks were found in the current preview.");
      }

      const indexesToDecrypt = selectedBlockIndexes.filter(
        (index) => !decryptedBlocks.some((block) => block.index === index)
      );

      if (!indexesToDecrypt.length) {
        throw new Error("Select one or more encrypted blocks from the Original Preview before decrypting.");
      }

      const nextBlocks = await Promise.all(
        indexesToDecrypt.map(async (index) => {
          const block = sourceEncryptedBlocks[index];
          const decryptedText = await decryptText(block.cipherText, password, block.iv, block.salt);

          return {
            ...block,
            index,
            decryptedText,
          };
        })
      );

      const merged = [...decryptedBlocks, ...nextBlocks].sort((a, b) => a.start - b.start);
      setDecryptedBlocks(merged);
      setSelectedBlockIndexes([]);
      setStatus(`${nextBlocks.length} encrypted block${nextBlocks.length > 1 ? "s" : ""} decrypted successfully.`);
    } catch (decryptionError) {
      setError(decryptionError.message || "Decryption failed.");
    }
  };

  const clearPreview = () => {
    setEncryptedRanges([]);
    setSelectedRanges([]);
    setSelectedBlockIndexes([]);
    setDecryptedBlocks([]);
    setStatus("Workspace cleared for a new pass.");
    setError("");
  };

  const downloadOutput = () => {
    const payload = hasEncryptedBlocks ? decryptionPreview : encryptionPreview;
    if (!payload.trim()) {
      setError(`Create a ${hasEncryptedBlocks ? "decrypted" : "encrypted"} preview before downloading the output.`);
      setStatus("");
      return;
    }

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = (masterFile.name || "output").replace(/\.[^/.]+$/, "");

    link.href = url;
    link.download = `${baseName}_${hasEncryptedBlocks ? "decrypted" : "encrypted"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`${hasEncryptedBlocks ? "Decrypted" : "Encrypted"} output downloaded successfully.`);
    setError("");
  };

  const renderOriginalPreview = () => {
    if (!sourcePreview) {
      return (
        <div className="whitespace-pre-wrap text-slate-300">
          {masterFile.mimeType?.startsWith("image/")
            ? "Press AI Detect to extract readable text from this image. If the image is a normal scene, portrait, or landscape, MetaInsight will report that there is no useful text to encrypt."
            : "No original text was extracted for this file."}
        </div>
      );
    }

    if (hasEncryptedBlocks) {
      return sourceEncryptedBlocks.map((block, index) => {
        const isSelected = selectedBlockIndexes.includes(index);
        const isDecrypted = decryptedBlocks.some((entry) => entry.index === index);

        return (
          <button
            key={`${block.start}-${block.end}`}
            type="button"
            onClick={(event) => toggleBlockSelection(index, event)}
            className={`mb-3 block w-full whitespace-pre-wrap rounded-2xl border px-4 py-3 text-left font-mono text-sm leading-6 transition ${
              isDecrypted
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : isSelected
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                  : "border-slate-800 bg-slate-950 text-rose-300 hover:border-slate-700"
            }`}
          >
            {block.raw}
          </button>
        );
      });
    }

    return tokens.map((token, index) => {
      const isSelected = !token.isWhitespace && isTokenWithinRanges(token, selectedRanges);
      const isEncrypted = !token.isWhitespace && isTokenWithinRanges(token, encryptedRanges);

      return (
        <span
          key={`${index}-${token.start}`}
          onMouseDown={(event) => handleTokenMouseDown(token, event)}
          onMouseEnter={() => handleTokenMouseEnter(token)}
          className={token.isWhitespace ? "whitespace-pre-wrap" : `whitespace-pre-wrap rounded-sm ${
            isEncrypted
              ? "bg-rose-500/10 text-rose-300"
              : isSelected
                ? "bg-rose-500/10 text-rose-300"
                : "text-emerald-300"
          }`}
        >
          {token.value}
        </span>
      );
    });
  };

  const previewTitle = hasEncryptedBlocks ? "Decryption Preview" : "Encryption Preview";
  const previewBody = hasEncryptedBlocks ? decryptionPreview : encryptionPreview;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Secure Encryption Workspace</h2>
          <p className="text-sm text-slate-400">
            Use this panel for both encryption and decryption. Plain text can be selected and encrypted, while existing MetaInsight encrypted blocks can be selected and decrypted here too.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={hasEncryptedBlocks ? "Enter decryption password" : "Enter encryption password"}
            className="min-w-[240px] rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={handleAiDetect}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/20"
            disabled={detecting}
          >
            <BrainCircuit size={16} />
            {detecting ? "AI Detecting..." : "AI Detect"}
          </button>
          <button
            type="button"
            onClick={encryptPreview}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            <LockKeyhole size={16} />
            Encrypt
          </button>
          <button
            type="button"
            onClick={decryptPreview}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20"
          >
            <Unlock size={16} />
            Decrypt
          </button>
          <button
            type="button"
            onClick={clearPreview}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
          >
            <RefreshCw size={16} />
            New
          </button>
          <button
            type="button"
            onClick={downloadOutput}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
          >
            <Download size={16} />
            {hasEncryptedBlocks ? "Download Decrypted" : "Download Encrypted"}
          </button>
        </div>
      </div>

      {(status || error || detectedSummary) && (
        <div
          className={`mt-5 rounded-2xl border p-4 text-sm ${
            error
              ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <p>{error || status}</p>
          </div>
          {detectedSummary ? <p className="mt-2 text-xs text-current/80">{detectedSummary}</p> : null}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Original Preview</p>
            {!hasEncryptedBlocks && selectedRanges.length > 0 ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                {selectedRanges.length} range{selectedRanges.length > 1 ? "s" : ""} selected
              </span>
            ) : null}
            {hasEncryptedBlocks && selectedBlockIndexes.length > 0 ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                {selectedBlockIndexes.length} block{selectedBlockIndexes.length > 1 ? "s" : ""} selected
              </span>
            ) : null}
          </div>
          <div className="mt-4 min-h-[520px] rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4 font-mono text-sm leading-6 text-slate-200 select-none">
            {renderOriginalPreview()}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {hasEncryptedBlocks
              ? <>Click an encrypted block to select it. Hold <span className="font-semibold text-slate-400">Ctrl</span> to add non-adjacent encrypted blocks before decrypting.</>
              : <>Drag over words to select them. Hold <span className="font-semibold text-slate-400">Ctrl</span> and drag again somewhere else to add another selection with gaps between them.</>}
          </p>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">{previewTitle}</p>
          <div className="mt-4 min-h-[520px] whitespace-pre-wrap rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono text-sm leading-6 outline-none">
            {previewBody
              ? hasEncryptedBlocks
                ? renderMixedPreview(sourcePreview, decryptedBlocks)
                : renderEncryptionPreview(sourcePreview, encryptedRanges)
              : (
                <span className={hasEncryptedBlocks ? "text-rose-300" : "text-emerald-300"}>
                  {hasEncryptedBlocks
                    ? "Select encrypted blocks in the Original Preview and press Decrypt. The decrypted portions will appear here while the remaining encrypted content stays visible."
                    : "Select words in the Original Preview and press Encrypt. The encrypted portions will appear here while the remaining content stays readable."}
                </span>
              )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default EncryptionPanel;
