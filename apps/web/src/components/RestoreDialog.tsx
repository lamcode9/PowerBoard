import { useEffect, useState } from "react";
import { ArchiveRestore, X } from "lucide-react";
import { listBackups, restoreBackup, type BackupEntry } from "../api";

/** Timestamped snapshot picker — restore is applied through the normal op path (undoable). */
export function RestoreDialog({ boardId, open, onClose, onRestored }: { boardId: string; open: boolean; onClose: () => void; onRestored: (message: string) => void }) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBackups(null);
    setError(null);
    listBackups(boardId)
      .then(setBackups)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load backups"));
  }, [open, boardId]);

  if (!open) return null;

  async function restore(file: string) {
    setBusyFile(file);
    setError(null);
    try {
      await restoreBackup(boardId, file);
      onRestored(`Restored snapshot ${formatBackupName(file)} — press ⌘Z to undo`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restore failed");
    } finally {
      setBusyFile(null);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <div className="restore-dialog" role="dialog" aria-modal="true" aria-label="Restore from backup" onPointerDown={(event) => event.stopPropagation()}>
        <div className="restore-head">
          <h2>
            <ArchiveRestore size={17} /> Restore from backup
          </h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {error ? <p className="restore-error">{error}</p> : null}
        {backups === null && !error ? <p className="muted">Loading snapshots…</p> : null}
        {backups?.length === 0 ? <p className="muted">No snapshots yet. Backups are written automatically ~15s after each change.</p> : null}
        {backups?.length ? (
          <div className="restore-list">
            {backups.map((backup) => (
              <div key={backup.file} className="restore-row">
                <div>
                  <strong>{formatBackupName(backup.file)}</strong>
                  <small>{formatSize(backup.sizeBytes)}</small>
                </div>
                <button disabled={busyFile !== null} onClick={() => void restore(backup.file)}>
                  {busyFile === backup.file ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <p className="restore-footnote">Restoring replaces the current board and is undoable with ⌘Z.</p>
      </div>
    </div>
  );
}

function formatBackupName(file: string): string {
  const match = file.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return file.replace(/\.json\.gz$/, "");
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}
