import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import GppGoodRoundedIcon from '@mui/icons-material/GppGoodRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { api, type ServerInfo, type TrustedSigner } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';
import { formatAbsolute } from '../utils/format';

export function SettingsPage() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const i = await api.info();
        if (!cancelled) setInfo(i);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers — fall back to selection.
    }
  };

  return (
    <Box>
      <PageHeader
        title="Settings"
        subtitle="Server identity, library location, and the pairing token your phone needs to send Evidence Packs."
      />

      <Box sx={{ px: 4, py: 3, maxWidth: 720 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
              Server
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <KV label="Name" value={info?.name ?? '…'} />
              <KV label="Version" value={info?.version ?? '…'} />
              <KV label="Library" value={info?.dataDir ?? '…'} />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
              Phone pairing
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
              The phone client must send this token in the
              {' '}
              <code>X-PixelSentinel-Token</code> header when uploading
              Evidence Packs. Treat it like a password — anyone holding it
              can write into your case library.
            </Typography>

            {info?.token ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  fullWidth
                  size="small"
                  value={info.token}
                  type={revealToken ? 'text' : 'password'}
                  InputProps={{ readOnly: true, sx: { fontFamily: 'monospace' } }}
                />
                <Tooltip title={revealToken ? 'Hide' : 'Reveal'}>
                  <IconButton onClick={() => setRevealToken((r) => !r)}>
                    {revealToken ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={copied ? 'Copied' : 'Copy'}>
                  <IconButton onClick={() => void copy(info.token!)}>
                    <ContentCopyRoundedIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            ) : (
              <Alert severity="warning">
                Pairing token is only visible when this UI is loaded over loopback
                (i.e. directly from <code>localhost</code>). Run PixelSentinel locally
                to see it.
              </Alert>
            )}

            <Box sx={{ mt: 3 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
                Phone instructions
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  mt: 1,
                  p: 2,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  backgroundColor: 'background.default',
                  whiteSpace: 'pre',
                  overflowX: 'auto',
                }}
              >
{`POST http://<this-machine-ip>:7421/api/v1/import/pack
Content-Type: application/zip
X-PixelSentinel-Token: ${info?.token ?? '<token>'}

<Evidence Pack zip body>`}
              </Paper>
            </Box>
          </Paper>

          <TrustedProducersCard />

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
              About
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              PixelSentinel is forked from{' '}
              <a
                href="https://github.com/skinnyrad/TSCM-Change-Detection"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit' }}
              >
                skinnyrad/TSCM-Change-Detection
              </a>
              {' '}(MIT, © 2024 Skinny R&amp;D). The pure-Go imgproc core is
              unchanged from upstream.
            </Typography>
            <Button
              size="small"
              sx={{ mt: 1.5 }}
              onClick={() => window.open('https://github.com/silvance/ChangeDetection', '_blank')}
            >
              Project source
            </Button>
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 80, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: label === 'Library' ? 'monospace' : undefined }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

// TrustedProducersCard lets the operator curate the allow-list of phone
// fingerprints whose signed packs should be treated as "known". A signed
// pack from a producer NOT in this list still imports successfully — it
// just gets a yellow "unknown producer" badge in the scan list. This is
// the right default for forensic tooling: never silently reject, always
// surface the trust decision to the human.
function TrustedProducersCard() {
  const [signers, setSigners] = useState<TrustedSigner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fp, setFp] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    try {
      setSigners(await api.listTrust());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAdd = async () => {
    if (!fp.trim()) return;
    setAdding(true);
    try {
      await api.addTrust(fp.trim(), label.trim() || undefined);
      setFp('');
      setLabel('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (fingerprint: string) => {
    if (!confirm(`Remove ${fingerprint} from the trusted producers list?`)) return;
    try {
      await api.removeTrust(fingerprint);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <GppGoodRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10 }}>
          Trusted producers
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Phone signing keys you recognise. Signed scans from a producer in
        this list show a green badge in the case view; signed scans from
        producers <em>not</em> in the list still import, but get flagged
        as "unknown producer" so a stranger's signature can't pass for
        yours unnoticed.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Fingerprint"
          placeholder="abcd1234abcd1234"
          value={fp}
          onChange={(e) => setFp(e.target.value)}
          sx={{ flex: 1, '& input': { fontFamily: 'monospace' } }}
        />
        <TextField
          size="small"
          label="Label (optional)"
          placeholder="e.g. John's phone"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          onClick={handleAdd}
          disabled={!fp.trim() || adding}
          sx={{ height: 40 }}
        >
          Trust
        </Button>
      </Stack>

      {signers === null ? null : signers.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          No trusted producers yet. Imported scans will show as
          "unknown producer" until you label their fingerprint here.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {signers.map((s) => (
            <Stack
              key={s.fingerprint}
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ p: 1, borderRadius: 1, '&:hover': { backgroundColor: 'action.hover' } }}
            >
              <Chip
                label={s.fingerprint}
                size="small"
                variant="outlined"
                color="success"
                sx={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {s.label || <em style={{ color: 'rgba(255,255,255,0.5)' }}>unlabelled</em>}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Added {formatAbsolute(s.addedAt)}
                </Typography>
              </Box>
              <Tooltip title="Remove from trust list">
                <IconButton size="small" onClick={() => void handleRemove(s.fingerprint)}>
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
