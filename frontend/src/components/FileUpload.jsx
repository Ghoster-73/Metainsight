import { useCallback, useState } from "react";
import axios from "axios";
import { useDropzone } from "react-dropzone";
import { Archive, Database, FileUp, ImageIcon, LoaderCircle, ShieldAlert } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function FileUpload({ onAnalyzeComplete, recentCases = [], onOpenCase, storageMode }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onDrop = useCallback(
    async (acceptedFiles) => {
      const file = acceptedFiles[0];

      if (!file) {
        return;
      }

      setUploading(true);
      setError("");

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("lastModified", String(file.lastModified));

        const response = await axios.post(`${API_BASE}/api/analyze`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        onAnalyzeComplete(response.data);
      } catch (requestError) {
        setError(
          requestError.response?.data?.error ||
            requestError.message ||
            "Upload failed."
        );
      } finally {
        setUploading(false);
      }
    },
    [onAnalyzeComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/plain": [".txt"],
      "text/javascript": [".js"],
      "application/javascript": [".js", ".mjs", ".cjs"],
      "text/x-python": [".py"],
      "text/x-java-source": [".java"],
      "text/x-c": [".c", ".h"],
      "text/x-c++": [".cpp", ".cc", ".hpp"],
      "text/x-csharp": [".cs"],
      "application/x-httpd-php": [".php"],
      "text/x-ruby": [".rb"],
      "text/x-go": [".go"],
      "text/x-rustsrc": [".rs"],
      "text/x-shellscript": [".sh"],
      "application/x-sh": [".sh"],
      "application/octet-stream": [".ts", ".tsx", ".jsx", ".sql", ".ps1", ".bat", ".kt", ".kts", ".swift"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
    },
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-10">
      <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">
            Cyber Forensics Workspace
          </p>
          <h1 className="mt-4 max-w-2xl text-5xl font-semibold leading-tight text-white">
            Upload one file and pivot instantly across metadata, encryption, and AI intelligence.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            MetaInsight is built for security-first analysis workflows. Drop a PDF, source file, or image to extract
            forensic metadata, preserve a case record, perform controlled encryption, and generate AI insight with
            fallback-safe behavior.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
              <FileUp className="text-cyan-300" size={18} />
              <p className="mt-3 text-sm font-medium text-white">Universal Upload</p>
              <p className="mt-2 text-sm text-slate-300">PDF, JavaScript, plain text, JPEG, and PNG are supported out of the box.</p>
            </div>

            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <ShieldAlert className="text-emerald-300" size={18} />
              <p className="mt-3 text-sm font-medium text-white">Metadata Forensics</p>
              <p className="mt-2 text-sm text-slate-300">Inspect editable file system fields, EXIF details, and mock steganography flags.</p>
            </div>

            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
              <ImageIcon className="text-amber-300" size={18} />
              <p className="mt-3 text-sm font-medium text-white">AI Intelligence</p>
              <p className="mt-2 text-sm text-slate-300">Generate context-aware insight for code, documents, and image evidence.</p>
            </div>
          </div>

          <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-950/55 p-5">
            <div className="flex items-center gap-2 text-white">
              <Database className="text-cyan-300" size={18} />
              <p className="text-sm font-medium">Persistent Case Storage</p>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Storage mode: <span className="font-medium text-cyan-200">{storageMode || "json-fallback"}</span>
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              Every upload becomes a case with revision history so you can reopen investigations and export rewritten
              evidence later.
            </p>
          </div>
        </section>

        <section
          {...getRootProps()}
          className={`rounded-[2rem] border-2 border-dashed p-8 transition ${
            isDragActive
              ? "border-cyan-300 bg-cyan-400/10"
              : "border-slate-600 bg-slate-900/70"
          }`}
        >
          <input {...getInputProps()} />

          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 p-3">
                <FileUp className="text-cyan-300" size={28} />
              </div>

              <h2 className="mt-6 text-2xl font-semibold text-white">
                {isDragActive ? "Release to analyze" : "Drop a file to launch the hub"}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                The backend will extract text from PDFs and source files, parse EXIF data from images, and prepare the
                master file state that powers every panel.
              </p>
            </div>

            <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
              <p className="text-sm text-slate-300">Supported extensions</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-100">
                {[".pdf", ".txt", ".js", ".py", ".java", ".cpp", ".ts", ".jsx", ".jpg", ".png"].map((extension) => (
                  <span
                    key={extension}
                    className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1"
                  >
                    {extension}
                  </span>
                ))}
              </div>

              <button
                type="button"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {uploading ? <LoaderCircle className="animate-spin" size={16} /> : <FileUp size={16} />}
                {uploading ? "Analyzing file..." : "Choose File"}
              </button>

              {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
              <div className="flex items-center gap-2 text-white">
                <Archive className="text-cyan-300" size={18} />
                <p className="text-sm font-medium">Recent Cases</p>
              </div>

              <div className="mt-4 space-y-2">
                {recentCases.length > 0 ? (
                  recentCases.slice(0, 4).map((entry) => (
                    <button
                      key={entry.caseId}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenCase?.(entry.caseId);
                      }}
                      className="block w-full rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-left transition hover:border-cyan-400/30 hover:bg-slate-900"
                    >
                      <p className="truncate text-sm font-medium text-white">{entry.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {entry.caseId.slice(0, 8)}... | {entry.type} | {entry.revisionCount} revisions
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No persisted cases yet. Upload evidence to create one.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default FileUpload;
