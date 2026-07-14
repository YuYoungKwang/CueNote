import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ImportProject } from '@cuenote/score-domain';
import { createImportProjectRepository } from '../../core/storage/importProjectRepository';

export function ImportLibraryPage() {
  const repository = useMemo(() => createImportProjectRepository(), []);
  const [projects, setProjects] = useState<ImportProject[]>([]);
  const [message, setMessage] = useState('가져오기 프로젝트는 이 브라우저의 로컬 저장소에 저장됩니다.');

  const refresh = async () => {
    setProjects(await repository.listProjects());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const deleteProject = async (projectId: string) => {
    await repository.deleteProject(projectId);
    setMessage('가져오기 프로젝트를 로컬 저장소에서 삭제했습니다.');
    await refresh();
  };

  return (
    <main className="import-layout">
      <section className="panel import-main-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">7단계</p>
            <h2>PDF와 이미지 가져오기</h2>
            <p className="muted" data-testid="import-library-status">
              {message}
            </p>
          </div>
          <Link className="primary-link" to="/imports/new" data-testid="new-import-link">
            새로 가져오기
          </Link>
        </div>

        {projects.length === 0 ? (
          <p className="muted" data-testid="empty-import-library">
            아직 만든 가져오기 프로젝트가 없습니다.
          </p>
        ) : (
          <div className="score-grid" data-testid="import-project-list">
            {projects.map((project) => (
              <article className="score-card" key={project.id}>
                <div className="score-card__topline">
                  <span className="score-card__composer">{importStatusLabel(project.status)}</span>
                </div>
                <h3>{project.title}</h3>
                <p>
                  {project.pageCount}쪽 | {new Date(project.updatedAt).toLocaleString()}
                </p>
                <div className="playback-button-row">
                  <Link className="primary-link" to={`/imports/${project.id}/review`}>
                    검수 열기
                  </Link>
                  <button type="button" className="control-button" onClick={() => void deleteProject(project.id)}>
                    삭제
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

function importStatusLabel(status: ImportProject['status']): string {
  if (status === 'WAITING') {
    return '대기 중';
  }
  if (status === 'PROCESSING') {
    return '처리 중';
  }
  if (status === 'NEEDS_REVIEW') {
    return '검수 필요';
  }
  if (status === 'REVIEW_COMPLETE') {
    return '검수 완료';
  }
  if (status === 'FAILED') {
    return '실패';
  }
  return status;
}
