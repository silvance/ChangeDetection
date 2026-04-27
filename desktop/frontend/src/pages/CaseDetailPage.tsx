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
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import { api, type Case, type Scan } from '../api/v1';
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
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, s] = await Promise.all([api.getCase(caseId), api.listScans(caseId)]);
      setTheCase(c);
      setScans(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
  onOpenScan,
  onOpenTimeSeries,
  onDeleteScan,
}: {
  target: string;
  scans: Scan[];
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
              <TableCell>Label</TableCell>
              <TableCell>Captured</TableCell>
              <TableCell align="right">Change</TableCell>
              <TableCell align="right">Pixels</TableCell>
              <TableCell align="right">Regions</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right">Result</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((s) => (
              <TableRow
                key={s.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => onOpenScan(s.id)}
              >
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
                <TableCell align="right">
                  <Typography variant="body2" color="primary.main" fontWeight={500}>
                    {formatPct(s.stats.changedPct)}
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatInt(s.stats.changedPixels)}</TableCell>
                <TableCell align="right">{formatInt(s.stats.regions)}</TableCell>
                <TableCell>
                  <Chip
                    label={s.source}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: 11 }}
                  />
                </TableCell>
                <TableCell align="right">
                  {s.files.result ? (
                    <Chip label="✓" size="small" color="success" variant="outlined" />
                  ) : (
                    <Chip label="—" size="small" variant="outlined" />
                  )}
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
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
