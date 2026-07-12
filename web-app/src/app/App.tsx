import { useMemo } from 'react';
import { detectBrowserCapabilities } from '../core/capabilities/detect';
import { ApiStatusPanel } from '../features/viewer/ApiStatusPanel';
import { AnnotationFeature } from '../features/annotation/AnnotationFeature';
import { EditorFeature } from '../features/editor/EditorFeature';
import { ImportFeature } from '../features/import/ImportFeature';
import { LibraryFeature } from '../features/library/LibraryFeature';
import { RehearsalFeature } from '../features/rehearsal/RehearsalFeature';
import { ViewerFeature } from '../features/viewer/ViewerFeature';
import { createDefaultRehearsalState } from '../domain/rehearsal/state';

export function App() {
  const capabilities = useMemo(() => detectBrowserCapabilities(), []);
  const rehearsalState = useMemo(() => createDefaultRehearsalState(), []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">CueNote</h1>
          <p className="app-subtitle">
            Web PWA 기반 협업형 디지털 악보 작업공간입니다. Phase 0에서는 로컬 저장,
            서비스 워커, mock OMR, 그리고 backend 연결 골격만 제공합니다.
          </p>
        </div>
        <span className="badge">Phase 0</span>
      </header>

      <section className="status-grid" aria-label="system status">
        <div className="panel">
          <h2>Browser Capabilities</h2>
          <div className="caps-grid">
            {Object.entries(capabilities).map(([key, value]) => (
              <div key={key}>
                <strong>{key}</strong>
                <div>{value ? 'supported' : 'unavailable'}</div>
              </div>
            ))}
          </div>
        </div>
        <ApiStatusPanel />
      </section>

      <section className="feature-grid" aria-label="features">
        <LibraryFeature />
        <ImportFeature />
        <ViewerFeature />
        <EditorFeature />
        <AnnotationFeature />
        <RehearsalFeature rehearsalState={rehearsalState} />
      </section>
    </main>
  );
}
