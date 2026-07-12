import {
  calculateMeasureBeatCount,
  createPerformanceMeasureId,
  type Measure,
  type PerformanceMeasure,
  type PerformanceOrder,
  type RepeatExpansionWarning
} from '../model';

export interface RepeatExpanderOptions {
  maxTransitions?: number;
  maxOutputLength?: number;
}

interface EndingSpan {
  numbers: number[];
  startIndex: number;
  endIndex: number;
  ownerRepeatEndIndex: number | null;
}

interface ExpansionState {
  index: number;
  transitionCount: number;
  repeatPassByEndIndex: Map<number, number>;
  completedRepeatPassByEndIndex: Map<number, number>;
  dcTaken: boolean;
  dsTaken: boolean;
  codaArmed: boolean;
  codaTaken: boolean;
  alFineActive: boolean;
}

const DEFAULT_OPTIONS: Required<RepeatExpanderOptions> = {
  maxTransitions: 512,
  maxOutputLength: 1024
};

export function expandRepeats(measures: Measure[], options: RepeatExpanderOptions = {}): PerformanceOrder {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const warnings: RepeatExpansionWarning[] = [];
  const output: PerformanceMeasure[] = [];
  const occurrenceByMeasureId = new Map<string, number>();
  const visitedStates = new Set<string>();
  const endingSpans = buildEndingSpans(measures, warnings);
  const segnoIndex = measures.findIndex((measure) => hasMark(measure, 'SEGNO'));
  const codaIndex = measures.findIndex((measure) => hasMark(measure, 'CODA'));

  const state: ExpansionState = {
    index: 0,
    transitionCount: 0,
    repeatPassByEndIndex: new Map<number, number>(),
    completedRepeatPassByEndIndex: new Map<number, number>(),
    dcTaken: false,
    dsTaken: false,
    codaArmed: false,
    codaTaken: false,
    alFineActive: false
  };

  while (state.index >= 0 && state.index < measures.length) {
    if (state.transitionCount >= resolvedOptions.maxTransitions) {
      warnings.push({
        code: 'MAX_TRANSITIONS_EXCEEDED',
        message: `Repeat expansion stopped after ${resolvedOptions.maxTransitions} transitions.`,
        sourceMeasureId: measures[state.index]?.id,
        severity: 'ERROR'
      });
      break;
    }

    if (output.length >= resolvedOptions.maxOutputLength) {
      warnings.push({
        code: 'MAX_OUTPUT_LENGTH_EXCEEDED',
        message: `Repeat expansion stopped after generating ${resolvedOptions.maxOutputLength} performance measures.`,
        sourceMeasureId: measures[state.index]?.id,
        severity: 'ERROR'
      });
      break;
    }

    const stateKey = serializeState(state);
    if (visitedStates.has(stateKey)) {
      warnings.push({
        code: 'NAVIGATION_LOOP_PREVENTED',
        message: 'Repeat expansion detected a repeated navigation state and stopped safely.',
        sourceMeasureId: measures[state.index]?.id,
        severity: 'ERROR'
      });
      break;
    }
    visitedStates.add(stateKey);

    const measure = measures[state.index];
    const endingSpan = endingSpans.find((span) => span.startIndex === state.index);
    if (endingSpan) {
      const currentPass = getCurrentPassForEnding(state, endingSpan);
      if (!endingSpan.numbers.includes(currentPass)) {
        state.index = endingSpan.endIndex + 1;
        state.transitionCount += 1;
        continue;
      }
    }

    const occurrence = (occurrenceByMeasureId.get(measure.id) ?? 0) + 1;
    occurrenceByMeasureId.set(measure.id, occurrence);
    output.push({
      id: createPerformanceMeasureId(measure.id, occurrence),
      sourceMeasureId: measure.id,
      occurrence,
      orderIndex: output.length,
      passNumber: inferPassNumber(state),
      sourceMeasureNumber: measure.number
    });

    if (state.alFineActive && hasMark(measure, 'FINE')) {
      break;
    }

    if (state.codaArmed && hasMark(measure, 'TO_CODA')) {
      if (codaIndex < 0) {
        warnings.push({
          code: 'MISSING_CODA',
          message: 'Encountered To Coda after D.S. al Coda, but no Coda target exists.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
      } else if (!state.codaTaken) {
        state.index = codaIndex;
        state.codaTaken = true;
        state.transitionCount += 1;
        continue;
      }
    }

    if (hasMark(measure, 'DA_CAPO_AL_FINE') && !state.dcTaken) {
      state.index = 0;
      state.dcTaken = true;
      state.alFineActive = true;
      state.transitionCount += 1;
      continue;
    }

    if (hasMark(measure, 'DA_CAPO') && !state.dcTaken) {
      state.index = 0;
      state.dcTaken = true;
      state.transitionCount += 1;
      continue;
    }

    if (hasMark(measure, 'DAL_SEGNO_AL_CODA') && !state.dsTaken) {
      if (segnoIndex < 0) {
        warnings.push({
          code: 'MISSING_SEGNO',
          message: 'Encountered D.S. al Coda, but no Segno target exists.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
      } else {
        if (codaIndex < 0) {
          warnings.push({
            code: 'MISSING_CODA',
            message: 'Encountered D.S. al Coda, but no Coda target exists.',
            sourceMeasureId: measure.id,
            severity: 'WARNING'
          });
        }
        state.index = segnoIndex;
        state.dsTaken = true;
        state.codaArmed = codaIndex >= 0;
        state.transitionCount += 1;
        continue;
      }
    }

    if (hasMark(measure, 'DAL_SEGNO_AL_FINE') && !state.dsTaken) {
      if (segnoIndex < 0) {
        warnings.push({
          code: 'MISSING_SEGNO',
          message: 'Encountered D.S. al Fine, but no Segno target exists.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
      } else {
        state.index = segnoIndex;
        state.dsTaken = true;
        state.alFineActive = true;
        state.transitionCount += 1;
        continue;
      }
    }

    if (hasMark(measure, 'DAL_SEGNO') && !state.dsTaken) {
      if (segnoIndex < 0) {
        warnings.push({
          code: 'MISSING_SEGNO',
          message: 'Encountered D.S., but no Segno target exists.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
      } else {
        state.index = segnoIndex;
        state.dsTaken = true;
        state.transitionCount += 1;
        continue;
      }
    }

    const repeatEnd = measure.navigationMarks.find((mark) => mark.type === 'REPEAT_END');
    if (repeatEnd) {
      const startIndex = findRepeatStartIndex(measures, state.index);
      if (startIndex < 0) {
        warnings.push({
          code: 'MISSING_REPEAT_START',
          message: 'Encountered repeat end without a matching repeat start. Falling back to the beginning of the score.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
      }

      const effectiveStartIndex = startIndex >= 0 ? startIndex : 0;
      const totalPasses = repeatEnd.repeatTimes ?? 2;
      const currentPass = state.repeatPassByEndIndex.get(state.index) ?? 1;

      if (currentPass < totalPasses) {
        state.repeatPassByEndIndex.set(state.index, currentPass + 1);
        state.index = effectiveStartIndex;
        state.transitionCount += 1;
        continue;
      }

      state.completedRepeatPassByEndIndex.set(state.index, currentPass);
      state.repeatPassByEndIndex.delete(state.index);
    }

    state.index += 1;
    state.transitionCount += 1;
  }

  if (state.codaArmed && !state.codaTaken) {
    warnings.push({
      code: 'MISSING_TO_CODA',
      message: 'Encountered D.S. al Coda, but no To Coda marker was reached after the jump.',
      sourceMeasureId: measures[Math.max(0, Math.min(measures.length - 1, state.index - 1))]?.id,
      severity: 'WARNING'
    });
  }

  return { measures: output, warnings: dedupeWarnings(warnings) };
}

export function createPerformanceOrderFromVersion(measures: Measure[], options?: RepeatExpanderOptions): PerformanceOrder {
  return expandRepeats(measures, options);
}

export function getPerformanceMeasureSourceIds(order: PerformanceOrder): string[] {
  return order.measures.map((measure) => measure.sourceMeasureId);
}

export function calculatePerformanceOrderBeatCount(measures: Measure[]): number {
  return measures.reduce((total, measure) => total + calculateMeasureBeatCount(measure), 0);
}

function buildEndingSpans(measures: Measure[], warnings: RepeatExpansionWarning[]): EndingSpan[] {
  const spans: EndingSpan[] = [];
  let open: EndingSpan | null = null;

  measures.forEach((measure, index) => {
    const startMark = measure.navigationMarks.find((mark) => mark.type === 'ENDING_START');
    if (startMark) {
      if (open) {
        warnings.push({
          code: 'INVALID_ENDING',
          message: 'Encountered a new ending start before the previous ending was closed.',
          sourceMeasureId: measure.id,
          severity: 'WARNING'
        });
        open.endIndex = index - 1;
        spans.push(open);
      }

      open = {
        numbers: startMark.endingNumbers ?? [],
        startIndex: index,
        endIndex: index,
        ownerRepeatEndIndex: null
      };
    }

    if (open) {
      open.endIndex = index;
    }

    if (open && measure.navigationMarks.some((mark) => mark.type === 'ENDING_STOP')) {
      spans.push(open);
      open = null;
    }
  });

  if (open) {
    warnings.push({
      code: 'INVALID_ENDING',
      message: 'Ending bracket did not contain an explicit stop. Falling back to the next repeat end.',
      sourceMeasureId: measures[open.startIndex]?.id,
      severity: 'WARNING'
    });
    spans.push(open);
  }

  spans.forEach((span) => {
    span.ownerRepeatEndIndex = findNextRepeatEndIndex(measures, span.endIndex) ?? findPreviousRepeatEndIndex(measures, span.startIndex);
    if (span.numbers.length === 0) {
      warnings.push({
        code: 'INVALID_ENDING',
        message: 'Ending bracket is missing its ending numbers.',
        sourceMeasureId: measures[span.startIndex]?.id,
        severity: 'WARNING'
      });
    }
  });

  return spans;
}

function findNextRepeatEndIndex(measures: Measure[], fromIndex: number): number | null {
  for (let index = fromIndex; index < measures.length; index += 1) {
    if (hasMark(measures[index], 'REPEAT_END')) {
      return index;
    }
  }

  return null;
}

function findPreviousRepeatEndIndex(measures: Measure[], fromIndex: number): number | null {
  for (let index = fromIndex; index >= 0; index -= 1) {
    if (hasMark(measures[index], 'REPEAT_END')) {
      return index;
    }
  }

  return null;
}

function findRepeatStartIndex(measures: Measure[], repeatEndIndex: number): number {
  for (let index = repeatEndIndex; index >= 0; index -= 1) {
    if (hasMark(measures[index], 'REPEAT_START')) {
      return index;
    }
  }

  return -1;
}

function getCurrentPassForEnding(state: ExpansionState, span: EndingSpan): number {
  if (span.ownerRepeatEndIndex == null) {
    return 1;
  }

  return state.repeatPassByEndIndex.get(span.ownerRepeatEndIndex) ?? state.completedRepeatPassByEndIndex.get(span.ownerRepeatEndIndex) ?? 1;
}

function inferPassNumber(state: ExpansionState): number {
  const activePasses = Array.from(state.repeatPassByEndIndex.values());
  return activePasses.length > 0 ? Math.max(...activePasses) : 1;
}

function hasMark(measure: Measure, type: Measure['navigationMarks'][number]['type']): boolean {
  return measure.navigationMarks.some((mark) => mark.type === type);
}

function serializeState(state: ExpansionState): string {
  const repeatPassEntries = Array.from(state.repeatPassByEndIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([index, pass]) => `${index}:${pass}`)
    .join('|');
  const completedRepeatEntries = Array.from(state.completedRepeatPassByEndIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([index, pass]) => `${index}:${pass}`)
    .join('|');

  return [
    state.index,
    repeatPassEntries,
    completedRepeatEntries,
    state.dcTaken ? 'dc1' : 'dc0',
    state.dsTaken ? 'ds1' : 'ds0',
    state.codaArmed ? 'ca1' : 'ca0',
    state.codaTaken ? 'ct1' : 'ct0',
    state.alFineActive ? 'af1' : 'af0'
  ].join('::');
}

function dedupeWarnings(warnings: RepeatExpansionWarning[]): RepeatExpansionWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.sourceMeasureId ?? ''}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
