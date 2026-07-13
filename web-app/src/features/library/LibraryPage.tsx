import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createApiClient, type AuthSession, type EnsembleSummary, type ServerScoreSummary } from '../../core/api/client';
import { createServerSessionStore } from '../../core/api/sessionStore';
import { createRecentScoreStore, type RecentScoreRecord } from '../../core/storage/recentScoreStore';
import { sampleCatalog } from '../../samples/catalog';
import { SAMPLE_SCORES } from '../../samples/sampleScores';

export function LibraryPage() {
  const recentStore = useMemo(() => createRecentScoreStore(), []);
  const apiClient = useMemo(() => createApiClient(), []);
  const sessionStore = useMemo(() => createServerSessionStore(), []);
  const [recentScores, setRecentScores] = useState<RecentScoreRecord[]>([]);
  const [session, setSession] = useState<AuthSession | null>(() => sessionStore.load());
  const [ensembles, setEnsembles] = useState<EnsembleSummary[]>([]);
  const [selectedEnsembleId, setSelectedEnsembleId] = useState<string | null>(null);
  const [serverScores, setServerScores] = useState<ServerScoreSummary[]>([]);
  const [serverMessage, setServerMessage] = useState('Server library idle.');
  const [serverBusy, setServerBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void recentStore.list().then((records) => {
      if (!cancelled) {
        setRecentScores(records.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [recentStore]);

  useEffect(() => {
    if (!session) {
      setEnsembles([]);
      setSelectedEnsembleId(null);
      setServerScores([]);
      return;
    }

    void refreshServerLibrary(session);
  }, [session]);

  const refreshServerLibrary = async (currentSession = session) => {
    if (!currentSession) {
      return;
    }

    setServerBusy(true);
    try {
      const nextEnsembles = await apiClient.listEnsembles(currentSession.accessToken);
      setEnsembles(nextEnsembles);
      const nextSelectedEnsembleId = selectedEnsembleId ?? nextEnsembles[0]?.id ?? null;
      setSelectedEnsembleId(nextSelectedEnsembleId);
      if (nextSelectedEnsembleId) {
        setServerScores(await apiClient.listScores(currentSession.accessToken, nextSelectedEnsembleId));
      } else {
        setServerScores([]);
      }
      setServerMessage('Server library ready.');
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : 'Server library failed.');
    } finally {
      setServerBusy(false);
    }
  };

  const loginDev = async () => {
    setServerBusy(true);
    try {
      const nextSession = await apiClient.loginDev('phase4@cuenote.local', 'Phase 4 Tester');
      sessionStore.save(nextSession);
      setSession(nextSession);
      setServerMessage(`Signed in as ${nextSession.user.email}.`);
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : 'Dev login failed.');
    } finally {
      setServerBusy(false);
    }
  };

  const logout = () => {
    sessionStore.clear();
    setSession(null);
    setServerMessage('Signed out. Local PWA data remains available.');
  };

  const ensureEnsemble = async () => {
    if (!session) {
      return null;
    }
    const existing = ensembles[0];
    if (existing) {
      setSelectedEnsembleId(existing.id);
      return existing.id;
    }

    const created = await apiClient.createEnsemble(session.accessToken, 'Phase 4 Ensemble');
    setEnsembles([created]);
    setSelectedEnsembleId(created.id);
    return created.id;
  };

  const createEnsemble = async () => {
    if (!session) {
      return;
    }

    setServerBusy(true);
    try {
      const ensembleId = await ensureEnsemble();
      setServerMessage(ensembleId ? 'Ensemble ready.' : 'Sign in before creating an ensemble.');
      await refreshServerLibrary(session);
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : 'Ensemble creation failed.');
    } finally {
      setServerBusy(false);
    }
  };

  const publishBundledSamples = async () => {
    if (!session) {
      return;
    }

    setServerBusy(true);
    try {
      const ensembleId = await ensureEnsemble();
      if (!ensembleId) {
        setServerMessage('Sign in before publishing bundled samples.');
        return;
      }

      const existingTitles = new Set(serverScores.map((score) => score.title));
      for (const sample of SAMPLE_SCORES.slice(0, 2)) {
        if (!existingTitles.has(sample.title)) {
          await apiClient.createScore(session.accessToken, ensembleId, sample.title, sample.composer, sample.sourceXml);
        }
      }

      setServerScores(await apiClient.listScores(session.accessToken, ensembleId));
      setServerMessage('Bundled samples published to the server library.');
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : 'Publishing samples failed.');
    } finally {
      setServerBusy(false);
    }
  };

  return (
    <main className="library-layout">
      <section className="panel library-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sample scores</p>
            <h2>Bundled score library</h2>
          </div>
        </div>

        <div className="score-grid">
          {sampleCatalog.map((sample) => (
            <article className="score-card" key={sample.id}>
              <div className="score-card__topline">
                <span className="score-card__composer">{sample.composer}</span>
              </div>
              <h3>{sample.title}</h3>
              <p>{sample.description}</p>
              <Link className="primary-link" to={`/scores/${sample.id}`}>
                Open score
              </Link>
            </article>
          ))}
        </div>
      </section>

      <aside className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent</p>
            <h2>Recently opened</h2>
          </div>
        </div>

        {recentScores.length === 0 ? (
          <p className="muted">No recently opened score has been restored yet.</p>
        ) : (
          <ul className="recent-list">
            {recentScores.map((record) => (
              <li key={record.scoreId}>
                <Link to={`/scores/${record.scoreId}`}>
                  <strong>{record.title}</strong>
                  <span>
                    {new Date(record.lastOpenedAt).toLocaleString()} | {record.currentMeasureId}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="panel server-library-panel" data-testid="server-library-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 4</p>
            <h2>Server workspace</h2>
            <p className="muted" data-testid="server-library-status">
              {serverMessage}
            </p>
          </div>
        </div>

        <div className="server-actions">
          {session ? (
            <>
              <span data-testid="server-session-user">{session.user.email}</span>
              <button type="button" className="control-button" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="control-button" data-testid="dev-login" onClick={loginDev} disabled={serverBusy}>
              Dev sign in
            </button>
          )}
          <button type="button" className="control-button" data-testid="server-ensemble-create" onClick={createEnsemble} disabled={!session || serverBusy}>
            Ensure ensemble
          </button>
          <button type="button" className="control-button" data-testid="publish-samples" onClick={publishBundledSamples} disabled={!session || serverBusy}>
            Publish bundled samples
          </button>
          <button type="button" className="control-button" onClick={() => void refreshServerLibrary()} disabled={!session || serverBusy}>
            Refresh
          </button>
        </div>

        {ensembles.length > 0 ? (
          <label className="field">
            <span>Ensemble</span>
            <select
              value={selectedEnsembleId ?? ''}
              onChange={(event) => {
                setSelectedEnsembleId(event.target.value);
                if (session) {
                  void apiClient.listScores(session.accessToken, event.target.value).then(setServerScores).catch((error) => {
                    setServerMessage(error instanceof Error ? error.message : 'Server scores failed to load.');
                  });
                }
              }}
            >
              {ensembles.map((ensemble) => (
                <option key={ensemble.id} value={ensemble.id}>
                  {ensemble.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {serverScores.length === 0 ? (
          <p className="muted">No server scores have been published yet.</p>
        ) : (
          <ul className="recent-list" data-testid="server-score-list">
            {serverScores.map((score) => (
              <li key={score.id}>
                <Link to={`/scores/${score.id}?source=server&versionId=${score.current_version_id}`}>
                  <strong>{score.title}</strong>
                  <span>Server version {score.current_version_number ?? 1}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
