/** File change status as reported by git. */
export type FileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown';

/** A single contiguous block of changed lines within a file. */
export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` header line. */
  header: string;
  /** Raw hunk lines including the leading `+`, `-` or ` ` marker. */
  lines: string[];
}

/** One file entry of a parsed unified diff. */
export interface FileChange {
  /** Path after the change (or the deleted path for deletions). */
  path: string;
  /** Previous path, set for renames and copies. */
  oldPath?: string;
  status: FileStatusKind;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
}

/** Structured representation of a `git diff` output. */
export interface ParsedDiff {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  /** Number of changed (added + deleted) lines across all files. */
  totalLines: number;
  /** The raw unified diff the structure was parsed from. */
  raw: string;
}

/** Entry of `git status --porcelain`. */
export interface FileStatus {
  path: string;
  index: string;
  workingTree: string;
  staged: boolean;
}

/** One-letter code used when rendering a file change in the terminal. */
export function statusLetter(status: FileStatusKind): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'modified':
      return 'M';
    default:
      return '?';
  }
}
