import { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ShieldIcon from '@mui/icons-material/Shield';

export type Route =
  | { kind: 'cases' }
  | { kind: 'case'; caseId: string }
  | { kind: 'scan'; caseId: string; scanId: string }
  | { kind: 'quick' }
  | { kind: 'settings' };

const drawerWidth = 232;

interface NavItem {
  key: 'cases' | 'quick' | 'settings';
  label: string;
  icon: ReactNode;
  route: Route;
}

const navItems: NavItem[] = [
  { key: 'cases', label: 'Cases', icon: <FolderRoundedIcon />, route: { kind: 'cases' } },
  { key: 'quick', label: 'Quick Analysis', icon: <BoltRoundedIcon />, route: { kind: 'quick' } },
  { key: 'settings', label: 'Settings', icon: <SettingsRoundedIcon />, route: { kind: 'settings' } },
];

interface AppShellProps {
  route: Route;
  onNavigate: (r: Route) => void;
  children: ReactNode;
}

export function AppShell({ route, onNavigate, children }: AppShellProps) {
  const activeKey: NavItem['key'] =
    route.kind === 'case' || route.kind === 'scan' ? 'cases' : route.kind;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: 'border-box',
            backgroundColor: 'background.default',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <ShieldIcon sx={{ color: 'primary.main', fontSize: 26 }} />
          <Box sx={{ lineHeight: 1 }}>
            <Typography variant="overline" component="div" sx={{ color: 'primary.main', fontSize: 10 }}>
              PIXELSENTINEL
            </Typography>
            <Typography variant="caption" color="text.secondary">
              v0.1.0
            </Typography>
          </Box>
        </Box>

        <List sx={{ pt: 1 }}>
          {navItems.map((item) => (
            <ListItem key={item.key} disablePadding sx={{ px: 1.25 }}>
              <ListItemButton
                onClick={() => onNavigate(item.route)}
                selected={activeKey === item.key}
                sx={{
                  borderRadius: 1,
                  mb: 0.25,
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(34, 211, 238, 0.10)',
                    '& .MuiListItemIcon-root, & .MuiListItemText-primary': {
                      color: 'primary.main',
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                  primary={item.label}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}
