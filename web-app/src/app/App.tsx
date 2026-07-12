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
            MusicXML sample library and viewer for Phase 3. Bundled scores render locally, expand repeat navigation, support
            BPM-based playback order, and keep browser annotations offline in the viewer.
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
