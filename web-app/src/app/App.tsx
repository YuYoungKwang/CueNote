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
            MusicXML sample library and viewer for Phase 1. Scores open locally, render in the browser, and keep a stable measure focus.
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
