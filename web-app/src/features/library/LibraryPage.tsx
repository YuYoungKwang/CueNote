import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createRecentScoreStore, type RecentScoreRecord } from '../../core/storage/recentScoreStore';
import { sampleCatalog } from '../../samples/catalog';

export function LibraryPage() {
  const recentStore = useMemo(() => createRecentScoreStore(), []);
  const [recentScores, setRecentScores] = useState<RecentScoreRecord[]>([]);

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
    </main>
  );
}
