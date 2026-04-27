import { useState } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Fab from '@mui/material/Fab';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import CompareRoundedIcon from '@mui/icons-material/CompareRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import BiotechRoundedIcon from '@mui/icons-material/BiotechRounded';
import TransformRoundedIcon from '@mui/icons-material/TransformRounded';
import { UploadPanel } from '../components/UploadPanel';
import { ImageComparisonTab } from '../components/ImageComparisonTab';
import { ChangeDetectionTab } from '../components/ChangeDetectionTab';
import { AlternateAnalysisTab } from '../components/AlternateAnalysisTab';
import { AlignmentDialog } from '../components/AlignmentDialog';
import { useUpload } from '../hooks/useUpload';
import { PageHeader } from '../components/shell/PageHeader';

// Quick Analysis is the (lifted-into-PixelSentinel) single-shot flow that
// existed in the upstream tool: upload one Before, one After, optionally
// align, then analyse. Useful for one-off comparisons without spinning up
// a case. State is intentionally not persisted across navigation — the
// case library is the canonical place for evidence.
export function QuickAnalysisPage() {
  const [before, setBefore] = useState<File | null>(null);
  const [after, setAfter] = useState<File | null>(null);
  const [warpedUrl, setWarpedUrl] = useState<string | null>(null);
  const [alignDialogOpen, setAlignDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const {
    uploadBefore,
    uploadAfter,
    uploadingBefore,
    uploadingAfter,
    beforeDims,
    afterDims,
    beforeDisplayUrl,
    afterDisplayUrl,
    ready,
    imageKey,
  } = useUpload();

  const clearWarp = () => {
    if (warpedUrl) URL.revokeObjectURL(warpedUrl);
    setWarpedUrl(null);
    fetch('/api/clear-warp', { method: 'POST' }).catch(() => {});
  };

  const handleBefore = (f: File) => {
    setBefore(f);
    clearWarp();
    uploadBefore(f);
  };

  const handleAfter = (f: File) => {
    setAfter(f);
    clearWarp();
    uploadAfter(f);
  };

  const handleAligned = (url: string) => {
    if (warpedUrl) URL.revokeObjectURL(warpedUrl);
    setWarpedUrl(url);
  };

  const bothSelected = before !== null && after !== null;
  const comparisonBeforeUrl = warpedUrl ?? beforeDisplayUrl ?? '';

  return (
    <Box>
      <PageHeader
        title="Quick analysis"
        subtitle="Upload one Before and one After image to identify changes between them. Useful for one-off comparisons without creating a case."
      />

      {(uploadingBefore || uploadingAfter) && <LinearProgress />}

      <Container maxWidth={false} sx={{ py: 3, px: 4 }}>
        <UploadPanel
          before={before}
          after={after}
          onBefore={handleBefore}
          onAfter={handleAfter}
          beforeDisplayUrl={warpedUrl ?? beforeDisplayUrl}
          afterDisplayUrl={afterDisplayUrl}
          alignmentActive={warpedUrl !== null}
        />

        {bothSelected && (
          <Paper variant="outlined">
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2 }}
            >
              <Tab icon={<CompareRoundedIcon />} iconPosition="start" label="Image Comparison" />
              <Tab icon={<SearchRoundedIcon />} iconPosition="start" label="Change Detection" />
              <Tab icon={<BiotechRoundedIcon />} iconPosition="start" label="Alternate Analysis" />
            </Tabs>

            <Box sx={{ p: 3 }}>
              {activeTab === 0 && beforeDisplayUrl && afterDisplayUrl && (
                <ImageComparisonTab
                  beforeUrl={comparisonBeforeUrl}
                  afterUrl={afterDisplayUrl}
                />
              )}
              {activeTab === 1 && <ChangeDetectionTab ready={ready} imageKey={imageKey} />}
              {activeTab === 2 && <AlternateAnalysisTab ready={ready} imageKey={imageKey} />}
            </Box>
          </Paper>
        )}

        {before && after && beforeDisplayUrl && afterDisplayUrl && beforeDims && afterDims && (
          <AlignmentDialog
            open={alignDialogOpen}
            beforeUrl={beforeDisplayUrl}
            afterUrl={afterDisplayUrl}
            beforeDims={beforeDims}
            afterDims={afterDims}
            onAligned={handleAligned}
            onClose={() => setAlignDialogOpen(false)}
          />
        )}
      </Container>

      {ready && (
        <Tooltip title={warpedUrl ? 'Edit alignment' : 'Align images'} placement="left">
          <Fab
            onClick={() => setAlignDialogOpen(true)}
            sx={{
              position: 'fixed',
              bottom: 32,
              right: 32,
              bgcolor: warpedUrl ? 'primary.main' : 'transparent',
              border: warpedUrl ? 'none' : '2px solid',
              borderColor: 'primary.main',
              color: warpedUrl ? 'primary.contrastText' : 'primary.main',
              '&:hover': {
                bgcolor: warpedUrl ? 'primary.dark' : 'action.hover',
              },
            }}
          >
            <TransformRoundedIcon />
          </Fab>
        </Tooltip>
      )}

      {/* Offscreen image keepers — preserve decoded bitmaps across tab swaps. */}
      {beforeDisplayUrl && (
        <img src={beforeDisplayUrl} alt="" aria-hidden style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: 1, height: 1 }} />
      )}
      {afterDisplayUrl && (
        <img src={afterDisplayUrl} alt="" aria-hidden style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: 1, height: 1 }} />
      )}
      {warpedUrl && (
        <img src={warpedUrl} alt="" aria-hidden style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: 1, height: 1 }} />
      )}
    </Box>
  );
}
