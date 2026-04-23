import { useEffect, useMemo, useState } from "react";
import {
  DatabaseZap,
  Download,
  Eraser,
  Lock,
  PlusCircle,
  Save,
  ShieldAlert,
} from "lucide-react";

const METAINSIGHT_HIDDEN_DATA_KEY = "MetaInsightHiddenData";

const EXPLORER_EDITABLE_SECTIONS = [
  {
    title: "Description",
    fields: [
      { label: "Title", source: "hidden", key: "Title" },
      { label: "Rating", source: "hidden", key: "Rating" },
      { label: "Tags", source: "hidden", key: "Tags" },
      { label: "Comments", source: "hidden", key: "Comments" },
    ],
  },
  {
    title: "Origin",
    fields: [
      { label: "Authors", source: "hidden", key: "Author" },
      { label: "Date taken", source: "hidden", key: "DateTimeOriginal" },
      { label: "Program name", source: "hidden", key: "Software" },
      { label: "Date acquired", source: "hidden", key: "DateAcquired" },
      { label: "Copyright", source: "hidden", key: "Copyright" },
    ],
  },
  {
    title: "Camera",
    fields: [
      { label: "Camera maker", source: "hidden", key: "Make" },
      { label: "Camera model", source: "hidden", key: "Model" },
      { label: "F-stop", source: "hidden", key: "FNumber" },
      { label: "Exposure time", source: "hidden", key: "ExposureTime" },
      { label: "ISO speed", source: "hidden", key: "ISO" },
      { label: "Exposure bias", source: "hidden", key: "ExposureBiasValue" },
      { label: "Focal length", source: "hidden", key: "FocalLength" },
      { label: "Max aperture", source: "hidden", key: "MaxApertureValue" },
      { label: "Metering mode", source: "hidden", key: "MeteringMode" },
      { label: "Subject distance", source: "hidden", key: "SubjectDistance" },
      { label: "Flash mode", source: "hidden", key: "Flash" },
      { label: "Flash energy", source: "hidden", key: "FlashEnergy" },
      { label: "35mm focal length", source: "hidden", key: "FocalLengthIn35mmFilm" },
    ],
    visible: "image",
  },
  {
    title: "Advanced photo",
    fields: [
      { label: "Lens maker", source: "hidden", key: "LensMake" },
      { label: "Lens model", source: "hidden", key: "LensModel" },
      { label: "Flash maker", source: "hidden", key: "FlashMaker" },
      { label: "Flash model", source: "hidden", key: "FlashModel" },
      { label: "Camera serial number", source: "hidden", key: "BodySerialNumber" },
      { label: "Contrast", source: "hidden", key: "Contrast" },
      { label: "Brightness", source: "hidden", key: "BrightnessValue" },
      { label: "Light source", source: "hidden", key: "LightSource" },
      { label: "Exposure program", source: "hidden", key: "ExposureProgram" },
      { label: "Saturation", source: "hidden", key: "Saturation" },
      { label: "Sharpness", source: "hidden", key: "Sharpness" },
      { label: "White balance", source: "hidden", key: "WhiteBalance" },
      { label: "Photometric interpretation", source: "hidden", key: "PhotometricInterpretation" },
      { label: "Digital zoom", source: "hidden", key: "DigitalZoomRatio" },
      { label: "EXIF version", source: "hidden", key: "ExifVersion" },
    ],
    visible: "image",
  },
];

const NON_CHANGEABLE_METADATA_SECTIONS = [
  {
    title: "Image",
    fields: [
      { label: "Image ID", source: "hidden", key: "ImageUniqueID" },
      {
        label: "Dimensions",
        source: "derived",
        value: (hiddenMetadata) => {
          const imageSize = hiddenMetadata.imageSize || {};
          return imageSize.width && imageSize.height ? `${imageSize.width} x ${imageSize.height}` : "";
        },
      },
      {
        label: "Width",
        source: "derived",
        value: (hiddenMetadata) =>
          hiddenMetadata.imageSize?.width ? `${hiddenMetadata.imageSize.width} pixels` : "",
      },
      {
        label: "Height",
        source: "derived",
        value: (hiddenMetadata) =>
          hiddenMetadata.imageSize?.height ? `${hiddenMetadata.imageSize.height} pixels` : "",
      },
      { label: "Horizontal resolution", source: "hidden", key: "XResolution" },
      { label: "Vertical resolution", source: "hidden", key: "YResolution" },
      { label: "Bit depth", source: "hidden", key: "BitDepth" },
      { label: "Compression", source: "hidden", key: "Compression" },
      { label: "Resolution unit", source: "hidden", key: "ResolutionUnit" },
      { label: "Color representation", source: "hidden", key: "ColorSpace" },
      { label: "Compressed bits/pixel", source: "hidden", key: "CompressedBitsPerPixel" },
    ],
    visible: "image",
  },
];

const HIDDEN_PROPERTY_OPTIONS = [
  ...EXPLORER_EDITABLE_SECTIONS.flatMap((section) => section.fields),
  ...NON_CHANGEABLE_METADATA_SECTIONS.flatMap((section) => section.fields.filter((field) => field.source === "hidden")),
  { label: "Subject", source: "hidden", key: "Subject" },
  { label: "Keywords", source: "hidden", key: "Keywords" },
  { label: "Creator", source: "hidden", key: "Creator" },
  { label: "Producer", source: "hidden", key: "Producer" },
];

const HIDDEN_PROPERTY_OPTION_MAP = new Map(
  HIDDEN_PROPERTY_OPTIONS.map((field) => [field.key, field.label])
);

function parseEditableValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (!Number.isNaN(Number(trimmed)) && trimmed === String(Number(trimmed))) {
    return Number(trimmed);
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return value;
    }
  }

  return value;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function displayMultilineValue(value) {
  return displayValue(value).replace(/\s+/g, " ").trim();
}

function inferItemType(masterFile) {
  const extension = (masterFile.extension || "").replace(".", "").toUpperCase();
  if (!extension) {
    return masterFile.mimeType || "Unknown file";
  }
  return `${extension} File`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "Unavailable";
  }

  return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString()} bytes)`;
}

function sectionIsVisible(section, mimeType) {
  if (!section.visible) {
    return true;
  }
  if (section.visible === "image") {
    return mimeType.startsWith("image/");
  }
  return true;
}

function buildEditableSections(mimeType) {
  return EXPLORER_EDITABLE_SECTIONS.filter((section) => sectionIsVisible(section, mimeType));
}

function buildLockedSections(masterFile, fileSystem, hiddenMetadata) {
  const imageSize = hiddenMetadata.imageSize || {};
  const fallbackLocation = "Local browser upload session";

  return [
    {
      title: "File",
      fields: [
        { label: "Name", value: masterFile.name },
        { label: "Item type", value: inferItemType(masterFile) },
        { label: "File location", value: fallbackLocation },
        { label: "Date created", value: fileSystem.created },
        { label: "Date modified", value: fileSystem.modified },
        { label: "Size", value: formatBytes(masterFile.size) },
        { label: "Attributes", value: "Browser-managed artifact" },
        { label: "Availability", value: "Available while loaded in MetaInsight" },
        { label: "Offline status", value: "Not exposed by browser upload" },
        { label: "Shared with", value: "Unavailable in web context" },
        { label: "Owner", value: "Unavailable in web context" },
        { label: "Computer", value: "Current browser session" },
      ],
    },
    {
      title: "Open / General",
      fields: [
        { label: "Type of file", value: `${inferItemType(masterFile)} (${masterFile.extension || ""})` },
        { label: "Opens with", value: "Handled by the local operating system" },
        { label: "Location", value: fallbackLocation },
        { label: "Size on disk", value: "Unavailable without local disk access" },
        { label: "Accessed", value: "Not exposed by browser upload" },
        { label: "Read-only", value: "Unavailable in web context" },
        { label: "Hidden", value: "Unavailable in web context" },
      ],
    },
    ...NON_CHANGEABLE_METADATA_SECTIONS.filter((section) => sectionIsVisible(section, masterFile.mimeType || "")).map((section) => ({
      title: section.title,
      fields: section.fields.map((field) => ({
        label: field.label,
        value:
          field.source === "hidden"
            ? hiddenMetadata[field.key]
            : field.source === "derived"
              ? field.value(hiddenMetadata)
              : field.value,
      })),
    })),
    {
      title: "Permissions",
      fields: [
        { label: "Full control", value: "System-controlled" },
        { label: "Modify", value: "System-controlled" },
        { label: "Read & execute", value: "System-controlled" },
        { label: "Read", value: "System-controlled" },
        { label: "Write", value: "System-controlled" },
        { label: "Special permissions", value: "System-controlled" },
      ],
    },
    {
      title: "Digital signatures",
      fields: [
        { label: "Embedded signatures", value: "Not parsed by MetaInsight" },
        { label: "Catalog signatures", value: "Not parsed by MetaInsight" },
        { label: "Timestamp", value: "Unavailable" },
      ],
    },
  ];
}

function getKnownExplorerKeys(mimeType) {
  return new Set(
    EXPLORER_EDITABLE_SECTIONS
      .filter((section) => sectionIsVisible(section, mimeType))
      .flatMap((section) => section.fields)
      .filter((field) => field.source === "hidden")
      .map((field) => field.key)
  );
}

function getReservedHiddenKeys(mimeType) {
  const knownExplorerKeys = getKnownExplorerKeys(mimeType);
  const nonChangeableKeys = NON_CHANGEABLE_METADATA_SECTIONS
    .filter((section) => sectionIsVisible(section, mimeType))
    .flatMap((section) => section.fields)
    .filter((field) => field.source === "hidden")
    .map((field) => field.key);

  return new Set([
    ...knownExplorerKeys,
    ...nonChangeableKeys,
    "imageSize",
    "thumbnailOffset",
    "thumbnailLength",
    "hasThumbnail",
    "exifError",
    "pngTextChunks",
    "metaInsightFileSystem",
    "metaInsightEmbeddedAt",
    "metaInsightRewrittenBy",
    "pdfInfo",
    "pdfMetadata",
    "pages",
    "version",
    METAINSIGHT_HIDDEN_DATA_KEY,
  ]);
}

function buildCustomHiddenProperties(hiddenMetadata, mimeType) {
  const reservedKeys = getReservedHiddenKeys(mimeType);
  return Object.keys(hiddenMetadata || {})
    .filter((key) => !reservedKeys.has(key))
    .map((key) => ({
      label: HIDDEN_PROPERTY_OPTION_MAP.get(key) || key,
      key,
      value: hiddenMetadata[key],
    }));
}

function EditableSection({ title, fields, hiddenMetadata, onHiddenChange }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      <div className="border-b border-slate-800 px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-200">{title}</h3>
      </div>

      <div className="divide-y divide-slate-800">
        {fields.map((field) => {
          const value = hiddenMetadata[field.key] ?? "";
          const isMultilineValue =
            typeof value !== "string" || value.includes("\n") || value.length > 120;

          return (
            <div key={`${title}-${field.label}`} className="grid gap-3 px-5 py-3.5 md:grid-cols-[190px_minmax(0,1fr)] md:items-start">
              <span className="pt-2 text-sm text-slate-300">{field.label}</span>
              {!isMultilineValue ? (
                <input
                  type="text"
                  value={typeof value === "string" ? value : String(value ?? "")}
                  onChange={(event) => onHiddenChange(field.key, event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              ) : (
                <textarea
                  rows={3}
                  value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                  onChange={(event) => onHiddenChange(field.key, event.target.value)}
                  className="w-full resize-none overflow-hidden break-words rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LockedSection({ title, fields }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
      <div className="border-b border-slate-800 px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-200">{title}</h3>
      </div>

      <div className="divide-y divide-slate-800">
        {fields.map((field) => (
          <div key={`${title}-${field.label}`} className="grid gap-3 px-5 py-3.5 md:grid-cols-[190px_minmax(0,1fr)] md:items-start">
            <span className="pt-2 text-sm text-slate-300">{field.label}</span>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-200">
              <p className="overflow-x-hidden break-words whitespace-pre-wrap">
                {displayMultilineValue(field.value)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HiddenLayerCard({
  hiddenMessage,
  onHiddenMessageChange,
  hiddenPropertyMode,
  onHiddenPropertyModeChange,
  selectedHiddenProperty,
  onSelectedHiddenPropertyChange,
  customHiddenPropertyName,
  onCustomHiddenPropertyNameChange,
  hiddenPropertyValue,
  onHiddenPropertyValueChange,
  onAddHiddenProperty,
  customHiddenProperties,
  onCustomHiddenPropertyEdit,
  onWipe,
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">MetaInsight Hidden Layer</p>
          <p className="mt-1 text-xs text-slate-400">
            Hidden data stays app-readable after download and re-upload. Hidden properties can target standard names or use your own custom key.
          </p>
        </div>
        <button
          type="button"
          onClick={onWipe}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm text-rose-200 transition hover:bg-rose-400/20"
        >
          <Eraser size={16} />
          Wipe Editable Metadata
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-sm font-medium text-white">Hidden data message</p>
        <p className="mt-1 text-xs text-slate-400">
          Use one message box here when you want to store a hidden note or payload string inside the file.
        </p>
        <textarea
          rows={4}
          value={hiddenMessage}
          onChange={(event) => onHiddenMessageChange(event.target.value)}
          placeholder="Write hidden data here"
          className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-sm font-medium text-white">Add hidden property</p>
        <p className="mt-1 text-xs text-slate-400">
          Pick a known property name from the list or switch to custom and create your own hidden property name.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <select
            value={hiddenPropertyMode}
            onChange={(event) => onHiddenPropertyModeChange(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
          >
            <option value="known">Known property</option>
            <option value="custom">Custom property</option>
          </select>

          {hiddenPropertyMode === "known" ? (
            <select
              value={selectedHiddenProperty}
              onChange={(event) => onSelectedHiddenPropertyChange(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
            >
              {HIDDEN_PROPERTY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={customHiddenPropertyName}
              onChange={(event) => onCustomHiddenPropertyNameChange(event.target.value)}
              placeholder="Custom property name"
              className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
            />
          )}

          <input
            value={hiddenPropertyValue}
            onChange={(event) => onHiddenPropertyValueChange(event.target.value)}
            placeholder="Property value"
            className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
          />

          <button
            type="button"
            onClick={onAddHiddenProperty}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            <PlusCircle size={16} />
            Add
          </button>
        </div>
      </div>

      {customHiddenProperties.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-sm font-medium text-white">Current hidden properties</p>
          <div className="mt-4 space-y-3">
            {customHiddenProperties.map((property) => (
              <div key={property.key} className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-200">
                  {property.label}
                  <span className="ml-2 text-xs text-slate-500">({property.key})</span>
                </div>
                <input
                  type="text"
                  value={typeof property.value === "string" ? property.value : JSON.stringify(property.value)}
                  onChange={(event) => onCustomHiddenPropertyEdit(property.key, event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetadataPanel({
  masterFile,
  onSave,
  onDownload,
  downloadFormat,
  onDownloadFormatChange,
}) {
  const [fileSystem, setFileSystem] = useState(masterFile.metadata?.fileSystem || {});
  const [hiddenMetadata, setHiddenMetadata] = useState(masterFile.metadata?.hidden || {});
  const [saveMessage, setSaveMessage] = useState("");
  const [hiddenPropertyMode, setHiddenPropertyMode] = useState("known");
  const [selectedHiddenProperty, setSelectedHiddenProperty] = useState(HIDDEN_PROPERTY_OPTIONS[0]?.key || "Title");
  const [customHiddenPropertyName, setCustomHiddenPropertyName] = useState("");
  const [hiddenPropertyValue, setHiddenPropertyValue] = useState("");

  useEffect(() => {
    setFileSystem(masterFile.metadata?.fileSystem || {});
    setHiddenMetadata(masterFile.metadata?.hidden || {});
  }, [masterFile]);

  const editableSections = useMemo(
    () => buildEditableSections(masterFile.mimeType || ""),
    [masterFile.mimeType]
  );

  const lockedSections = useMemo(
    () => buildLockedSections(masterFile, fileSystem, hiddenMetadata),
    [masterFile, fileSystem, hiddenMetadata]
  );

  const customHiddenProperties = useMemo(
    () => buildCustomHiddenProperties(hiddenMetadata, masterFile.mimeType || ""),
    [hiddenMetadata, masterFile.mimeType]
  );

  const hiddenMessage = hiddenMetadata[METAINSIGHT_HIDDEN_DATA_KEY] ?? "";

  const handleHiddenChange = (key, value) => {
    setHiddenMetadata((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleWipe = () => {
    const keysToKeep = new Set([
      ...Object.keys(fileSystem || {}).filter(Boolean),
    ]);
    setHiddenMetadata((current) => {
      const next = {};
      Object.keys(current || {}).forEach((key) => {
        if (key.startsWith("metaInsight")) {
          next[key] = current[key];
        }
        if (keysToKeep.has(key)) {
          next[key] = current[key];
        }
      });
      return next;
    });
    setHiddenPropertyValue("");
    setCustomHiddenPropertyName("");
  };

  const addHiddenProperty = () => {
    const targetKey = hiddenPropertyMode === "known" ? selectedHiddenProperty : customHiddenPropertyName.trim();
    if (!targetKey) {
      return;
    }

    setHiddenMetadata((current) => ({
      ...current,
      [targetKey]: parseEditableValue(hiddenPropertyValue),
    }));

    setHiddenPropertyValue("");
    if (hiddenPropertyMode === "custom") {
      setCustomHiddenPropertyName("");
    }
  };

  const saveToMaster = () => {
    const normalizedHiddenMetadata = Object.fromEntries(
      Object.entries(hiddenMetadata || {}).map(([key, value]) => [key, parseEditableValue(value)])
    );

    onSave({
      metadata: {
        ...masterFile.metadata,
        fileSystem,
        hidden: normalizedHiddenMetadata,
      },
    });

    setSaveMessage("Metadata saved to the master file state.");
    window.setTimeout(() => setSaveMessage(""), 2200);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start gap-3">
          <DatabaseZap className="mt-1 text-cyan-300" size={20} />
          <div>
            <h2 className="text-xl font-semibold text-white">Properties That Can Be Changed in File Explorer Details</h2>
            <p className="mt-1 text-sm text-slate-400">
              These are the standard metadata fields that are the best candidates to show up in File Explorer Details after rewrite, especially on supported formats like JPEG.
            </p>
          </div>
        </div>

        {masterFile.mimeType === "image/png" ? (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Windows File Explorer has limited support for PNG Details fields. MetaInsight can preserve and re-read the metadata it embeds, but Explorer may still leave many PNG detail rows blank. For the strongest Explorer-visible results, use JPEG/JPG.
          </div>
        ) : null}

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {editableSections.map((section) => (
            <EditableSection
              key={section.title}
              title={section.title}
              fields={section.fields}
              hiddenMetadata={hiddenMetadata}
              onHiddenChange={handleHiddenChange}
            />
          ))}
        </div>

        <div className="mt-6">
          <HiddenLayerCard
            hiddenMessage={hiddenMessage}
            onHiddenMessageChange={(value) => handleHiddenChange(METAINSIGHT_HIDDEN_DATA_KEY, value)}
            hiddenPropertyMode={hiddenPropertyMode}
            onHiddenPropertyModeChange={setHiddenPropertyMode}
            selectedHiddenProperty={selectedHiddenProperty}
            onSelectedHiddenPropertyChange={setSelectedHiddenProperty}
            customHiddenPropertyName={customHiddenPropertyName}
            onCustomHiddenPropertyNameChange={setCustomHiddenPropertyName}
            hiddenPropertyValue={hiddenPropertyValue}
            onHiddenPropertyValueChange={setHiddenPropertyValue}
            onAddHiddenProperty={addHiddenProperty}
            customHiddenProperties={customHiddenProperties}
            onCustomHiddenPropertyEdit={handleHiddenChange}
            onWipe={handleWipe}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={downloadFormat}
              onChange={(event) => onDownloadFormatChange?.(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
            >
              <option value="original">Download current artifact</option>
              <option value="encrypted">Download as Encrypted</option>
              <option value="txt">Download as TXT</option>
              <option value="pdf">Download as PDF</option>
            </select>

            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              <Download size={16} />
              Download
            </button>

            <button
              type="button"
              onClick={saveToMaster}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
            >
              <Save size={16} />
              Save to Master File
            </button>
          </div>

          {saveMessage ? <p className="text-sm text-emerald-300">{saveMessage}</p> : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start gap-3">
          <Lock className="mt-1 text-amber-300" size={20} />
          <div>
            <h2 className="text-xl font-semibold text-white">Properties That Are Non-Changeable as Normal File Explorer Details</h2>
            <p className="mt-1 text-sm text-slate-400">
              These values are system-driven, browser-limited, format-limited, or not normally rewritten as native File Explorer Details fields.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {lockedSections.map((section) => (
            <LockedSection key={section.title} title={section.title} fields={section.fields} />
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-100">
            <ShieldAlert size={16} />
            <p className="font-medium">Steganography Check</p>
          </div>
          <p className="mt-3 text-sm text-amber-50/90">
            {masterFile.metadata?.steganography?.suspicious ? "Suspicious" : "Clear"} | Score {masterFile.metadata?.steganography?.score ?? 0}
          </p>
          <p className="mt-2 text-sm text-amber-50/70">
            {(masterFile.metadata?.steganography?.reasons || []).join(" ")}
          </p>
        </div>
      </section>
    </div>
  );
}

export default MetadataPanel;