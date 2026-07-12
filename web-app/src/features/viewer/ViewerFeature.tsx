export function ViewerFeature() {
  return (
    <article className="panel">
      <h3>Viewer</h3>
      <p>실제 렌더러는 Phase 1 이후에 연결합니다.</p>
      <ul className="inline-list">
        <li>measure navigation shell</li>
        <li>zoom controls placeholder</li>
        <li>auto-scroll slot</li>
      </ul>
    </article>
  );
}
