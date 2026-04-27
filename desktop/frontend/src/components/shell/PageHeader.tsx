import { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional breadcrumb-style "back" cluster rendered above the title. */
  above?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, above }: PageHeaderProps) {
  return (
    <Box
      sx={{
        px: 4,
        pt: 4,
        pb: 3,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {above && <Box sx={{ mb: 1 }}>{above}</Box>}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && <Box>{actions}</Box>}
      </Stack>
    </Box>
  );
}
