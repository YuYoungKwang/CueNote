import { createSampleScoreSummary } from '../../domain/score/sampleData';

export function LibraryFeature() {
  const score = createSampleScoreSummary();

  return (
    <article className="panel">
      <h3>Library</h3>
      <p>최근 악보를 로컬에서 바로 여는 진입점입니다.</p>
      <ul className="inline-list">
        <li>{score.title}</li>
        <li>{score.measureCount} measures</li>
        <li>{score.updatedAt}</li>
      </ul>
    </article>
  );
}
