import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import { api, type CaseSummary } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatRelative } from '../utils/format';

interface CasesPageProps {
  onOpen: (caseId: string) => void;
}

export function CasesPage({ onOpen }: CasesPageProps) {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const refresh = async () => {
    try {
      setCases(await api.listCases());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await api.createCase(name, newNotes.trim() || undefined);
      setNewName('');
      setNewNotes('');
      setCreateOpen(false);
      await refresh();
      onOpen(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Cases"
        subtitle="Group related sweeps and the evidence captured during them."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            New case
          </Button>
        }
      />

      <Box sx={{ px: 4, pb: 6 }}>
        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        {cases === null ? (
          <Stack alignItems="center" sx={{ py: 8 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : cases.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 2,
            }}
          >
            {cases.map((c) => (
              <Card key={c.id} variant="outlined">
                <CardActionArea onClick={() => onOpen(c.id)} sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="h6" sx={{ pr: 1 }}>
                        {c.name}
                      </Typography>
                      <Chip
                        size="small"
                        label={`${c.scanCount} scan${c.scanCount === 1 ? '' : 's'}`}
                        color={c.scanCount > 0 ? 'primary' : 'default'}
                        variant={c.scanCount > 0 ? 'filled' : 'outlined'}
                      />
                    </Stack>
                    {c.notes && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>
                        {c.notes}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
                      Updated {formatRelative(c.updatedAt)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}
      </Box>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New case</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Name"
              placeholder="e.g. 5th-floor exec sweep"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Notes (optional)"
              multiline
              minRows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim() || creating}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Stack
      alignItems="center"
      spacing={2}
      sx={{
        py: 10,
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 2,
        textAlign: 'center',
      }}
    >
      <FolderOpenRoundedIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
      <Typography variant="h6">No cases yet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380 }}>
        Cases hold the scans captured during a sweep. Create one and the
        phone client (or any Evidence Pack import) will land scans inside it.
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
        Create your first case
      </Button>
    </Stack>
  );
}
