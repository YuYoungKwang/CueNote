import type { EditableMeasure, EditableScoreDocument, ValidationIssue } from './model';

export function validateEditableScore(document: EditableScoreDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenMeasureIds = new Set<string>();
  const seenEventIds = new Set<string>();

  if (document.parts.length === 0) {
    issues.push(globalIssue('NO_PARTS', 'The score must contain at least one part.', true));
  }

  const measureCount = document.parts[0]?.measures.length ?? 0;
  document.parts.forEach((part) => {
    if (part.measures.length === 0) {
      issues.push({
        code: 'NO_MEASURES',
        severity: 'ERROR',
        message: `Part ${part.name} must contain at least one measure.`,
        partId: part.id,
        blocking: true
      });
    }

    if (measureCount > 0 && part.measures.length !== measureCount) {
      issues.push({
        code: 'PART_MEASURE_COUNT_MISMATCH',
        severity: 'ERROR',
        message: 'All parts must have the same number of measures for Phase 6 editing.',
        partId: part.id,
        blocking: true
      });
    }

    part.measures.forEach((measure, measureIndex) => {
      if (seenMeasureIds.has(measure.id)) {
        issues.push(measureIssue('DUPLICATE_MEASURE_ID', 'Measure IDs must be unique.', part.id, measure, true));
      }
      seenMeasureIds.add(measure.id);

      if (!Number.isFinite(measure.attributes.divisions) || measure.attributes.divisions <= 0) {
        issues.push(measureIssue('INVALID_DIVISIONS', 'Measure divisions must be a positive integer.', part.id, measure, true));
      }

      if (measure.attributes.timeSignature) {
        const { beats, beatType } = measure.attributes.timeSignature;
        if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) {
          issues.push(measureIssue('INVALID_TIME_SIGNATURE', 'Time signature must be positive.', part.id, measure, true));
        }
      }

      measure.events.forEach((event) => {
        if (seenEventIds.has(event.id)) {
          issues.push({
            code: 'DUPLICATE_EVENT_ID',
            severity: 'ERROR',
            message: 'Event IDs must be unique.',
            partId: part.id,
            measureId: measure.id,
            eventId: event.id,
            blocking: true
          });
        }
        seenEventIds.add(event.id);

        if (event.duration.divisions <= 0) {
          issues.push({
            code: 'INVALID_DURATION',
            severity: 'ERROR',
            message: 'Event duration must be positive.',
            partId: part.id,
            measureId: measure.id,
            eventId: event.id,
            blocking: true
          });
        }

        if (event.duration.unsupportedTuplet) {
          issues.push({
            code: 'UNSUPPORTED_TUPLET_EDIT',
            severity: 'WARNING',
            message: 'Tuplet-like duration was parsed and can be exported, but tuplets are not editable in Phase 6.',
            partId: part.id,
            measureId: measure.id,
            eventId: event.id,
            blocking: false
          });
        }

        if (event.kind === 'NOTE' && (event.pitch.octave < 0 || event.pitch.octave > 9)) {
          issues.push({
            code: 'PITCH_OUT_OF_RANGE',
            severity: 'WARNING',
            message: 'Pitch octave is outside the recommended notation range.',
            partId: part.id,
            measureId: measure.id,
            eventId: event.id,
            blocking: false
          });
        }
      });

      issues.push(...validateMeasureDuration(part.id, measure, measureIndex));

      measure.lyrics.forEach((lyric) => {
        if (lyric.text.length > 0 && lyric.text.trim().length === 0) {
          issues.push({
            code: 'BLANK_LYRIC',
            severity: 'ERROR',
            message: 'Lyrics cannot be whitespace only.',
            partId: part.id,
            measureId: measure.id,
            eventId: lyric.eventId,
            blocking: true
          });
        }
      });

      measure.navigationMarks.forEach((mark) => {
        if (mark.measureId !== measure.id) {
          issues.push(measureIssue('NAVIGATION_MARK_MISMATCH', 'Navigation mark must reference its owning measure.', part.id, measure, true));
        }
      });
    });
  });

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.blocking || issue.severity === 'ERROR');
}

function validateMeasureDuration(partId: string, measure: EditableMeasure, measureIndex: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const time = measure.attributes.timeSignature;
  if (!time) {
    return issues;
  }

  const expected = measure.attributes.divisions * time.beats * (4 / time.beatType);
  const actual = measure.events.reduce((sum, event) => sum + event.duration.divisions, 0);

  if (actual === expected) {
    return issues;
  }

  if (measureIndex === 0 && actual > 0 && actual < expected) {
    issues.push(measureIssue('PICKUP_MEASURE_DURATION', 'First measure is shorter than the time signature and is treated as a pickup.', partId, measure, false));
    return issues;
  }

  issues.push(measureIssue('MEASURE_DURATION_MISMATCH', `Measure duration ${actual} does not match expected ${expected}.`, partId, measure, true));
  return issues;
}

function globalIssue(code: string, message: string, blocking: boolean): ValidationIssue {
  return {
    code,
    severity: blocking ? 'ERROR' : 'WARNING',
    message,
    blocking
  };
}

function measureIssue(code: string, message: string, partId: string, measure: EditableMeasure, blocking: boolean): ValidationIssue {
  return {
    code,
    severity: blocking ? 'ERROR' : 'WARNING',
    message,
    partId,
    measureId: measure.id,
    blocking
  };
}
