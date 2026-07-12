import type { RehearsalState } from '../../domain/rehearsal/state';

interface RehearsalFeatureProps {
  rehearsalState: RehearsalState;
}

export function RehearsalFeature({ rehearsalState }: RehearsalFeatureProps) {
  return (
    <article className="panel">
      <h3>Rehearsal</h3>
      <p>합주 동기화는 아직 시작하지 않고 상태만 보존합니다.</p>
      <ul className="inline-list">
        <li>{rehearsalState.mode}</li>
        <li>{rehearsalState.positionLabel}</li>
      </ul>
    </article>
  );
}
