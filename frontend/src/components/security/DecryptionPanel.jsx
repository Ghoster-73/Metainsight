import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Unlock } from "lucide-react";
import { decryptText } from "../../utils/crypto";

function buildTextView(masterFile, source) {
  if (source) {
    return source;
  }

  if (masterFile.mimeType?.startsWith("image/")) {
    return "";
  }

  return "";
}

function parseEncryptedBlocks(text) {
  const pattern =
    /\[ENCRYPTED_BLOCK_START\]\s*salt:(.+?)\s*iv:(.+?)\s*([\s\S]*?)\s*\[ENCRYPTED_BLOCK_END\]/g;
  const blocks = [];
  let match = null;

  while ((match = pattern.exec(text)) !== null) {
    blocks.push({
      start: match.index,
      end: pattern.lastIndex,
      salt: match[1].trim(),
      iv: match[2].trim(),
      cipherText: match[3].trim(),
      raw: match[0],
    });
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

function DecryptionPanel({ masterFile }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [selectedIndexes, setSelectedIndexes] = useState([]);
  const [decryptedBlocks, setDecryptedBlocks] = useState([]);

  const sourcePreview = useMemo(
    () => buildTextView(masterFile, masterFile.currentContent),
    [masterFile]
  );
  const encryptedBlocks = useMemo(() => parseEncryptedBlocks(sourcePreview), [sourcePreview]);
  const decryptionPreview = useMemo(
    () => buildPreviewFromBlocks(sourcePreview, decryptedBlocks),
    [sourcePreview, decryptedBlocks]
  );

  useEffect(() => {
    setPassword("");
    setStatus("");
    setError("");
    setSelectedIndexes([]);
    setDecryptedBlocks([]);
  }, [masterFile]);

  const toggleBlockSelection = (index, event) => {
    setSelectedIndexes((current) => {
      if (event.ctrlKey || event.metaKey) {
        return current.includes(index)
          ? current.filter((item) => item !== index)
          : [...current, index].sort((a, b) => a - b);
      }

      return [index];
    });
  };

  const handleDecrypt = async () => {
    setError("");
    setStatus("");

    try {
      const indexesToDecrypt = selectedIndexes.filter(
        (index) => !decryptedBlocks.some((block) => block.index === index)
      );

      if (!indexesToDecrypt.length) {
        throw new Error("Select one or more encrypted blocks from the Original Preview before decrypting.");
      }

      const nextBlocks = await Promise.all(
        indexesToDecrypt.map(async (index) => {
          const block = encryptedBlocks[index];
          const decryptedText = await decryptText(
            block.cipherText,
            password,
            block.iv,
            block.salt
          );

          return {
            ...block,
            index,
            decryptedText,
          };
        })
      );

      const merged = [...decryptedBlocks, ...nextBlocks].sort((a, b) => a.start - b.start);
      setDecryptedBlocks(merged);
      setSelectedIndexes([]);
      setStatus(`${nextBlocks.length} encrypted block${nextBlocks.length > 1 ? "s" : ""} decrypted successfully.`);
    } catch (decryptionError) {
      setError(decryptionError.message || "Decryption failed.");
    }
  };

  const clearPreview = () => {
    setSelectedIndexes([]);
    setDecryptedBlocks([]);
    setStatus("Decryption preview cleared for a new decryption pass.");
    setError("");
  };

  const downloadDecrypted = () => {
    const payload = decryptionPreview || "";
    if (!payload.trim()) {
      setError("Decrypt some content first before downloading the decrypted output.");
      setStatus("");
      return;
    }

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = (masterFile.name || "decrypted_output").replace(/\.[^/.]+$/, "");

    link.href = url;
    link.download = `${baseName}_decrypted.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Decrypted output downloaded successfully.");
    setError("");
  };

  const hasEncryptedBlocks = encryptedBlocks.length > 0;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Secure Decryption Workspace</h2>
          <p className="text-sm text-slate-400">
            Select encrypted blocks in the original preview on the left, then decrypt them to build a mixed clear-text and encrypted output preview on the right.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter decryption password"
            className="min-w-[240px] rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={handleDecrypt}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
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
            onClick={downloadDecrypted}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
          >
            <Download size={16} />
            Download Decrypted
          </button>
        </div>
      </div>

      {(status || error) && (
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
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Original Preview</p>
            {selectedIndexes.length > 0 ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                {selectedIndexes.length} block{selectedIndexes.length > 1 ? "s" : ""} selected
              </span>
            ) : null}
          </div>

          <div className="mt-4 min-h-[520px] space-y-3 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4 font-mono text-sm leading-6 outline-none">
            {hasEncryptedBlocks ? (
              encryptedBlocks.map((block, index) => {
                const isSelected = selectedIndexes.includes(index);
                const isDecrypted = decryptedBlocks.some((entry) => entry.index === index);

                return (
                  <button
                    key={`${block.start}-${block.end}`}
                    type="button"
                    onClick={(event) => toggleBlockSelection(index, event)}
                    className={`block w-full whitespace-pre-wrap rounded-2xl border px-4 py-3 text-left transition ${
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
              })
            ) : (
              <div className="whitespace-pre-wrap text-slate-300">
                No encrypted blocks were found in the current file. Use the Encryption page first, or load a file that already contains MetaInsight encrypted blocks.
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Click an encrypted block to select it. Hold <span className="font-semibold text-slate-400">Ctrl</span> to add non-adjacent encrypted blocks before decrypting.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Decryption Preview</p>
          <div className="mt-4 min-h-[520px] whitespace-pre-wrap rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 font-mono text-sm leading-6 outline-none">
            {decryptionPreview ? (
              renderMixedPreview(sourcePreview, decryptedBlocks)
            ) : (
              <span className="text-rose-300">
                Select encrypted blocks in the Original Preview and press Decrypt. The decrypted portions will appear here while the remaining encrypted content stays visible.
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default DecryptionPanel;
