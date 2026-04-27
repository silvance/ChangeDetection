import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import { LineChart } from '@mui/x-charts/LineChart';
import { api, type Case, type Scan } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatAbsolute, formatPct, formatRelative } from '../utils/format';

const UNTAGGED_LABEL = 'Untagged';

interface Props {
  caseId: string;
  /** Empty string = the "Untagged" group. */
  target: string;
  onBack: () => void;
  onOpenScan: (scanId: string) => void;
}

export function TimeSeriesPage({ caseId, target, onBack, onOpenScan }: Props) {
  const [theCase, setTheCase] = useState<Case | null>(null);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [intervalMs, setIntervalMs] = useState(900);
  const playTimer = useRef<number | null>(null);

  // Load case + scans, filter to target, oldest-first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, all] = await Promise.all([
          api.getCase(caseId),
          api.listScans(caseId),
        ]);
        if (cancelled) return;
        setTheCase(c);
        const filtered = all
          .filter((s) => (s.target ?? '') === target)
          .sort(
            (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
          );
        setScans(filtered);
        setSelectedIdx(0);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, target]);

  // Autoplay timer.
  useEffect(() => {
    if (!playing || !scans || scans.length < 2) return;
    playTimer.current = window.setInterval(() => {
      setSelectedIdx((i) => (i + 1) % scans.length);
    }, intervalMs);
    return () => {
      if (playTimer.current !== null) {
        window.clearInterval(playTimer.current);
        playTimer.current = null;
      }
    };
  }, [playing, intervalMs, scans]);

  if (error) {
    return (
      <Box>
        <PageHeader above={<BackLink onClick={onBack} />} title="Not found" subtitle={error} />
      </Box>
    );
  }
  if (!scans || !theCase) {
    return (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <CircularProgress size={28} />
      </Stack>
    );
  }
  if (scans.length === 0) {
    return (
      <Box>
        <PageHeader
          above={<BackLink onClick={onBack} />}
          title="No scans for this target"
          subtitle="Tag scans on their detail pages to add them to this group."
        />
      </Box>
    );
  }

  const current = scans[selectedIdx]!;
  const span = formatSpan(scans);
  const displayName = target || UNTAGGED_LABEL;

  return (
    <Box>
      <PageHeader
        above={<BackLink onClick={onBack} caseName={theCase.name} />}
        title={displayName}
        subtitle={
          <span>
            {scans.length} scan{scans.length === 1 ? '' : 's'} in{' '}
            <Box component="span" sx={{ color: 'text.primary' }}>
              {theCase.name}
            </Box>
            {span && <> · span {span}</>}
          </span>
        }
      />

      <Box sx={{ px: 4, py: 3 }}>
        <Stack spacing={3}>
          <TrendChart scans={scans} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Viewer scan={current} caseId={caseId} />
            <Controls
              scans={scans}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              intervalMs={intervalMs}
              onIntervalChange={setIntervalMs}
              onOpenScan={() => onOpenScan(current.id)}
            />
          </Paper>

          <Timeline
            scans={scans}
            selectedIdx={selectedIdx}
            onSelect={(i) => {
              setPlaying(false);
              setSelectedIdx(i);
            }}
            caseId={caseId}
          />
        </Stack>
      </Box>
    </Box>
  );
}

function BackLink({ onClick, caseName }: { onClick: () => void; caseName?: string }) {
  return (
    <Link
      component="button"
      type="button"
      onClick={onClick}
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
      {caseName ? `Back to ${caseName}` : 'Back'}
    </Link>
  );
}

function Viewer({ scan, caseId }: { scan: Scan; caseId: string }) {
  const url = scan.files.result
    ? api.scanFileUrl(caseId, scan.id, scan.files.result)
    : api.scanFileUrl(caseId, scan.id, scan.files.after);

  return (
    <Box
      sx={{
        position: 'relative',
        backgroundColor: 'background.default',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        component="img"
        src={url}
        alt={scan.label}
        sx={{
          display: 'block',
          width: '100%',
          maxHeight: '60vh',
          objectFit: 'contain',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 1.5,
          background: 'linear-gradient(to top, rgba(10,14,26,0.85), transparent)',
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-end">
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {scan.label || 'Untitled scan'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatAbsolute(scan.capturedAt)} · {formatRelative(scan.capturedAt)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="baseline">
            <Stat label="Change" value={formatPct(scan.stats.changedPct)} highlight />
            <Stat label="Regions" value={String(scan.stats.regions)} />
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        color={highlight ? 'primary.main' : 'text.primary'}
        fontWeight={600}
      >
        {value}
      </Typography>
    </Box>
  );
}

function Controls({
  scans,
  selectedIdx,
  onSelect,
  playing,
  onTogglePlay,
  intervalMs,
  onIntervalChange,
  onOpenScan,
}: {
  scans: Scan[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  onOpenScan: () => void;
}) {
  const canPrev = selectedIdx > 0;
  const canNext = selectedIdx < scans.length - 1;

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{ px: 2, py: 1.25 }}
    >
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title="Previous">
          <span>
            <IconButton onClick={() => onSelect(selectedIdx - 1)} disabled={!canPrev}>
              <SkipPreviousRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={playing ? 'Pause' : 'Play'}>
          <IconButton onClick={onTogglePlay} color="primary">
            {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Next">
          <span>
            <IconButton onClick={() => onSelect(selectedIdx + 1)} disabled={!canNext}>
              <SkipNextRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {selectedIdx + 1} / {scans.length}
        </Typography>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 220, flex: 1, mx: 3 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          Speed
        </Typography>
        <Slider
          value={2100 - intervalMs}
          onChange={(_, v) => onIntervalChange(2100 - (v as number))}
          min={100}
          max={2000}
          step={50}
          size="small"
          valueLabelDisplay="auto"
          valueLabelFormat={() =>
            intervalMs < 1000 ? `${intervalMs}ms` : `${(intervalMs / 1000).toFixed(1)}s`
          }
        />
      </Stack>

      <Button
        size="small"
        endIcon={<OpenInNewRoundedIcon />}
        onClick={onOpenScan}
      >
        Open scan
      </Button>
    </Stack>
  );
}

function Timeline({
  scans,
  selectedIdx,
  onSelect,
  caseId,
}: {
  scans: Scan[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  caseId: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          overflowX: 'auto',
          pb: 1,
          // Hide ugly scrollbar but keep wheel scrollability.
          scrollbarWidth: 'thin',
        }}
      >
        {scans.map((s, i) => {
          const url = s.files.result
            ? api.scanFileUrl(caseId, s.id, s.files.result)
            : api.scanFileUrl(caseId, s.id, s.files.after);
          const selected = i === selectedIdx;
          return (
            <Box
              key={s.id}
              onClick={() => onSelect(i)}
              sx={{
                flex: '0 0 auto',
                width: 120,
                cursor: 'pointer',
                opacity: selected ? 1 : 0.7,
                '&:hover': { opacity: 1 },
              }}
            >
              <Box
                component="img"
                src={url}
                alt={s.label}
                sx={{
                  width: '100%',
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 1,
                  border: '2px solid',
                  borderColor: selected ? 'primary.main' : 'transparent',
                  backgroundColor: 'background.default',
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.5,
                  fontSize: 10,
                  color: selected ? 'primary.main' : 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {formatRelative(s.capturedAt)}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontSize: 10,
                  color: 'text.secondary',
                }}
              >
                {formatPct(s.stats.changedPct)}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function TrendChart({
  scans,
  selectedIdx,
  onSelect,
}: {
  scans: Scan[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  // x-axis is the scan index (uniform spacing) so points cluster nicely
  // even when capture times are bunched. Tooltip shows the real time.
  const indexes = useMemo(() => scans.map((_, i) => i), [scans]);
  const pcts = useMemo(() => scans.map((s) => s.stats.changedPct), [scans]);
  const labels = useMemo(
    () => scans.map((s, i) => `#${i + 1} · ${formatRelative(s.capturedAt)}`),
    [scans],
  );

  if (scans.length < 2) {
    // Not enough points to plot a trend; fall back to a simple stat row.
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Trend
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Time-series needs at least two scans.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ pt: 1.5, pb: 0.5, px: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Changed area over time
        </Typography>
        <Typography variant="caption" color="text.secondary">
          highest: {formatPct(Math.max(...pcts))} · lowest: {formatPct(Math.min(...pcts))}
        </Typography>
      </Stack>
      <Box sx={{ width: '100%', height: 160, mt: 1 }}>
        <LineChart
          xAxis={[
            {
              data: indexes,
              valueFormatter: (v: number) => labels[v] ?? '',
              tickMinStep: 1,
            },
          ]}
          yAxis={[{ label: '% changed' }]}
          series={[
            {
              data: pcts,
              color: '#22d3ee',
              showMark: true,
              valueFormatter: (v: number | null) => (v == null ? '' : formatPct(v)),
            },
          ]}
          margin={{ left: 50, right: 16, top: 12, bottom: 28 }}
          // Highlight the currently selected point.
          slotProps={{
            mark: {
              fill: '#22d3ee',
              r: 4,
            },
          }}
          onAxisClick={(_, ev) => {
            if (ev?.dataIndex !== undefined && ev.dataIndex !== null) {
              onSelect(Number(ev.dataIndex));
            }
          }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Selected: {labels[selectedIdx]} ({formatPct(pcts[selectedIdx]!)})
      </Typography>
    </Paper>
  );
}

function formatSpan(scans: Scan[]): string {
  if (scans.length < 2) return '';
  const first = new Date(scans[0]!.capturedAt).getTime();
  const last = new Date(scans[scans.length - 1]!.capturedAt).getTime();
  const ms = last - first;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 1) return `${Math.round(ms / (1000 * 60 * 60))} hr`;
  if (days < 14) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
