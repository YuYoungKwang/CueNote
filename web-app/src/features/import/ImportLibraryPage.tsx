import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ImportProject } from '@cuenote/score-domain';
import { createImportProjectRepository } from '../../core/storage/importProjectRepository';

export function ImportLibraryPage() {
  const repository = useMemo(() => createImportProjectRepository(), []);
  const [projects, setProjects] = useState<ImportProject[]>([]);
  const [message, setMessage] = useState('Import projects are stored locally in this browser.');

  const refresh = async () => {
    setProjects(await repository.listProjects());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const deleteProject = async (projectId: string) => {
    await repository.deleteProject(projectId);
    setMessage('Import project deleted from local storage.');
    await refresh();
  };

  return (
    <main className="import-layout">
      <section className="panel import-main-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 7</p>
            <h2>PDF and image imports</h2>
            <p className="muted" data-testid="import-library-status">
              {message}
            </p>
          </div>
          <Link className="primary-link" to="/imports/new" data-testid="new-import-link">
            New import
          </Link>
        </div>

        {projects.length === 0 ? (
          <p className="muted" data-testid="empty-import-library">
            No import project has been created yet.
          </p>
        ) : (
          <div className="score-grid" data-testid="import-project-list">
            {projects.map((project) => (
              <article className="score-card" key={project.id}>
                <div className="score-card__topline">
                  <span className="score-card__composer">{project.status}</span>
                </div>
                <h3>{project.title}</h3>
                <p>
                  {project.pageCount} page{project.pageCount === 1 ? '' : 's'} | {new Date(project.updatedAt).toLocaleString()}
                </p>
                <div className="playback-button-row">
                  <Link className="primary-link" to={`/imports/${project.id}/review`}>
                    Open review
                  </Link>
                  <button type="button" className="control-button" onClick={() => void deleteProject(project.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
