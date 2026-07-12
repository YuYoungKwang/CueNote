import type { Measure, RepeatExpansionWarning, ScorePart } from '../model';

export function analyzeRepresentativePartWarnings(parts: ScorePart[]): RepeatExpansionWarning[] {
  if (parts.length <= 1) {
    return [];
  }

  const representativePart = parts[0];
  const warnings: RepeatExpansionWarning[] = [];

  for (const comparedPart of parts.slice(1)) {
    if (comparedPart.measures.length !== representativePart.measures.length) {
      warnings.push({
        code: 'REPRESENTATIVE_PART_MEASURE_COUNT_MISMATCH',
        message: `Representative part "${representativePart.name}" has ${representativePart.measures.length} measures, but "${comparedPart.name}" has ${comparedPart.measures.length}. Playback order will follow the first part only.`,
        sourceMeasureId: representativePart.measures[0]?.id,
        severity: 'WARNING'
      });
    }

    const sharedMeasureCount = Math.min(representativePart.measures.length, comparedPart.measures.length);
    let timeSignatureWarningAdded = false;
    let navigationWarningAdded = false;

    for (let index = 0; index < sharedMeasureCount; index += 1) {
      const representativeMeasure = representativePart.measures[index];
      const comparedMeasure = comparedPart.measures[index];

      if (!timeSignatureWarningAdded && serializeTimeSignature(representativeMeasure) !== serializeTimeSignature(comparedMeasure)) {
        warnings.push({
          code: 'REPRESENTATIVE_PART_TIME_SIGNATURE_MISMATCH',
          message: `Measure ${representativeMeasure.number} uses ${describeTimeSignature(representativeMeasure)} in "${representativePart.name}" but ${describeTimeSignature(comparedMeasure)} in "${comparedPart.name}". Playback timing will follow the first part only.`,
          sourceMeasureId: representativeMeasure.id,
          severity: 'WARNING'
        });
        timeSignatureWarningAdded = true;
      }

      if (!navigationWarningAdded && serializeNavigationMarks(representativeMeasure) !== serializeNavigationMarks(comparedMeasure)) {
        warnings.push({
          code: 'REPRESENTATIVE_PART_NAVIGATION_MISMATCH',
          message: `Measure ${representativeMeasure.number} has different navigation marks between "${representativePart.name}" and "${comparedPart.name}". Repeat expansion will follow the first part only.`,
          sourceMeasureId: representativeMeasure.id,
          severity: 'WARNING'
        });
        navigationWarningAdded = true;
      }

      if (timeSignatureWarningAdded && navigationWarningAdded) {
        break;
      }
    }
  }

  return warnings;
}

function serializeTimeSignature(measure: Measure): string {
  return measure.timeSignature ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}` : 'none';
}

function describeTimeSignature(measure: Measure): string {
  return measure.timeSignature ? `${measure.timeSignature.beats}/${measure.timeSignature.beatType}` : 'no time signature';
}

function serializeNavigationMarks(measure: Measure): string {
  return measure.navigationMarks
    .map((mark) => `${mark.type}:${mark.endingNumbers?.join(',') ?? ''}:${mark.repeatTimes ?? ''}`)
    .sort()
    .join('|');
}
