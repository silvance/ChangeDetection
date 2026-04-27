// Typed client for the PixelSentinel /api/v1 surface.
//
// When the bundled UI is served by the desktop binary, every browser
// request comes from the loopback interface and the server skips the
// pairing-token check (see internal/api/v1/v1.go). So this client is
// deliberately token-less; the token only matters off-host (phones,
// remote tools), and lives in the Settings page for copy/paste.

export interface ServerInfo {
  name: string;
  version: string;
  dataDir?: string;
  token?: string;
  loopback: boolean;
}

export interface CaseSummary {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  scanCount: number;
}

export interface Case {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScanStats {
  changedPct: number;
  changedPixels: number;
  regions: number;
}

export interface ScanParams {
  strength: number;
  morphSize: number;
  closeSize: number;
  minRegion: number;
  preBlurSigma: number;
  normalizeLuma: boolean;
  highlightR: number;
  highlightG: number;
  highlightB: number;
  highlightAlpha: number;
}

export interface ScanFiles {
  before: string;
  after: string;
  result?: string | null;
}

export interface Scan {
  id: string;
  caseId: string;
  label: string;
  /** Optional grouping for the time-series view. Empty means "Untagged". */
  target?: string;
  capturedAt: string;
  importedAt: string;
  source: string;
  stats: ScanStats;
  params: ScanParams;
  files: ScanFiles;
  /** SHA-256 of (before|after|result) bytes; computed on import. */
  contentHash: string;
  /** Previous scan's contentHash in the same case, or empty for first. */
  prevHash?: string;
}

export interface ScanPatch {
  label?: string;
  target?: string;
}

export interface LedgerEntry {
  scanId: string;
  label: string;
  capturedAt: string;
  contentHash: string;
  prevHash?: string;
  verified: boolean;
  verifyError?: string;
  chainBroken?: boolean;
}

const base = '/api/v1';

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  let body: BodyInit | undefined = init?.body;
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  info: () => request<ServerInfo>('/info'),

  listCases: () =>
    request<{ cases: CaseSummary[] }>('/cases').then((r) => r.cases),

  createCase: (name: string, notes?: string) =>
    request<Case>('/cases', {
      method: 'POST',
      json: { name, notes: notes ?? '' },
    }),

  getCase: (caseId: string) => request<Case>(`/cases/${caseId}`),

  deleteCase: (caseId: string) =>
    request<void>(`/cases/${caseId}`, { method: 'DELETE' }),

  listScans: (caseId: string) =>
    request<{ scans: Scan[] }>(`/cases/${caseId}/scans`).then((r) => r.scans),

  getLedger: (caseId: string) =>
    request<{ ledger: LedgerEntry[] }>(`/cases/${caseId}/ledger`).then((r) => r.ledger),

  getScan: (caseId: string, scanId: string) =>
    request<Scan>(`/cases/${caseId}/scans/${scanId}`),

  patchScan: (caseId: string, scanId: string, patch: ScanPatch) =>
    request<Scan>(`/cases/${caseId}/scans/${scanId}`, {
      method: 'PATCH',
      json: patch,
    }),

  deleteScan: (caseId: string, scanId: string) =>
    request<void>(`/cases/${caseId}/scans/${scanId}`, { method: 'DELETE' }),

  // Returns a URL the browser can <img src=...> directly. Loopback bypass
  // means we don't need to authorise this either.
  scanFileUrl: (caseId: string, scanId: string, name: string) =>
    `${base}/cases/${caseId}/scans/${scanId}/files/${encodeURIComponent(name)}`,
};
