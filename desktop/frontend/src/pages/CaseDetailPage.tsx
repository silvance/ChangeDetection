import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import GppGoodRoundedIcon from '@mui/icons-material/GppGoodRounded';
import GppMaybeRoundedIcon from '@mui/icons-material/GppMaybeRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import { api, type Case, type LedgerEntry, type Scan } from '../api/v1';
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
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      // Ledger gives us per-scan chain-broken / verified flags; fetched
      // alongside the scan list so the table can flag chain breaks
      // without a second round-trip per row. Ledger failures are
      // non-fatal — the table still renders, it just loses the chain
      // overlay for that refresh.
      const [c, s, l] = await Promise.all([
        api.getCase(caseId),
        api.listScans(caseId),
        api.getLedger(caseId).catch(() => [] as LedgerEntry[]),
      ]);
      setTheCase(c);
      setScans(s);
      setLedger(l);
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
          <Stack direction="row" spacing={1}>
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
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ mb: 1 }}>
              No scans in this case yet.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Send an Evidence Pack from the phone client and target this case
              to populate it.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={3}>
            {groups.map((g) => (
              <ScanGroup
                key={g.target}
                target={g.target}
                scans={g.scans}
                ledgerByScan={ledgerByScan}
                onOpenScan={onOpenScan}
                onOpenTimeSeries={onOpenTimeSeries}
                onDeleteScan={handleDeleteScan}
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
  onOpenScan,
  onOpenTimeSeries,
  onDeleteScan,
}: {
  target: string;
  scans: Scan[];
  ledgerByScan: Map<string, LedgerEntry>;
  onOpenScan: (scanId: string) => void;
  onOpenTimeSeries: (target: string) => void;
  onDeleteScan: (scanId: string, label: string) => void;
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
                    <ProducerCell scan={s} />
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

// ProducerCell renders signature status (verified / unverified / unsigned)
// plus a short fingerprint. Investigators need to see this at a glance
// when reviewing a long case.
function ProducerCell({ scan }: { scan: Scan }) {
  const fp = (scan.signerFingerprint ?? '').slice(0, 8);
  if (scan.signed && scan.verified) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title={`Signature verified${scan.signerFingerprint ? ` · ${scan.signerFingerprint}` : ''}`}>
          <GppGoodRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
        </Tooltip>
        {fp && (
          <Chip
            label={fp}
            size="small"
            variant="outlined"
            sx={{ fontFamily: 'monospace', fontSize: 10, height: 20 }}
          />
        )}
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
