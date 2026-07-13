import type { OmrCorrection, OmrDetection, OmrReviewDecision } from './model';

export function applyOmrCorrections(detections: OmrDetection[], corrections: OmrCorrection[]): OmrDetection[] {
  const byId = new Map(detections.map((detection) => [detection.id, { ...detection }]));

  corrections
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((correction) => {
      if (correction.operation.type === 'ADD') {
        byId.set(correction.operation.detection.id, {
          ...correction.operation.detection,
          source: 'USER',
          reviewDecision: 'CORRECTED'
        });
        return;
      }

      const current = byId.get(correction.detectionId);
      if (!current) {
        return;
      }

      if (correction.operation.type === 'ACCEPT') {
        byId.set(current.id, { ...current, reviewDecision: 'ACCEPTED' });
      } else if (correction.operation.type === 'REJECT') {
        byId.set(current.id, { ...current, reviewDecision: 'REJECTED' });
      } else if (correction.operation.type === 'CHANGE_CLASS') {
        byId.set(current.id, {
          ...current,
          classId: correction.operation.classId,
          className: correction.operation.className,
          source: 'CORRECTED',
          reviewDecision: 'CORRECTED'
        });
      } else if (correction.operation.type === 'MOVE_RESIZE') {
        byId.set(current.id, {
          ...current,
          boundsInSystem: correction.operation.boundsInSystem,
          boundsInPage: correction.operation.boundsInPage,
          source: 'CORRECTED',
          reviewDecision: 'CORRECTED'
        });
      }
    });

  return [...byId.values()];
}

export function visibleOmrDetections(detections: OmrDetection[], options: { includeRejected?: boolean; decisions?: OmrReviewDecision[] } = {}): OmrDetection[] {
  return detections.filter((detection) => {
    if (!options.includeRejected && detection.reviewDecision === 'REJECTED') {
      return false;
    }
    if (options.decisions?.length) {
      return options.decisions.includes(detection.reviewDecision);
    }
    return true;
  });
}

export function createOmrCorrectionId(projectId: string, detectionId: string, timestamp = Date.now()): string {
  return `${projectId}:omr-correction:${detectionId}:${timestamp}`;
}
