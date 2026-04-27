import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { api, type Scan } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { ImageComparisonTab } from '../components/ImageComparisonTab';
import { formatAbsolute, formatInt, formatPct } from '../utils/format';

interface Props {
  caseId: string;
  scanId: string;
  onBack: () => void;
}

export function ScanDetailPage({ caseId, scanId, onBack }: Props) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getScan(caseId, scanId);
        if (!cancelled) setScan(s);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, scanId]);

  const handleSaveEdit = async (label: string, target: string) => {
    try {
      const updated = await api.patchScan(caseId, scanId, { label, target });
      setScan(updated);
      setEditOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <Box>
        <PageHeader
          above={<BackLink onClick={onBack} />}
          title="Scan not found"
          subtitle={error}
        />
      </Box>
    );
  }
  if (!scan) {
    return (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <CircularProgress size={28} />
      </Stack>
    );
  }

  const beforeUrl = api.scanFileUrl(caseId, scanId, scan.files.before);
  const afterUrl = api.scanFileUrl(caseId, scanId, scan.files.after);
  const resultUrl = scan.files.result ? api.scanFileUrl(caseId, scanId, scan.files.result) : null;

  return (
    <Box>
      <PageHeader
        above={<BackLink onClick={onBack} />}
        title={
          <Stack direction="row" alignItems="center" spacing={1}>
            <span>{scan.label || 'Untitled scan'}</span>
            <Tooltip title="Edit metadata">
              <IconButton
                size="small"
                onClick={() => setEditOpen(true)}
                sx={{ color: 'text.secondary' }}
              >
                <EditRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center">
            <span>
              Captured {formatAbsolute(scan.capturedAt)} · imported{' '}
              {formatAbsolute(scan.importedAt)}
            </span>
            {scan.target && (
              <Chip
                label={scan.target}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ fontSize: 11 }}
              />
            )}
          </Stack>
        }
        actions={<Chip label={scan.source} size="small" variant="outlined" />}
      />

      <EditMetadataDialog
        open={editOpen}
        initial={{ label: scan.label, target: scan.target ?? '' }}
        onCancel={() => setEditOpen(false)}
        onSave={handleSaveEdit}
      />

      <Box sx={{ px: 4, py: 3 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Stack spacing={3}>
              {resultUrl && (
                <ImageCard title="Result (highlight)" url={resultUrl} accent />
              )}

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ fontSize: 10, display: 'block', mb: 1 }}
                >
                  Before / After comparison
                </Typography>
                <ImageComparisonTab beforeUrl={beforeUrl} afterUrl={afterUrl} />
              </Paper>
            </Stack>
          </Grid>

          <Grid item xs={12} md={4}>
            <Stack spacing={2}>
              <StatsCard scan={scan} />
              <ParamsCard scan={scan} />
              <ChainCard scan={scan} />
            </Stack>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
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
      Back
    </Link>
  );
}

function ImageCard({ title, url, accent }: { title: string; url: string; accent?: boolean }) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: accent ? 'primary.main' : 'divider',
      }}
    >
      <CardMedia
        component="img"
        image={url}
        alt={title}
        sx={{
          backgroundColor: 'background.default',
          maxHeight: accent ? 480 : 280,
          objectFit: 'contain',
        }}
      />
      <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Typography
          variant="overline"
          color={accent ? 'primary.main' : 'text.secondary'}
          sx={{ fontSize: 10 }}
        >
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

function StatsCard({ scan }: { scan: Scan }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
        Detection
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 1.25 }}>
        <StatRow label="Changed area" value={formatPct(scan.stats.changedPct)} highlight />
        <StatRow label="Changed pixels" value={formatInt(scan.stats.changedPixels)} />
        <StatRow label="Regions" value={formatInt(scan.stats.regions)} />
      </Stack>
    </Paper>
  );
}

function ParamsCard({ scan }: { scan: Scan }) {
  const p = scan.params;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
        Parameters
      </Typography>
      <Stack spacing={1} sx={{ mt: 1.25 }}>
        <StatRow label="Strength" value={String(p.strength)} />
        <StatRow label="Noise reduction" value={String(p.morphSize)} />
        <StatRow label="Fill gaps" value={String(p.closeSize)} />
        <StatRow label="Min region (px)" value={String(p.minRegion)} />
        <StatRow label="Pre-blur σ" value={p.preBlurSigma.toFixed(2)} />
        <StatRow label="Normalize luma" value={p.normalizeLuma ? 'on' : 'off'} />
        <Divider sx={{ my: 0.5 }} />
        <StatRow
          label="Highlight"
          value={
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: 0.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: `rgb(${p.highlightR}, ${p.highlightG}, ${p.highlightB})`,
                  opacity: p.highlightAlpha,
                }}
              />
              <Typography variant="body2">{Math.round(p.highlightAlpha * 100)}%</Typography>
            </Stack>
          }
        />
      </Stack>
    </Paper>
  );
}

function EditMetadataDialog({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: { label: string; target: string };
  onCancel: () => void;
  onSave: (label: string, target: string) => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [target, setTarget] = useState(initial.target);

  useEffect(() => {
    if (open) {
      setLabel(initial.label);
      setTarget(initial.target);
    }
  }, [open, initial.label, initial.target]);

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Edit scan metadata</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            fullWidth
          />
          <TextField
            label="Target"
            placeholder="e.g. Conference Room A — North Wall"
            helperText="Group scans of the same place across visits to enable the time-series view."
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onSave(label.trim(), target.trim())}
          disabled={!label.trim()}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ChainCard({ scan }: { scan: Scan }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
        Chain of custody
      </Typography>
      <Stack spacing={1.25} sx={{ mt: 1.25 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Content hash (SHA-256)
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}
          >
            {scan.contentHash || '—'}
          </Typography>
        </Box>
        {scan.prevHash && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Previous in case
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}
            >
              {scan.prevHash}
            </Typography>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        color={highlight ? 'primary.main' : 'text.primary'}
        fontWeight={highlight ? 600 : 500}
      >
        {value}
      </Typography>
    </Stack>
  );
}
