import { Link, Route, Routes, Navigate } from 'react-router-dom';
import { ImportLibraryPage } from '../features/import/ImportLibraryPage';
import { ImportReviewPage } from '../features/import/ImportReviewPage';
import { NewImportPage } from '../features/import/NewImportPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { ScoreEditPage } from '../features/editor/ScoreEditPage';
import { ScoreViewerPage } from '../features/viewer/ScoreViewerPage';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <Link to="/" className="brand-link">
            CueNote
          </Link>
          <p className="app-subtitle">
            MusicXML library and viewer for Phase 4. Bundled scores stay offline-first, while server workspaces add development auth,
            shared score versions, and annotation sync.
          </p>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/imports" element={<ImportLibraryPage />} />
        <Route path="/imports/new" element={<NewImportPage />} />
        <Route path="/imports/:projectId/review" element={<ImportReviewPage />} />
        <Route path="/scores/:scoreId" element={<ScoreViewerPage />} />
        <Route path="/scores/:scoreId/edit" element={<ScoreEditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
