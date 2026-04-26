import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { api, type ServerInfo } from '../api/v1';
import { PageHeader } from '../components/shell/PageHeader';

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
