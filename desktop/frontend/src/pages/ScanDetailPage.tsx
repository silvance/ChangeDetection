import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardMedia from '@mui/material/CardMedia';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { api, type Scan } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatAbsolute, formatInt, formatPct } from '../utils/format';

interface Props {
  caseId: string;
  scanId: string;
  onBack: () => void;
}

export function ScanDetailPage({ caseId, scanId, onBack }: Props) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        title={scan.label || 'Untitled scan'}
        subtitle={`Captured ${formatAbsolute(scan.capturedAt)} · imported ${formatAbsolute(scan.importedAt)}`}
        actions={<Chip label={scan.source} size="small" variant="outlined" />}
      />

      <Box sx={{ px: 4, py: 3 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Stack spacing={2}>
              {resultUrl && (
                <ImageCard title="Result (highlight)" url={resultUrl} accent />
              )}
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <ImageCard title="Before" url={beforeUrl} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <ImageCard title="After" url={afterUrl} />
                </Grid>
              </Grid>
            </Stack>
          </Grid>

          <Grid item xs={12} md={4}>
            <Stack spacing={2}>
              <StatsCard scan={scan} />
              <ParamsCard scan={scan} />
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
