// Reusable dialogs that replace native window.prompt / window.confirm in
// the trust flows. Native browser dialogs are awkward in a desktop app
// (Electron / webview / Bun-served React all give them different chrome)
// and ignore the surrounding theme. These keep prompts on the page so
// the experience stays consistent with the rest of the UI.

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// ConfirmDialog is a yes/no prompt. The destructive flag flips the
// confirm button to the error palette — used for the trust-remove
// flow and any future "delete this thing" prompts.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {typeof message === 'string' ? (
          <DialogContentText>{message}</DialogContentText>
        ) : (
          message
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface TrustLabelDialogProps {
  open: boolean;
  fingerprint: string;
  // initialLabel makes the dialog reusable for both "trust new" (empty)
  // and "edit label" (existing value) — the second flow is not wired
  // up yet but the parameter is cheap to have.
  initialLabel?: string;
  onCancel: () => void;
  onSubmit: (label: string) => void;
}

// TrustLabelDialog is the trust-this-fingerprint prompt. Shows the
// fingerprint prominently so the operator can eyeball it before
// committing, and accepts an optional human label.
export function TrustLabelDialog({
  open,
  fingerprint,
  initialLabel = '',
  onCancel,
  onSubmit,
}: TrustLabelDialogProps) {
  const [label, setLabel] = useState(initialLabel);

  useEffect(() => {
    if (open) setLabel(initialLabel);
  }, [open, initialLabel]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSubmit(label.trim());
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Mark producer trusted</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Future signed scans from this producer will be flagged as
            trusted in the case view.
          </DialogContentText>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.5 }}
          >
            Fingerprint
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              wordBreak: 'break-all',
              mb: 2,
            }}
          >
            {fingerprint}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Label (optional)"
            placeholder="e.g. John's phone, lab device #4"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" autoFocus>
            Trust
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
