import { createTheme } from '@mui/material/styles';

// PixelSentinel theme — deliberately distinct from the upstream MUI dark
// default so the app is unmistakable on screen. "Shield blue" accent,
// near-black surfaces, slightly tighter radii.
export const pixelSentinelTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#22d3ee', // cyan-400 — a watchful, monitor-like accent
      dark: '#0891b2',
      contrastText: '#0a0e1a',
    },
    secondary: {
      main: '#fbbf24', // amber-400 — used for "evidence" / "alignment active"
      contrastText: '#0a0e1a',
    },
    error: { main: '#f87171' },
    success: { main: '#34d399' },
    background: {
      default: '#0a0e1a',
      paper: '#111827',
    },
    divider: 'rgba(148, 163, 184, 0.16)',
    text: {
      primary: '#e2e8f0',
      secondary: '#94a3b8',
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '"Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", sans-serif',
    h6: { fontWeight: 700, letterSpacing: '0.02em' },
    button: { textTransform: 'none', fontWeight: 600 },
    overline: { letterSpacing: '0.18em', fontWeight: 700 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: 'rgba(148, 163, 184, 0.16)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#0a0e1a',
          borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
  },
});
