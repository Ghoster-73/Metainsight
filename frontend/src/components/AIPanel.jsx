import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bot, BrainCircuit, Download, FileCode2, LoaderCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function detectMode(masterFile) {
  if (masterFile.mimeType?.startsWith("image/")) {
    return "image";
  }

  const content = masterFile.currentContent || masterFile.originalContent || "";
  const codeSignal = /(?:\bfunction\b|\bimport\b|\bexport\b|\bconst\b|=>|class\s+\w+)/.test(content);

  if (codeSignal || masterFile.type === "code") {
    return "code";
  }

  return "text";
}

function toDownloadText(result, walkthrough) {
  const blocks = [];
  if (result) {
    const insight = result.insight || {};
    blocks.push(
      insight.title || "MetaInsight AI Output",
      "",
      `Generated At: ${result.generatedAt || ""}`,
      `Mode: ${result.mode || ""}`,
      "",
      "Overview",
      insight.overview || "",
      "",
      "Scene Description",
      insight.sceneDescription || "",
      "",
      "Highlights",
      ...(insight.highlights || []),
      "",
      "Risks",
      ...(insight.risks || []),
      ""
    );
    if (insight.sample) {
      blocks.push("Sample", insight.sample, "");
    }
    if (insight.metadataSnapshot) {
      blocks.push("Metadata Snapshot", insight.metadataSnapshot.join(", "), "");
    }
  }

  if (walkthrough) {
    blocks.push(
      walkthrough.title,
      "",
      walkthrough.overview,
      "",
      "Code Sections",
      ...walkthrough.sections.flatMap((section) => [`${section.heading}`, section.explanation, ""]),
      "Risks",
      ...(walkthrough.risks || [])
    );
  }

  return blocks.filter(Boolean).join("\n");
}

function contentPreviewText(selectedMode, detectedText, masterFile) {
  if (detectedText) {
    return detectedText;
  }

  if (selectedMode === "image") {
    return "Generate Insight to let MetaInsight decide whether the image contains readable text or should be treated as a visual scene.";
  }

  return masterFile.currentContent || masterFile.originalContent || "No text available.";
}

function AIPanel({ masterFile, caseId, aiHistory = [], onInsight }) {
  const autoDetected = useMemo(() => detectMode(masterFile), [masterFile]);
  const [selectedMode, setSelectedMode] = useState(autoDetected);
  const [loading, setLoading] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [result, setResult] = useState(null);
  const [walkthrough, setWalkthrough] = useState(null);
  const [detectedText, setDetectedText] = useState("");
  const [error, setError] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [fallbackCode, setFallbackCode] = useState("");

  useEffect(() => {
    setSelectedMode(autoDetected);
    setResult(null);
    setWalkthrough(null);
    setDetectedText("");
    setError("");
    setFallbackNotice("");
    setFallbackCode("");
  }, [autoDetected, masterFile]);

  const generateInsight = async () => {
    setLoading(true);
    setError("");
    setFallbackNotice("");
    setFallbackCode("");

    try {
      if (selectedMode === "image") {
        const detectionResponse = await axios.post(`${API_BASE}/api/ai/detect-content`, {
          filename: masterFile.name,
          mode: "image",
          metadata: masterFile.metadata?.hidden || {},
          imageDataUrl: masterFile.originalBinary || masterFile.rewrittenBinary || "",
        });

        const textCandidate = detectionResponse.data?.detection?.extractedText || "";
        setDetectedText(textCandidate);

        if (textCandidate.trim()) {
          const response = await axios.post(`${API_BASE}/api/ai/explain`, {
            caseId,
            filename: masterFile.name,
            content: textCandidate,
            mode: "text",
          });

          setResult({
            ...response.data,
            sourceMode: "image-text",
          });
          setFallbackNotice("");
          setFallbackCode("");
          onInsight?.({
            generatedAt: response.data.generatedAt,
            provider: response.data.provider,
            mode: "image-text",
            insight: response.data.insight,
          });
        } else {
          const response = await axios.post(`${API_BASE}/api/ai/vision`, {
            caseId,
            filename: masterFile.name,
            metadata: {
              ...(masterFile.metadata?.hidden || {}),
              extractedText: textCandidate,
            },
            steganography: masterFile.metadata?.steganography || {},
            imageDataUrl: masterFile.originalBinary || masterFile.rewrittenBinary || "",
          });

          setResult(response.data);
          setFallbackNotice(response.data?.fallbackReason || "");
          setFallbackCode(response.data?.fallbackCode || "");
          onInsight?.({
            generatedAt: response.data.generatedAt,
            provider: response.data.provider,
            mode: response.data.mode,
            insight: response.data.insight,
          });
        }
      } else {
        const content = masterFile.currentContent || masterFile.originalContent || "";
        setDetectedText(content);
        const response = await axios.post(`${API_BASE}/api/ai/explain`, {
          caseId,
          filename: masterFile.name,
          content,
          mode: selectedMode,
        });

        setResult(response.data);
        setFallbackNotice("");
        setFallbackCode("");
        onInsight?.({
          generatedAt: response.data.generatedAt,
          provider: response.data.provider,
          mode: response.data.mode,
          insight: response.data.insight,
        });
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          requestError.message ||
          "AI request failed."
      );
    } finally {
      setLoading(false);
    }
  };

  const explainCode = async () => {
    setExplaining(true);
    setError("");

    try {
      const response = await axios.post(`${API_BASE}/api/ai/explain-code`, {
        filename: masterFile.name,
        content: masterFile.currentContent || masterFile.originalContent || "",
      });
      setWalkthrough(response.data.walkthrough);
    } catch (requestError) {
      setError(
        requestError.response?.data?.error ||
          requestError.message ||
          "Code explain request failed."
      );
    } finally {
      setExplaining(false);
    }
  };

  const downloadLocalInsight = () => {
    const payload = toDownloadText(result, walkthrough);
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${masterFile.name.replace(/\.[^/.]+$/, "")}_ai_insight.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Bot className="text-cyan-300" size={20} />
            <h2 className="text-xl font-semibold text-white">AI Intelligence</h2>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Generate summaries for text, code, and images. Code files also support a deeper explain flow, and images try
            to separate readable document text from purely visual scenes.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={generateInsight}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <LoaderCircle className="animate-spin" size={16} /> : <BrainCircuit size={16} />}
            Generate Insight
          </button>

          {selectedMode === "code" ? (
            <button
              type="button"
              onClick={explainCode}
              disabled={explaining}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {explaining ? <LoaderCircle className="animate-spin" size={16} /> : <FileCode2 size={16} />}
              Explain Code
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {["code", "text", "image"].map((mode) => {
          const active = selectedMode === mode;
          const detected = autoDetected === mode;

          return (
            <button
              key={mode}
              type="button"
              onClick={() => setSelectedMode(mode)}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                active
                  ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              {mode.toUpperCase()}
              {detected ? " | auto-detected" : ""}
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[0.78fr_1.22fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Context Snapshot</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Filename", masterFile.name],
              ["MIME Type", masterFile.mimeType],
              ["Auto-Detected Mode", autoDetected],
              ["Selected Mode", selectedMode],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
                <p className="mt-2 text-sm text-slate-200 break-words">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-medium text-white">Extracted / Visible Content</p>
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                {contentPreviewText(selectedMode, detectedText, masterFile)}
              </pre>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-medium text-white">Case AI History</p>
            <div className="mt-3 space-y-2">
              {aiHistory.length > 0 ? (
                aiHistory.slice(0, 5).map((entry, index) => (
                  <div key={`${entry.generatedAt}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3">
                    <p className="text-sm text-white">{entry.insight?.title || "AI insight"}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.mode} | {entry.provider} | {new Date(entry.generatedAt).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No AI runs stored for this case yet.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500">Insight Output</p>
            <button
              type="button"
              onClick={downloadLocalInsight}
              disabled={!result && !walkthrough}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={16} />
              Download AI Output
            </button>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {!error && fallbackNotice ? (
            <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              <div className="font-medium">
                {fallbackCode === "quota_exceeded"
                  ? "Live image description is unavailable because the OpenAI account has no remaining API quota."
                  : "Live vision insight was unavailable, so MetaInsight used the fallback image summary instead."}
              </div>
              <div className="mt-2 text-amber-50/80">
                {fallbackCode === "quota_exceeded"
                  ? "Add API credits or enable billing for the current OpenAI project, then restart the backend and run Generate Insight again."
                  : fallbackNotice}
              </div>
              {fallbackCode !== "quota_exceeded" ? null : (
                <div className="mt-3 text-xs text-amber-50/70">
                  Original API message: {fallbackNotice}
                </div>
              )}
            </div>
          ) : null}

          {result ? (
            <div className="mt-5 space-y-5">
              {selectedMode === "image" && detectedText ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <h3 className="text-lg font-semibold text-white">{result.insight?.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{result.insight?.overview}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <p className="text-sm font-medium text-emerald-200">Extracted Text from Image</p>
                    <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-xs leading-6 text-slate-300">
                      {detectedText}
                    </pre>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-lg font-semibold text-white">{result.insight?.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{result.insight?.overview}</p>
                </div>
              )}

              {result.insight?.sceneDescription ? (
                <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4">
                  <p className="text-sm font-medium text-sky-200">What Is Happening In The Image</p>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{result.insight.sceneDescription}</p>
                </div>
              ) : null}

              <div>
                <p className="text-sm font-medium text-cyan-200">Highlights</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {(result.insight?.highlights || []).map((item) => (
                    <li key={item} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {result.insight?.interpretation ? (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                  <p className="text-sm font-medium text-emerald-200">What This Text Is</p>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{result.insight.interpretation}</p>
                </div>
              ) : null}

              {result.insight?.usage ? (
                <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4">
                  <p className="text-sm font-medium text-sky-200">What It Is Used For</p>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{result.insight.usage}</p>
                </div>
              ) : null}

              <div>
                <p className="text-sm font-medium text-amber-200">Risks</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {(result.insight?.risks || []).map((item) => (
                    <li key={item} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {result.insight?.sample ? (
                <div>
                  <p className="text-sm font-medium text-emerald-200">Sample</p>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs leading-6 text-slate-300">
                    {result.insight.sample}
                  </pre>
                </div>
              ) : null}

              {result.insight?.metadataSnapshot ? (
                <div>
                  <p className="text-sm font-medium text-fuchsia-200">Metadata Snapshot</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.insight.metadataSnapshot.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
              Generate insight to populate the contextual summary, extracted content view, and AI export.
            </div>
          )}

          {walkthrough ? (
            <div className="mt-6 space-y-4 rounded-3xl border border-violet-400/20 bg-violet-400/5 p-5">
              <div>
                <h3 className="text-lg font-semibold text-white">{walkthrough.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-300">{walkthrough.overview}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-violet-200">Code Breakdown</p>
                <div className="mt-3 space-y-3">
                  {(walkthrough.sections || []).map((section) => (
                    <div key={section.heading} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                      <p className="text-sm font-medium text-white">{section.heading}</p>
                      <p className="mt-2 text-sm leading-7 text-slate-300">{section.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default AIPanel;
