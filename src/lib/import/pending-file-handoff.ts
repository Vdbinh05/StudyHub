/**
 * Client-side in-memory handoff for a `File` picked on `/import` (`ImportHubView`)
 * so `/sets/[id]/import` (`ImportWizard`) can auto-parse it on mount without forcing
 * the student to pick the same file twice (`V32-038` / `RU-13`).
 */

interface PendingImportFileEntry {
  studySetId: string;
  file: File;
  createdAt: number;
}

const PENDING_FILE_TTL_MS = 5 * 60 * 1000;

let pendingEntry: PendingImportFileEntry | null = null;

export function setPendingImportFile(studySetId: string, file: File): void {
  if (!studySetId) return;
  pendingEntry = {
    studySetId,
    file,
    createdAt: Date.now(),
  };
}

/**
 * Consumes and clears the pending file for `studySetId` if it exists and has not expired.
 */
export function consumePendingImportFile(studySetId: string): File | null {
  if (!pendingEntry) return null;
  if (Date.now() - pendingEntry.createdAt > PENDING_FILE_TTL_MS) {
    pendingEntry = null;
    return null;
  }
  if (pendingEntry.studySetId !== studySetId) {
    return null;
  }
  const { file } = pendingEntry;
  pendingEntry = null;
  return file;
}

export function clearPendingImportFile(): void {
  pendingEntry = null;
}
