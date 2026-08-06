import { useEffect, useRef, useState } from "react";
import { Check, Clipboard, Download, X } from "lucide-react";
import { renderExport, type ExportBackground, type ExportFormat, type ExportScope } from "../api";

/** One choosable "what" — the App owns board geometry, so it hands the dialog ready-made targets. */
export interface ExportTarget {
  scope: ExportScope;
  label: string;
  detail: string;
  artboardId?: string;
  pageId?: string;
  ids?: string[];
  /** 1x pixel size, used for the live readout before the server reports the real numbers. */
  width: number;
  height: number;
  disabledReason?: string;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "png", label: "PNG", hint: "Slides, docs, anywhere. Supports transparency." },
  { id: "jpg", label: "JPG", hint: "Smaller file, no transparency." },
  { id: "svg", label: "SVG", hint: "Vector — stays sharp at any size on the web." },
  { id: "pdf", label: "PDF", hint: "Print and hand-off." }
];

const BACKGROUNDS: { id: ExportBackground; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "white", label: "White" },
  { id: "transparent", label: "Transparent" }
];

const SCALES = [1, 2, 3, 4];
const PREFS_KEY = "powerboard.export.prefs.v1";

interface ExportPrefs {
  format: ExportFormat;
  scale: number;
  background: ExportBackground;
}

export function ExportDialog({
  boardId,
  open,
  targets,
  desktop,
  onClose,
  onStatus
}: {
  boardId: string;
  open: boolean;
  targets: ExportTarget[];
  /** Desktop shell saves through a native panel; the browser drops the file in Downloads. */
  desktop: boolean;
  onClose: () => void;
  onStatus: (message: string) => void;
}) {
  const [prefs, setPrefs] = useState<ExportPrefs>(() => readPrefs());
  const [scopeId, setScopeId] = useState<ExportScope | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actual, setActual] = useState<{ width: number; height: number; scale: number } | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  const enabled = targets.filter((target) => !target.disabledReason);
  const target = targets.find((candidate) => candidate.scope === scopeId) ?? enabled[0] ?? targets[0];
  const rasterized = prefs.format !== "svg";
  const transparencyBlocked = prefs.format === "jpg" || prefs.format === "pdf";
  const background: ExportBackground = transparencyBlocked && prefs.background === "transparent" ? "white" : prefs.background;

  useEffect(() => {
    if (!open) return;
    // Reopening after a selection change should land on the most specific thing available.
    setScopeId(null);
    setError(null);
    setCopied(false);
    setActual(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !target) return null;

  function update(patch: Partial<ExportPrefs>) {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writePrefs(next);
      return next;
    });
    setActual(null);
    setCopied(false);
  }

  async function render() {
    return renderExport(boardId, {
      scope: target!.scope,
      format: prefs.format,
      pageId: target!.pageId,
      artboardId: target!.artboardId,
      ids: target!.ids,
      scale: prefs.scale,
      background
    });
  }

  async function download() {
    setBusy("download");
    setError(null);
    try {
      const result = await render();
      setActual({ width: result.width, height: result.height, scale: result.scale });
      const url = URL.createObjectURL(result.blob);
      const anchor = downloadRef.current;
      if (!anchor) throw new Error("Download link unavailable.");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      // Revoke late: Electron's save panel reads the blob after the click returns.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onStatus(describeResult(result.fileName, result, prefs.scale, desktop));
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Export failed";
      setError(message);
      console.error("PowerBoard export failed", cause);
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    setBusy("copy");
    setError(null);
    try {
      // Clipboard images are PNG everywhere that matters (Keynote, Slides, Notion, Figma).
      const result = await renderExport(boardId, {
        scope: target!.scope,
        format: "png",
        pageId: target!.pageId,
        artboardId: target!.artboardId,
        ids: target!.ids,
        scale: prefs.scale,
        background
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": result.blob })]);
      setActual({ width: result.width, height: result.height, scale: result.scale });
      setCopied(true);
      onStatus(`Copied ${result.width} × ${result.height} image — paste it into your deck or doc`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Copy failed";
      setError(message.includes("not allowed") || message.includes("denied") ? "The clipboard was blocked by the browser — use Download instead." : message);
      console.error("PowerBoard clipboard copy failed", cause);
    } finally {
      setBusy(null);
    }
  }

  const width = actual?.width ?? Math.round(target.width * (rasterized ? prefs.scale : 1));
  const height = actual?.height ?? Math.round(target.height * (rasterized ? prefs.scale : 1));

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export image" onPointerDown={(event) => event.stopPropagation()}>
        <div className="export-head">
          <h2>
            <Download size={17} /> Export image
          </h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="export-row" role="group" aria-label="What to export">
          <span className="export-row-label">What</span>
          <div className="export-choices">
            {targets.map((candidate) => (
              <button
                key={candidate.scope}
                className={`export-choice${candidate.scope === target.scope ? " is-active" : ""}`}
                disabled={Boolean(candidate.disabledReason)}
                title={candidate.disabledReason ?? candidate.detail}
                onClick={() => {
                  setScopeId(candidate.scope);
                  setActual(null);
                  setCopied(false);
                }}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>

        <div className="export-row" role="group" aria-label="File format">
          <span className="export-row-label">Format</span>
          <div className="export-choices">
            {FORMATS.map((format) => (
              <button
                key={format.id}
                className={`export-choice${format.id === prefs.format ? " is-active" : ""}`}
                title={format.hint}
                onClick={() => update({ format: format.id })}
              >
                {format.label}
              </button>
            ))}
          </div>
        </div>

        <div className="export-row" role="group" aria-label="Resolution">
          <span className="export-row-label">Size</span>
          {rasterized ? (
            <div className="export-choices">
              {SCALES.map((scale) => (
                <button
                  key={scale}
                  className={`export-choice${scale === prefs.scale ? " is-active" : ""}`}
                  title={`${Math.round(target.width * scale)} × ${Math.round(target.height * scale)} px`}
                  onClick={() => update({ scale })}
                >
                  {scale}×
                </button>
              ))}
            </div>
          ) : (
            <p className="export-note">Vector — stays sharp at any size.</p>
          )}
        </div>

        <div className="export-row" role="group" aria-label="Background">
          <span className="export-row-label">Backdrop</span>
          <div className="export-choices">
            {BACKGROUNDS.map((option) => (
              <button
                key={option.id}
                className={`export-choice${option.id === background ? " is-active" : ""}`}
                disabled={option.id === "transparent" && transparencyBlocked}
                title={option.id === "transparent" && transparencyBlocked ? `${prefs.format.toUpperCase()} has no transparency — use PNG or SVG.` : undefined}
                onClick={() => update({ background: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="export-error">{error}</p> : null}

        <div className="export-foot">
          <span className="export-size" aria-live="polite">
            {rasterized ? `${width.toLocaleString()} × ${height.toLocaleString()} px` : "Vector"} · {prefs.format.toUpperCase()}
            <small>{target.detail}</small>
          </span>
          <div className="dialog-actions">
            <button disabled={busy !== null} onClick={() => void copy()} title="Copy a PNG to the clipboard — paste straight into Keynote, Slides, Notion or Figma">
              {copied ? <Check size={15} /> : <Clipboard size={15} />} {busy === "copy" ? "Copying…" : copied ? "Copied" : "Copy image"}
            </button>
            <button type="submit" disabled={busy !== null} onClick={() => void download()}>
              <Download size={15} /> {busy === "download" ? "Rendering…" : "Download"}
            </button>
          </div>
        </div>
        <a ref={downloadRef} style={{ display: "none" }} aria-hidden="true" />
      </div>
    </div>
  );
}

function describeResult(fileName: string, result: { width: number; height: number; scale: number }, requestedScale: number, desktop: boolean): string {
  const size = `${result.width} × ${result.height}`;
  // Fail loud: a clamped scale is stated, never silently applied.
  const clamped = result.scale < requestedScale ? ` — ${requestedScale}× exceeded the export size limit, rendered at ${result.scale}×` : "";
  return desktop ? `Choose where to save ${fileName} (${size})${clamped}` : `Downloaded ${fileName} (${size})${clamped}`;
}

function readPrefs(): ExportPrefs {
  const fallback: ExportPrefs = { format: "png", scale: 2, background: "board" };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ExportPrefs>;
    return {
      format: parsed.format ?? fallback.format,
      scale: SCALES.includes(Number(parsed.scale)) ? Number(parsed.scale) : fallback.scale,
      background: parsed.background ?? fallback.background
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: ExportPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    // Scalar UI preference only — a failure here costs the user nothing but a reset default.
    console.warn("Could not persist export preferences", error);
  }
}
