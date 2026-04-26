import { useState } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { pixelSentinelTheme } from './theme';
import { AppShell, type Route } from './AppShell';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { ScanDetailPage } from './pages/ScanDetailPage';
import { QuickAnalysisPage } from './pages/QuickAnalysisPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [route, setRoute] = useState<Route>({ kind: 'cases' });

  const renderRoute = () => {
    switch (route.kind) {
      case 'cases':
        return <CasesPage onOpen={(caseId) => setRoute({ kind: 'case', caseId })} />;
      case 'case':
        return (
          <CaseDetailPage
            caseId={route.caseId}
            onBack={() => setRoute({ kind: 'cases' })}
            onDeleted={() => setRoute({ kind: 'cases' })}
            onOpenScan={(scanId) =>
              setRoute({ kind: 'scan', caseId: route.caseId, scanId })
            }
          />
        );
      case 'scan':
        return (
          <ScanDetailPage
            caseId={route.caseId}
            scanId={route.scanId}
            onBack={() => setRoute({ kind: 'case', caseId: route.caseId })}
          />
        );
      case 'quick':
        return <QuickAnalysisPage />;
      case 'settings':
        return <SettingsPage />;
    }
  };

  return (
    <ThemeProvider theme={pixelSentinelTheme}>
      <CssBaseline />
      <AppShell route={route} onNavigate={setRoute}>
        {renderRoute()}
      </AppShell>
    </ThemeProvider>
  );
}

export default App;
