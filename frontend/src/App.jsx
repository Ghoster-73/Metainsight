import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { jsPDF } from "jspdf";
import {
  Archive,
  Bot,
  FileSearch,
  HardDriveDownload,
  Home,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import FileUpload from "./components/FileUpload";
import MetadataPanel from "./components/MetadataPanel";
import EncryptionPanel from "./components/security/EncryptionPanel";
import AIPanel from "./components/AIPanel";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const initialMasterFile = null;

function slugifyFilename(name) {
  return (name || "metainsight-file")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function extensionForFormat(format, masterFile) {
  if (format === "pdf") {
    return "pdf";
  }
  if (format === "txt") {
    return "txt";
  }
  if (format === "encrypted") {
    return "enc.txt";
  }
  return masterFile?.originalFormat || "txt";
}

function dataUriToBlob(dataUri, fallbackMime) {
  const [prefix, base64] = dataUri.split(",");
  const mimeMatch = prefix.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || fallbackMime || "application/octet-stream";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function buildDownloadBlob(format, masterFile) {
  const textPayload = masterFile?.currentContent || "";

  if (format === "encrypted") {
    return new Blob([textPayload], { type: "text/plain;charset=utf-8" });
  }

  if (format === "original") {
    if (masterFile?.rewrittenBinary) {
      return dataUriToBlob(masterFile.rewrittenBinary, masterFile.mimeType);
    }

    if (masterFile?.mimeType?.startsWith("image/") && masterFile.originalBinary) {
      return dataUriToBlob(masterFile.originalBinary, masterFile.mimeType);
    }
  }

  if (format === "pdf" || (format === "original" && masterFile?.mimeType === "application/pdf")) {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const wrappedLines = pdf.splitTextToSize(textPayload || "No textual content available.", 520);
    let y = 56;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);

    wrappedLines.forEach((line) => {
      if (y > 780) {
        pdf.addPage();
        y = 56;
      }
      pdf.text(line, 40, y);
      y += 18;
    });

    return pdf.output("blob");
  }

  return new Blob([textPayload], { type: "text/plain;charset=utf-8" });
}

function App() {
  const [route, setRoute] = useState("upload");
  const [activeTool, setActiveTool] = useState("metadata");
  const [masterFile, setMasterFile] = useState(initialMasterFile);
  const [caseId, setCaseId] = useState("");
  const [cases, setCases] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [aiHistory, setAiHistory] = useState([]);
  const [storageMode, setStorageMode] = useState("json-fallback");
  const [downloadFormat, setDownloadFormat] = useState("original");
  const [busyAction, setBusyAction] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  const navItems = useMemo(
    () => [
      { id: "metadata", label: "Metadata", icon: FileSearch },
      { id: "encryption", label: "Encryption", icon: ShieldCheck },
      { id: "ai", label: "AI Summary", icon: Bot },
    ],
    []
  );

  useEffect(() => {
    void fetchCases();
  }, []);

  useEffect(() => {
    if (!masterFile) {
      setRoute("upload");
      setActiveTool("metadata");
    }
  }, [masterFile]);

  const fetchCases = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/cases`);
      setCases(response.data.cases || []);
      setStorageMode(response.data.storageMode || "json-fallback");
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || "Unable to load cases.");
    }
  };

  const handleAnalysisComplete = (payload) => {
    setMasterFile(payload.file);
    setCaseId(payload.caseId);
    setRevisions(payload.revisions || []);
    setAiHistory(payload.aiHistory || []);
    setStorageMode(payload.storageMode || storageMode);
    setRoute("hub");
    setActiveTool("metadata");
    setStatusMessage("Evidence ingested and case created.");
    setError("");
    void fetchCases();
  };

  const handleMasterFileUpdate = (partialUpdate) => {
    setMasterFile((current) => ({
      ...current,
      ...partialUpdate,
      metadata: {
        ...(current?.metadata || {}),
        ...(partialUpdate?.metadata || {}),
      },
    }));
  };

  const loadCase = async (nextCaseId) => {
    try {
      setBusyAction(`load-${nextCaseId}`);
      const response = await axios.get(`${API_BASE}/api/cases/${nextCaseId}`);
      setCaseId(response.data.caseId);
      setMasterFile(response.data.masterFile);
      setRevisions(response.data.revisions || []);
      setAiHistory(response.data.aiHistory || []);
      setRoute("hub");
      setActiveTool("metadata");
      setError("");
      setStatusMessage("Case loaded successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || "Unable to load case.");
    } finally {
      setBusyAction("");
    }
  };

  const persistCase = async (label = "Manual save") => {
    if (!caseId || !masterFile) {
      return;
    }

    try {
      setBusyAction("save");
      const response = await axios.post(`${API_BASE}/api/cases/${caseId}/save`, {
        label,
        masterFile,
      });
      setMasterFile(response.data.masterFile);
      setRevisions(response.data.revisions || []);
      setStatusMessage(`Case saved: ${label}`);
      setError("");
      await fetchCases();
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || "Unable to save case.");
    } finally {
      setBusyAction("");
    }
  };

  const handleRewriteExport = async () => {
    if (!caseId || !masterFile) {
      return;
    }

    try {
      setBusyAction("rewrite");
      const response = await axios.post(`${API_BASE}/api/cases/${caseId}/rewrite`, { masterFile }, { responseType: "blob" });
      const disposition = response.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^\"]+)"?/i);
      const filename = match?.[1] || `${slugifyFilename(masterFile.name)}_rewritten.${masterFile.originalFormat || "bin"}`;
      const href = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(href);
      await loadCase(caseId);
      setStatusMessage("Forensic rewrite exported and case snapshot updated.");
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || "Unable to export rewritten file.");
    } finally {
      setBusyAction("");
    }
  };

  const handleDownload = async () => {
    if (!masterFile) {
      return;
    }

    if (downloadFormat === "original" && caseId) {
      try {
        setBusyAction("download");
        const response = await axios.post(
          `${API_BASE}/api/cases/${caseId}/rewrite`,
          { masterFile, preserveName: true },
          { responseType: "blob" }
        );
        const href = URL.createObjectURL(response.data);
        const link = document.createElement("a");
        link.href = href;
        link.download = masterFile.name;
        link.click();
        URL.revokeObjectURL(href);
        setStatusMessage("Downloaded rewritten file with embedded metadata.");
        await loadCase(caseId);
      } catch (requestError) {
        setError(requestError.response?.data?.error || requestError.message || "Unable to download rewritten artifact.");
      } finally {
        setBusyAction("");
      }
      return;
    }

    const blob = buildDownloadBlob(downloadFormat, masterFile);
    const extension = extensionForFormat(downloadFormat, masterFile);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${slugifyFilename(masterFile.name)}.${extension}`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const resetWorkspace = () => {
    setMasterFile(initialMasterFile);
    setCaseId("");
    setRevisions([]);
    setAiHistory([]);
    setRoute("upload");
    setError("");
    setStatusMessage("");
  };

  const renderTool = () => {
    if (!masterFile) {
      return null;
    }

    if (activeTool === "encryption") {
      return <EncryptionPanel masterFile={masterFile} />;
    }

    if (activeTool === "ai") {
      return <AIPanel masterFile={masterFile} caseId={caseId} aiHistory={aiHistory} onInsight={(entry) => setAiHistory((current) => [entry, ...current].slice(0, 20))} />;
    }

    return (
      <MetadataPanel
        masterFile={masterFile}
        onSave={handleMasterFileUpdate}
        onDownload={handleDownload}
        downloadFormat={downloadFormat}
        onDownloadFormatChange={setDownloadFormat}
      />
    );
  };

  if (route === "upload" || !masterFile) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.22),_transparent_30%),linear-gradient(135deg,_#050816,_#0f172a_42%,_#14213d_100%)] text-slate-100">
        <FileUpload onAnalyzeComplete={handleAnalysisComplete} recentCases={cases} onOpenCase={loadCase} storageMode={storageMode} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">MetaInsight</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{masterFile.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Case ID: {caseId} | Storage: {storageMode} | SHA-256: {masterFile.integrity?.sha256?.slice(0, 16)}...
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void persistCase(activeTool === "metadata" ? "Metadata saved" : activeTool === "encryption" ? "Encrypted content saved" : "Case saved")} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20" disabled={busyAction === "save"}>
              <Save size={16} />
              {busyAction === "save" ? "Saving..." : "Save Case"}
            </button>

            <button type="button" onClick={() => void handleRewriteExport()} className="inline-flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20" disabled={busyAction === "rewrite"}>
              <HardDriveDownload size={16} />
              {busyAction === "rewrite" ? "Rewriting..." : "Rewrite Export"}
            </button>

            <button type="button" onClick={resetWorkspace} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900">
              <RefreshCw size={16} />
              New Upload
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[310px_1fr]">
        <aside className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-cyan-950/20">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Master State</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{masterFile.type}</h2>
              </div>
              <Lock className="text-cyan-300" size={18} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>Size: {masterFile.metadata?.fileSystem?.size || "Unknown"}</p>
              <p>Format: {masterFile.originalFormat?.toUpperCase() || "N/A"}</p>
              <p>MIME: {masterFile.mimeType}</p>
            </div>
          </div>

          <nav className="mt-6 space-y-2">
            <button type="button" onClick={resetWorkspace} className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 px-4 py-3 text-left text-sm text-slate-300 transition hover:bg-slate-800/60">
              <Home size={18} />
              Universal Upload
            </button>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTool === item.id;
              return (
                <button key={item.id} type="button" onClick={() => setActiveTool(item.id)} className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-slate-800 text-slate-300 hover:bg-slate-800/60"}`}>
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
            <p className="font-medium">Recent revisions</p>
            <div className="mt-3 space-y-2 text-cyan-50/80">
              {revisions.length > 0 ? revisions.slice(0, 4).map((revision) => (
                <div key={revision.revisionId} className="rounded-xl border border-cyan-400/10 bg-slate-950/40 px-3 py-2">
                  <p>{revision.label}</p>
                  <p className="mt-1 text-xs text-cyan-100/60">{new Date(revision.savedAt).toLocaleString()}</p>
                </div>
              )) : <p>No revision history yet.</p>}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-medium">Stego status</p>
            <p className="mt-2 text-amber-50/80">{masterFile.metadata?.steganography?.recommendation || "No steganography insight available yet."}</p>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
            <div className="flex items-center gap-2 text-white">
              <Archive size={16} />
              <p className="font-medium">Recent cases</p>
            </div>
            <div className="mt-3 space-y-2">
              {cases.slice(0, 4).map((entry) => (
                <button key={entry.caseId} type="button" onClick={() => void loadCase(entry.caseId)} className="block w-full rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-left transition hover:border-cyan-400/30 hover:bg-slate-900">
                  <p className="truncate text-sm text-white">{entry.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{entry.caseId.slice(0, 8)}... | {entry.type}</p>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-xs text-slate-500">Project by Aniket Darmwal | Roll: 2218353</p>
        </aside>

        <main className="space-y-4">
          {(statusMessage || error) ? (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}>
              {error || statusMessage}
            </div>
          ) : null}
          {renderTool()}
        </main>
      </div>
    </div>
  );
}

export default App;
