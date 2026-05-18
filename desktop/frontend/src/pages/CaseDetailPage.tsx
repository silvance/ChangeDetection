import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import GppGoodRoundedIcon from '@mui/icons-material/GppGoodRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import {
  api,
  type Case,
  type LedgerEntry,
  type Scan,
  type ServerInfo,
  type TrustedSigner,
} from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatAbsolute, formatInt, formatPct, formatRelative } from '../utils/format';

interface Props {
  caseId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenScan: (scanId: string) => void;
  onOpenTimeSeries: (target: string) => void;
}

const UNTAGGED_LABEL = 'Untagged';

export function CaseDetailPage({
  caseId,
  onBack,
  onDeleted,
  onOpenScan,
  onOpenTimeSeries,
}: Props) {
  const [theCase, setTheCase] = useState<Case | null>(null);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [trusted, setTrusted] = useState<TrustedSigner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chainOpen, setChainOpen] = useState(false);

  // Set of normalised trusted fingerprints, indexed for O(1) lookup by
  // each row.
  const trustedSet = useMemo(
    () => new Set(trusted.map((s) => s.fingerprint.toLowerCase())),
    [trusted],
  );

  // After the operator marks a fingerprint trusted from a scan row, we
  // need to refresh the trust list without reloading every scan. This
  // callback gets handed down to ProducerCell.
  const reloadTrust = async () => {
    try {
      setTrusted(await api.listTrust());
    } catch {
      // Non-fatal; the badge will just stay "unknown" until the next
      // explicit refresh.
    }
  };

  const refresh = async () => {
    try {
      // Ledger gives us per-scan chain-broken / verified flags; fetched
      // alongside the scan list so the table can flag chain breaks
      // without a second round-trip per row. Ledger failures are
      // non-fatal — the table still renders, it just loses the chain
      // overlay for that refresh. info() is fetched too so the empty
      // state can show the host/token a new operator needs to type
      // into their phone.
      const [c, s, l, i, t] = await Promise.all([
        api.getCase(caseId),
        api.listScans(caseId),
        api.getLedger(caseId).catch(() => [] as LedgerEntry[]),
        api.info().catch(() => null),
        api.listTrust().catch(() => [] as TrustedSigner[]),
      ]);
      setTheCase(c);
      setScans(s);
      setLedger(l);
      setInfo(i);
      setTrusted(t);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Index ledger entries by scanId so each row can look up its
  // chain-broken / verify-error status in O(1).
  const ledgerByScan = useMemo(() => {
    const m = new Map<string, LedgerEntry>();
    for (const e of ledger) m.set(e.scanId, e);
    return m;
  }, [ledger]);

  // Roll up the per-scan chain state into one number an investigator
  // can read at a glance from the page header.
  const chainStatus = useMemo(() => summariseChain(ledger), [ledger]);

  useEffect(() => {
    void refresh();
  }, [caseId]);

  const handleDeleteCase = async () => {
    if (!confirm('Delete this case and all of its scans? This cannot be undone.')) return;
    try {
      await api.deleteCase(caseId);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteScan = async (scanId: string, label: string) => {
    if (!confirm(`Delete scan "${label}"? This cannot be undone.`)) return;
    try {
      await api.deleteScan(caseId, scanId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Group scans by target. Untagged scans go into a "" key, displayed last.
  const groups = useMemo(() => {
    if (!scans) return [];
    const byTarget = new Map<string, Scan[]>();
    for (const s of scans) {
      const key = (s.target ?? '').trim();
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key)!.push(s);
    }
    const out = Array.from(byTarget.entries())
      .map(([target, scans]) => ({ target, scans }))
      .sort((a, b) => {
        // "Untagged" group last so the operator's named groups come first.
        if (a.target === '' && b.target !== '') return 1;
        if (b.target === '' && a.target !== '') return -1;
        return a.target.localeCompare(b.target);
      });
    return out;
  }, [scans]);

  return (
    <Box>
      <PageHeader
        above={
          <Link
            component="button"
            type="button"
            onClick={onBack}
            underline="hover"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: 13,
              color: 'text.secondary',
            }}
          >
            <ArrowBackRoundedIcon fontSize="small" />
            Cases
          </Link>
        }
        title={theCase?.name ?? 'Case'}
        subtitle={
          theCase?.notes
            ? theCase.notes
            : theCase
              ? `Created ${formatRelative(theCase.createdAt)}`
              : 'Loading…'
        }
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            {ledger.length > 0 && (
              <ChainSummaryChip
                status={chainStatus}
                onClick={() => setChainOpen(true)}
              />
            )}
            <Tooltip title="Refresh">
              <IconButton onClick={() => void refresh()} size="small">
                <RefreshRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={handleDeleteCase}
              size="small"
            >
              Delete case
            </Button>
          </Stack>
        }
      />

      <ChainDialog
        open={chainOpen}
        onClose={() => setChainOpen(false)}
        ledger={ledger}
      />

      <Box sx={{ px: 4, pb: 6, pt: 3 }}>
        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        {scans === null ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : scans.length === 0 ? (
          <EmptyScansState caseId={caseId} info={info} />
        ) : (
          <Stack spacing={3}>
            {groups.map((g) => (
              <ScanGroup
                key={g.target}
                target={g.target}
                scans={g.scans}
                ledgerByScan={ledgerByScan}
                trustedSet={trustedSet}
                onOpenScan={onOpenScan}
                onOpenTimeSeries={onOpenTimeSeries}
                onDeleteScan={handleDeleteScan}
                onTrustChanged={() => void reloadTrust()}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

function ScanGroup({
  target,
  scans,
  ledgerByScan,
  trustedSet,
  onOpenScan,
  onOpenTimeSeries,
  onDeleteScan,
  onTrustChanged,
}: {
  target: string;
  scans: Scan[];
  ledgerByScan: Map<string, LedgerEntry>;
  trustedSet: Set<string>;
  onOpenScan: (scanId: string) => void;
  onOpenTimeSeries: (target: string) => void;
  onDeleteScan: (scanId: string, label: string) => void;
  onTrustChanged: () => void;
}) {
  const displayName = target || UNTAGGED_LABEL;
  // Sort within a group oldest-first so the time-series narrative reads
  // top-to-bottom from earliest visit to latest.
  const ordered = useMemo(
    () =>
      [...scans].sort(
        (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
      ),
    [scans],
  );

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Typography
            variant="overline"
            sx={{ color: target ? 'primary.main' : 'text.secondary', fontSize: 11 }}
          >
            {displayName}
          </Typography>
          <Chip
            label={`${scans.length} scan${scans.length === 1 ? '' : 's'}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: 10, height: 20 }}
          />
        </Stack>
        <Tooltip
          title={
            scans.length < 2
              ? 'Time-series needs at least two scans of the same target'
              : 'Open time-series view'
          }
        >
          <span>
            <Button
              size="small"
              startIcon={<TimelineRoundedIcon />}
              onClick={() => onOpenTimeSeries(target)}
              disabled={scans.length < 2}
            >
              Time-series
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 28 }} />
              <TableCell>Label</TableCell>
              <TableCell>Captured</TableCell>
              <TableCell sx={{ width: 200 }}>Change</TableCell>
              <TableCell align="right">Regions</TableCell>
              <TableCell sx={{ width: 200 }}>Producer</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((s) => {
              const entry = ledgerByScan.get(s.id);
              return (
                <TableRow
                  key={s.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => onOpenScan(s.id)}
                >
                  <TableCell sx={{ pr: 0 }}>
                    <ChainStatusCell entry={entry} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {s.label || 'Untitled scan'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={formatAbsolute(s.capturedAt)}>
                      <span>{formatRelative(s.capturedAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <ChangeBar pct={s.stats.changedPct} pixels={s.stats.changedPixels} />
                  </TableCell>
                  <TableCell align="right">{formatInt(s.stats.regions)}</TableCell>
                  <TableCell>
                    <ProducerCell
                      scan={s}
                      trustedSet={trustedSet}
                      onTrustChanged={onTrustChanged}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={s.source}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Delete scan">
                      <IconButton
                        size="small"
                        onClick={() => onDeleteScan(s.id, s.label)}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ChainStatusCell warns about a broken chain. A broken chain means the
// scan's prevHash didn't link cleanly to the previous scan in the case
// — usually because a scan was deleted or reordered out-of-band. We
// surface this in the leftmost gutter so it can't be missed.
function ChainStatusCell({ entry }: { entry: LedgerEntry | undefined }) {
  if (!entry) return null;
  if (entry.chainBroken) {
    return (
      <Tooltip title="Chain of custody broken — prev-hash does not match the preceding scan in this case.">
        <LinkOffRoundedIcon fontSize="small" sx={{ color: 'error.main' }} />
      </Tooltip>
    );
  }
  if (entry.verifyError) {
    return (
      <Tooltip title={`Content hash mismatch: ${entry.verifyError}`}>
        <LinkOffRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
      </Tooltip>
    );
  }
  return null;
}

// ProducerCell renders signature + producer trust status:
//   - verified + trusted    → green check + fingerprint chip
//   - verified + unknown    → yellow "unknown producer" chip + "Trust" button
//   - signed, sig failed    → red "signature failed" chip
//   - unsigned              → yellow "unsigned" chip
// The trust click handler talks to /api/v1/trust/fingerprints directly
// and asks the parent to refresh the trust set without re-fetching scans.
function ProducerCell({
  scan,
  trustedSet,
  onTrustChanged,
}: {
  scan: Scan;
  trustedSet: Set<string>;
  onTrustChanged: () => void;
}) {
  const fpRaw = (scan.signerFingerprint ?? '').toLowerCase();
  const fpShort = fpRaw.slice(0, 8);
  const trusted = !!fpRaw && trustedSet.has(fpRaw);

  if (scan.signed && scan.verified) {
    if (trusted) {
      return (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title={`Trusted producer · ${scan.signerFingerprint}`}>
            <GppGoodRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
          </Tooltip>
          <Chip
            label={fpShort}
            size="small"
            variant="outlined"
            color="success"
            sx={{ fontFamily: 'monospace', fontSize: 10, height: 20 }}
          />
        </Stack>
      );
    }
    // Verified but unknown producer — surface a one-click "Trust"
    // affordance so the operator can promote known fingerprints
    // straight from a row instead of round-tripping via Settings.
    const handleTrust = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!fpRaw) return;
      const label = window.prompt(
        `Label for producer ${fpShort}? (optional)`,
        '',
      );
      if (label === null) return;
      try {
        await api.addTrust(fpRaw, label || undefined);
        onTrustChanged();
      } catch (err) {
        alert(`Failed to trust producer: ${(err as Error).message}`);
      }
    };
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title="Signature is valid, but this fingerprint is not in your trust list.">
          <Chip
            icon={<HelpOutlineRoundedIcon fontSize="small" />}
            label={fpShort || 'unknown producer'}
            size="small"
            color="warning"
            variant="outlined"
            sx={{ fontFamily: fpShort ? 'monospace' : undefined, fontSize: 11 }}
          />
        </Tooltip>
        <Tooltip title="Add this fingerprint to the trusted producers list.">
          <Button
            size="small"
            onClick={handleTrust}
            sx={{ minWidth: 0, px: 0.75, py: 0.25, fontSize: 10 }}
          >
            Trust
          </Button>
        </Tooltip>
      </Stack>
    );
  }
  if (scan.signed && !scan.verified) {
    return (
      <Tooltip title="Pack was signed but the signature did not validate. Treat with care.">
        <Chip
          icon={<GppMaybeRoundedIcon fontSize="small" />}
          label="signature failed"
          size="small"
          color="error"
          variant="outlined"
          sx={{ fontSize: 11 }}
        />
      </Tooltip>
    );
  }
  return (
    <Tooltip title="No producer signature attached. Tampering before import cannot be detected.">
      <Chip
        icon={<HelpOutlineRoundedIcon fontSize="small" />}
        label="unsigned"
        size="small"
        variant="outlined"
        color="warning"
        sx={{ fontSize: 11 }}
      />
    </Tooltip>
  );
}

// ChangeBar shows changedPct as a small numeric value plus a colored
// bar that saturates at 25%. The colour buckets give a quick
// "low/medium/high" read across a long scan list.
function ChangeBar({ pct, pixels }: { pct: number; pixels: number }) {
  const safe = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  // 25% is the saturation point — most TSCM "interesting" scans land
  // well under it, anything past is unambiguous "lots changed".
  const filled = Math.min(safe / 25, 1);
  let colour: string;
  if (safe < 1) colour = 'success.main';
  else if (safe < 5) colour = 'warning.main';
  else colour = 'error.main';

  return (
    <Tooltip title={`${formatInt(pixels)} pixels changed`}>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} sx={{ color: colour }}>
          {formatPct(safe)}
        </Typography>
        <Box
          sx={{
            height: 4,
            borderRadius: 2,
            backgroundColor: 'action.hover',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${filled * 100}%`,
              backgroundColor: colour,
              transition: 'width 200ms ease',
            }}
          />
        </Box>
      </Stack>
    </Tooltip>
  );
}

// EmptyScansState is what a first-time operator sees when they land in a
// newly-created case. Instead of just saying "no scans yet", it shows the
// exact host + token they need to type into the phone, plus the case ID
// so the upload lands in this case automatically.
function EmptyScansState({
  caseId,
  info,
}: {
  caseId: string;
  info: ServerInfo | null;
}) {
  // Derive the host the phone needs to reach. The browser sees this same
  // origin already, so just stripping the path off window.location gives
  // the LAN URL the operator should type. Falls back gracefully if window
  // isn't available (SSR / Bun build).
  const host =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : '';
  const token = info?.token ?? '';

  return (
    <Paper variant="outlined" sx={{ p: 4 }}>
      <Stack spacing={1} alignItems="center" sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="h6">No scans in this case yet</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
          Capture a before / after pair on the phone, save it to History,
          then send it to this desktop. The pack will land in this case
          automatically.
        </Typography>
      </Stack>

      <Box sx={{ maxWidth: 560, mx: 'auto' }}>
        <OnboardStep
          number={1}
          title="Pair the phone (one-time)"
          body={
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                On the phone, open <strong>Settings → PixelSentinel desktop</strong> and
                paste these two values.
              </Typography>
              <CopyField label="Host URL" value={host} />
              <CopyField
                label="Pairing token"
                value={token}
                mono
                placeholder={token ? undefined : 'loading…'}
              />
            </Stack>
          }
        />
        <OnboardStep
          number={2}
          title="Capture a scan"
          body={
            <Typography variant="body2" color="text.secondary">
              On the phone: <em>Acquisition → Scan reference, Scan current → Run
              detection → Save to history</em>. The phone signs every saved
              scan with its hardware-backed key so the desktop can verify it
              on arrival.
            </Typography>
          }
        />
        <OnboardStep
          number={3}
          title="Send to this case"
          last
          body={
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                In the phone's History tab, tap <strong>Send</strong> on the saved
                scan and pick this case. Or use the case ID directly:
              </Typography>
              <CopyField label="Case ID" value={caseId} mono />
            </Stack>
          }
        />
      </Box>
    </Paper>
  );
}

function OnboardStep({
  number,
  title,
  body,
  last,
}: {
  number: number;
  title: string;
  body: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ mb: last ? 0 : 2.5 }}>
      <Box
        sx={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid',
          borderColor: 'primary.main',
          color: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {number}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          {title}
        </Typography>
        {body}
      </Box>
    </Stack>
  );
}

function CopyField({
  label,
  value,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  mono?: boolean;
  placeholder?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable on older webviews; silently
      // ignore — the value is still selectable on screen.
    }
  };
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 92, fontSize: 11 }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          px: 1.25,
          py: 0.75,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.default',
          fontFamily: mono ? 'monospace' : 'inherit',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value || placeholder || '—'}
      </Box>
      <Button size="small" onClick={handleCopy} disabled={!value} sx={{ minWidth: 70 }}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </Stack>
  );
}

// ── Chain of custody ─────────────────────────────────────────────────────

interface ChainSummary {
  total: number;
  intact: number;
  broken: number;
  badContent: number; // verify error but chain intact
}

function summariseChain(ledger: LedgerEntry[]): ChainSummary {
  let broken = 0;
  let badContent = 0;
  for (const e of ledger) {
    if (e.chainBroken) broken++;
    else if (!e.verified && e.verifyError) badContent++;
  }
  return {
    total: ledger.length,
    intact: ledger.length - broken - badContent,
    broken,
    badContent,
  };
}

function ChainSummaryChip({
  status,
  onClick,
}: {
  status: ChainSummary;
  onClick: () => void;
}) {
  const allGood = status.broken === 0 && status.badContent === 0;
  return (
    <Tooltip
      title={
        allGood
          ? 'Chain of custody intact — every scan links to the previous one and reproduces from disk.'
          : 'Chain integrity issue detected. Click for details.'
      }
    >
      <Chip
        icon={
          allGood ? (
            <CheckCircleRoundedIcon fontSize="small" />
          ) : (
            <LinkOffRoundedIcon fontSize="small" />
          )
        }
        label={
          allGood
            ? `Chain: ${status.total}/${status.total} linked`
            : `Chain: ${status.broken + status.badContent} issue${
                status.broken + status.badContent === 1 ? '' : 's'
              }`
        }
        size="small"
        color={allGood ? 'success' : 'error'}
        variant={allGood ? 'outlined' : 'filled'}
        onClick={onClick}
        sx={{ fontSize: 11, cursor: 'pointer' }}
      />
    </Tooltip>
  );
}

// ChainDialog renders the full hash chain for a case as a vertical
// timeline: each scan's contentHash, an arrow down to the next scan,
// red break markers where prevHash doesn't match, amber markers where
// the on-disk bytes no longer reproduce the recorded hash. This is the
// view an investigator opens to defend the chain in a write-up.
function ChainDialog({
  open,
  onClose,
  ledger,
}: {
  open: boolean;
  onClose: () => void;
  ledger: LedgerEntry[];
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TimelineRoundedIcon fontSize="small" />
        Chain of custody
      </DialogTitle>
      <DialogContent dividers>
        {ledger.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Chain is empty — no scans have been imported yet.
          </Typography>
        ) : (
          <Stack spacing={0}>
            {ledger.map((entry, idx) => (
              <ChainStep
                key={entry.scanId}
                entry={entry}
                isFirst={idx === 0}
                isLast={idx === ledger.length - 1}
              />
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function ChainStep({
  entry,
  isFirst,
  isLast,
}: {
  entry: LedgerEntry;
  isFirst: boolean;
  isLast: boolean;
}) {
  const short = (h: string | undefined | null) => (h ? h.slice(0, 16) : '∅');

  return (
    <Box>
      {/* Break marker between this scan and the previous one. The first
          scan in a case has no previous, so the marker only renders from
          the second onwards. */}
      {!isFirst && (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ ml: 1.5, color: entry.chainBroken ? 'error.main' : 'text.secondary' }}
        >
          <Box
            sx={{
              width: 2,
              height: 24,
              backgroundColor: entry.chainBroken ? 'error.main' : 'divider',
            }}
          />
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10 }}>
            {entry.chainBroken ? '⚠ prev-hash mismatch' : '↓ linked'}
          </Typography>
        </Stack>
      )}

      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderLeftWidth: 3,
          borderLeftColor: entry.chainBroken
            ? 'error.main'
            : entry.verifyError
              ? 'warning.main'
              : 'success.main',
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2">
              {entry.label || 'Untitled scan'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {formatAbsolute(entry.capturedAt)} · scan {entry.scanId.slice(0, 8)}
            </Typography>
            <Box sx={{ mt: 1, fontFamily: 'monospace', fontSize: 11 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                prev: {short(entry.prevHash) || '(genesis)'}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block' }}>
                hash: {short(entry.contentHash)}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ flexShrink: 0 }}>
            {entry.verified ? (
              <Tooltip title="Content hash on disk matches the recorded hash.">
                <CheckCircleRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
              </Tooltip>
            ) : (
              <Tooltip title={entry.verifyError || 'Content mismatch'}>
                <LinkOffRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
              </Tooltip>
            )}
          </Box>
        </Stack>
      </Paper>

      {/* Spacer between this scan and the next break marker. */}
      {!isLast && <Box sx={{ height: 8 }} />}
    </Box>
  );
}
