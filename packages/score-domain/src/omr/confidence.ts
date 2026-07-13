import type { OmrDetection, OmrModelManifest, OmrReviewDecision } from './model';

export type OmrConfidenceBand = 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'LOW_CONFIDENCE';

export interface OmrConfidenceThresholds {
  autoAcceptThreshold: number;
  lowConfidenceThreshold: number;
}

export function thresholdsFromManifest(manifest: OmrModelManifest): OmrConfidenceThresholds {
  return {
    autoAcceptThreshold: manifest.postprocessing.autoAcceptThreshold ?? 0.85,
    lowConfidenceThreshold: manifest.postprocessing.lowConfidenceThreshold ?? manifest.postprocessing.confidenceThreshold
  };
}

export function confidenceBand(confidence: number, thresholds: OmrConfidenceThresholds): OmrConfidenceBand {
  if (confidence >= thresholds.autoAcceptThreshold) {
    return 'HIGH_CONFIDENCE';
  }
  if (confidence >= thresholds.lowConfidenceThreshold) {
    return 'REVIEW_REQUIRED';
  }
  return 'LOW_CONFIDENCE';
}

export function initialReviewDecision(detection: Pick<OmrDetection, 'confidence'>, thresholds: OmrConfidenceThresholds): OmrReviewDecision {
  return confidenceBand(detection.confidence, thresholds) === 'HIGH_CONFIDENCE' ? 'UNREVIEWED' : 'UNREVIEWED';
}

export function requiresReview(detection: OmrDetection, manifest: OmrModelManifest): boolean {
  const klass = manifest.classes.find((candidate) => candidate.id === detection.classId);
  if (klass?.blockingReview) {
    return detection.reviewDecision !== 'ACCEPTED' && detection.reviewDecision !== 'CORRECTED';
  }
  return confidenceBand(detection.confidence, thresholdsFromManifest(manifest)) !== 'HIGH_CONFIDENCE' && detection.reviewDecision === 'UNREVIEWED';
}
