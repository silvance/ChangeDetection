import { useEffect, useState } from 'react';
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
import { api, type Case, type Scan } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatAbsolute, formatInt, formatPct, formatRelative } from '../utils/format';

interface Props {
  caseId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenScan: (scanId: string) => void;
}

export function CaseDetailPage({ caseId, onBack, onDeleted, onOpenScan }: Props) {
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
                {scans.map((s) => (
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
                          onClick={() => handleDeleteScan(s.id, s.label)}
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
        )}
      </Box>
    </Box>
  );
}
