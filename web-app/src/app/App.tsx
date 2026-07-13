import { Link, Route, Routes, Navigate } from 'react-router-dom';
import { LibraryPage } from '../features/library/LibraryPage';
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
        <Route path="/scores/:scoreId" element={<ScoreViewerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
