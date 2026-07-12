import {
  createStableMeasureId,
  type KeySignature,
  type Measure,
  type NavigationMark,
  type NavigationMarkType,
  type ScoreDocument,
  type ScorePart,
  type ScoreVersion,
  type TimeSignature
} from '@cuenote/score-domain';
import { MusicXmlParseError } from './errors';

const MUSICXML_NS = 'http://www.musicxml.org/ns/musicxml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface MusicXmlParseOptions {
  scoreId: string;
  sample?: boolean;
}

export interface MusicXmlParseResult {
  document: ScoreDocument;
  version: ScoreVersion;
}

export interface MusicXMLService {
  parse(sourceXml: string, options: MusicXmlParseOptions): MusicXmlParseResult;
}

export function createMusicXMLService(): MusicXMLService {
  return {
    parse(sourceXml, options) {
      return parseMusicXML(sourceXml, options);
    }
  };
}

export function parseMusicXML(sourceXml: string, options: MusicXmlParseOptions): MusicXmlParseResult {
  const document = new DOMParser().parseFromString(sourceXml, 'application/xml');
  const parserError = document.getElementsByTagName('parsererror')[0];

  if (parserError) {
    const detail = parserError.textContent?.trim();
    throw new MusicXmlParseError('INVALID_XML', detail ? `Invalid MusicXML: ${detail}` : 'Invalid MusicXML');
  }

  const root = document.documentElement;

  if (root.nodeName !== 'score-partwise') {
    throw new MusicXmlParseError('UNSUPPORTED_STRUCTURE', 'Only score-partwise MusicXML is supported.');
  }

  const title = descendantTextContent(root, 'work-title') ?? 'Untitled score';
  const composer = creatorText(root, 'composer');
  const partInfo = parsePartList(root);
  const parts = parseParts(root, partInfo, options.scoreId);

  if (parts.length === 0) {
    throw new MusicXmlParseError('MISSING_PART', 'The MusicXML file does not contain any supported parts.');
  }

  const version: ScoreVersion = {
    id: `${options.scoreId}:version-1`,
    scoreId: options.scoreId,
    title,
    sourceXml,
    parts
  };

  const scoreDocument: ScoreDocument = {
    id: options.scoreId,
    title,
    composer: composer ?? undefined,
    sample: options.sample ?? false,
    currentVersionId: version.id,
    versions: [version]
  };

  return { document: scoreDocument, version };
}

function parsePartList(root: Element) {
  const partList = childElement(root, 'part-list');
  if (!partList) {
    throw new MusicXmlParseError('UNSUPPORTED_STRUCTURE', 'MusicXML part-list is required.');
  }

  return Array.from(partList.children)
    .filter((child) => child.localName === 'score-part')
    .map((partElement) => ({
      id: partElement.getAttribute('id') ?? '',
      name: textContent(partElement, 'part-name') ?? 'Unnamed part',
      abbreviation: textContent(partElement, 'part-abbreviation') ?? undefined
    }))
    .filter((part) => part.id.length > 0);
}

function parseParts(root: Element, partInfo: Array<{ id: string; name: string; abbreviation?: string }>, scoreId: string): ScorePart[] {
  return Array.from(root.children)
    .filter((child) => child.localName === 'part')
    .map((partElement, partIndex) => {
      const partId = partElement.getAttribute('id') ?? '';
      const descriptor = partInfo.find((entry) => entry.id === partId);
      const measures = parseMeasures(partElement, scoreId, partId || `part-${partIndex + 1}`, partIndex);

      return {
        id: partId || `part-${partIndex + 1}`,
        name: descriptor?.name ?? `Part ${partIndex + 1}`,
        abbreviation: descriptor?.abbreviation,
        measures
      } satisfies ScorePart;
    });
}

function parseMeasures(partElement: Element, scoreId: string, partId: string, partIndex: number): Measure[] {
  const measures = Array.from(partElement.children).filter((child) => child.localName === 'measure');

  if (measures.length === 0) {
    throw new MusicXmlParseError('MISSING_MEASURE', `Part ${partId} does not contain any measures.`);
  }

  const parsedMeasures: Measure[] = [];
  let currentTimeSignature: TimeSignature | undefined;
  let currentKeySignature: KeySignature | undefined;
  let currentDivisions = 1;

  for (const [measureIndex, measureElement] of measures.entries()) {
    const numberText = measureElement.getAttribute('number') ?? String(measureIndex + 1);
    const sourceXmlId = xmlId(measureElement) ?? `${partId}-measure-${measureIndex + 1}`;
    const measureId = createStableMeasureId(scoreId, partIndex, measureIndex + 1, sourceXmlId);
    const measureTimeSignature = parseTimeSignature(measureElement) ?? currentTimeSignature;
    const measureKeySignature = parseKeySignature(measureElement) ?? currentKeySignature;
    const measureDivisions = parseDivisions(measureElement) ?? currentDivisions;

    if (measureTimeSignature) {
      currentTimeSignature = measureTimeSignature;
    }

    if (measureKeySignature) {
      currentKeySignature = measureKeySignature;
    }

    currentDivisions = measureDivisions;

    parsedMeasures.push({
      id: measureId,
      number: Number.parseInt(numberText, 10) || measureIndex + 1,
      sourceXmlId,
      partId,
      displayNumber: numberText,
      timeSignature: measureTimeSignature,
      keySignature: measureKeySignature,
      divisions: measureDivisions,
      durationDivisions: calculateMeasureDurationDivisions(measureElement),
      chordSymbols: parseChordSymbols(measureElement),
      lyrics: parseLyrics(measureElement),
      navigationMarks: parseNavigationMarks(measureElement, measureId)
    });
  }

  return parsedMeasures;
}

function parseTimeSignature(measureElement: Element): TimeSignature | undefined {
  const timeElement = childElement(childElement(measureElement, 'attributes') ?? measureElement, 'time');
  if (!timeElement) {
    return undefined;
  }

  const beats = textContent(timeElement, 'beats');
  const beatType = textContent(timeElement, 'beat-type');

  if (!beats || !beatType) {
    return undefined;
  }

  return {
    beats: Number.parseInt(beats, 10),
    beatType: Number.parseInt(beatType, 10)
  };
}

function parseKeySignature(measureElement: Element): KeySignature | undefined {
  const keyElement = childElement(childElement(measureElement, 'attributes') ?? measureElement, 'key');
  if (!keyElement) {
    return undefined;
  }

  const fifths = textContent(keyElement, 'fifths');
  if (fifths == null) {
    return undefined;
  }

  const mode = textContent(keyElement, 'mode');
  return {
    fifths: Number.parseInt(fifths, 10),
    mode: mode === 'minor' ? 'minor' : 'major'
  };
}

function parseDivisions(measureElement: Element): number | undefined {
  const divisionsText = textContent(childElement(measureElement, 'attributes') ?? measureElement, 'divisions');
  if (!divisionsText) {
    return undefined;
  }

  const divisions = Number.parseInt(divisionsText, 10);
  return Number.isFinite(divisions) && divisions > 0 ? divisions : undefined;
}

function calculateMeasureDurationDivisions(measureElement: Element): number {
  let cursor = 0;
  let maxCursor = 0;
  let lastNoteStart = 0;

  for (const child of Array.from(measureElement.children)) {
    if (child.localName === 'note') {
      if (childElement(child, 'grace')) {
        continue;
      }

      const duration = Number.parseInt(textContent(child, 'duration') ?? '0', 10);
      if (!Number.isFinite(duration) || duration <= 0) {
        continue;
      }

      if (childElement(child, 'chord')) {
        maxCursor = Math.max(maxCursor, lastNoteStart + duration);
        continue;
      }

      lastNoteStart = cursor;
      cursor += duration;
      maxCursor = Math.max(maxCursor, cursor);
      continue;
    }

    if (child.localName === 'forward') {
      const duration = Number.parseInt(textContent(child, 'duration') ?? '0', 10);
      if (Number.isFinite(duration) && duration > 0) {
        cursor += duration;
        maxCursor = Math.max(maxCursor, cursor);
      }
      continue;
    }

    if (child.localName === 'backup') {
      const duration = Number.parseInt(textContent(child, 'duration') ?? '0', 10);
      if (Number.isFinite(duration) && duration > 0) {
        cursor = Math.max(0, cursor - duration);
      }
    }
  }

  return maxCursor;
}

function parseChordSymbols(measureElement: Element): string[] {
  return Array.from(measureElement.children)
    .filter((child) => child.localName === 'harmony')
    .map((harmony) => {
      const rootStep = textContent(childElement(harmony, 'root') ?? harmony, 'root-step') ?? '';
      const rootAlter = textContent(childElement(harmony, 'root') ?? harmony, 'root-alter') ?? '0';
      const kind = harmony.getAttribute('text') ?? textContent(harmony, 'kind') ?? 'chord';
      const accidental = formatAlter(Number.parseInt(rootAlter, 10));
      return `${rootStep}${accidental}${kind ? ` ${kind}` : ''}`.trim();
    });
}

function parseLyrics(measureElement: Element): string[] {
  const lyrics: string[] = [];

  for (const note of Array.from(measureElement.children).filter((child) => child.localName === 'note')) {
    const lyricElements = Array.from(note.children).filter((child) => child.localName === 'lyric');
    for (const lyricElement of lyricElements) {
      const text = textContent(lyricElement, 'text');
      if (text) {
        lyrics.push(text);
      }
    }
  }

  return lyrics;
}

function parseNavigationMarks(measureElement: Element, measureId: string): NavigationMark[] {
  const marks: Array<Omit<NavigationMark, 'id'>> = [];

  Array.from(measureElement.children)
    .filter((child) => child.localName === 'barline')
    .forEach((barline) => {
      const repeat = childElement(barline, 'repeat');
      if (repeat) {
        const direction = repeat.getAttribute('direction');
        const repeatTimes = parseOptionalInteger(repeat.getAttribute('times') ?? repeat.getAttribute('repeat-times'));
        if (direction === 'forward') {
          marks.push({ type: 'REPEAT_START', measureId });
        } else if (direction === 'backward') {
          marks.push({ type: 'REPEAT_END', measureId, repeatTimes });
        }
      }

      const ending = childElement(barline, 'ending');
      if (ending) {
        const endingType = ending.getAttribute('type');
        const endingNumbers = parseEndingNumbers(ending.getAttribute('number'));
        if (endingType === 'start') {
          marks.push({ type: 'ENDING_START', measureId, endingNumbers });
        } else if (endingType === 'stop' || endingType === 'discontinue') {
          marks.push({ type: 'ENDING_STOP', measureId, endingNumbers });
        }
      }
    });

  Array.from(measureElement.children)
    .filter((child) => child.localName === 'direction')
    .forEach((direction, directionIndex) => {
      const words = Array.from(direction.getElementsByTagNameNS(MUSICXML_NS, 'words'))
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean);
      const normalizedWords = normalizeWords(words.join(' '));
      const sound = childElement(direction, 'sound');
      const wordMarks = parseDirectionWordMarks(normalizedWords, measureId);
      const soundMarks = parseDirectionSoundMarks(sound, normalizedWords, measureId);

      [...wordMarks, ...soundMarks].forEach((mark) => {
        if (!marks.some((existing) => existing.type === mark.type && existing.label === mark.label && existing.measureId === mark.measureId)) {
          marks.push(mark);
        }
      });

      if (normalizedWords.length === 0 && !sound && directionIndex === 0) {
        return;
      }
    });

  return marks.map((mark, index) => ({
    ...mark,
    id: `${measureId}:nav:${mark.type.toLowerCase()}:${index + 1}`
  }));
}

function parseDirectionWordMarks(normalizedWords: string, measureId: string): Array<Omit<NavigationMark, 'id'>> {
  if (!normalizedWords) {
    return [];
  }

  const marks: Array<Omit<NavigationMark, 'id'>> = [];
  const hasDaCapo = /\b(da capo|d c)\b/.test(normalizedWords);
  const hasDalSegno = /\b(dal segno|d s)\b/.test(normalizedWords);
  const hasToCoda = /\bto coda\b/.test(normalizedWords);
  const hasAlCoda = /\bal coda\b/.test(normalizedWords);
  const hasFine = /\bfine\b/.test(normalizedWords);
  const hasSegno = /\bsegno\b/.test(normalizedWords);
  const hasCoda = /\bcoda\b/.test(normalizedWords);

  if (hasDaCapo && hasFine) {
    marks.push({ type: 'DA_CAPO_AL_FINE', measureId, label: normalizedWords });
    return marks;
  }

  if (hasDaCapo) {
    marks.push({ type: 'DA_CAPO', measureId, label: normalizedWords });
    return marks;
  }

  if (hasDalSegno && hasAlCoda) {
    marks.push({ type: 'DAL_SEGNO_AL_CODA', measureId, label: normalizedWords });
    return marks;
  }

  if (hasDalSegno && hasFine) {
    marks.push({ type: 'DAL_SEGNO_AL_FINE', measureId, label: normalizedWords });
    return marks;
  }

  if (hasDalSegno) {
    marks.push({ type: 'DAL_SEGNO', measureId, label: normalizedWords });
    return marks;
  }

  if (hasToCoda) {
    marks.push({ type: 'TO_CODA', measureId, label: normalizedWords });
  }

  if (normalizedWords === 'fine') {
    marks.push({ type: 'FINE', measureId, label: normalizedWords });
  }

  if (hasSegno && !hasDalSegno) {
    marks.push({ type: 'SEGNO', measureId, label: normalizedWords });
  }

  if (hasCoda && !hasToCoda && !hasAlCoda) {
    marks.push({ type: 'CODA', measureId, label: normalizedWords });
  }

  return marks;
}

function parseDirectionSoundMarks(sound: Element | undefined, normalizedWords: string, measureId: string): Array<Omit<NavigationMark, 'id'>> {
  if (!sound) {
    return [];
  }

  const marks: Array<Omit<NavigationMark, 'id'>> = [];
  const hasFinePhrase = /\bfine\b/.test(normalizedWords);
  const hasCodaPhrase = /\bal coda\b/.test(normalizedWords);

  if (sound.getAttribute('dacapo') === 'yes') {
    marks.push({ type: hasFinePhrase || sound.getAttribute('fine') === 'yes' ? 'DA_CAPO_AL_FINE' : 'DA_CAPO', measureId });
  }

  if (sound.getAttribute('dalsegno')) {
    if (hasCodaPhrase || sound.getAttribute('tocoda')) {
      marks.push({ type: 'DAL_SEGNO_AL_CODA', measureId });
    } else if (hasFinePhrase || sound.getAttribute('fine') === 'yes') {
      marks.push({ type: 'DAL_SEGNO_AL_FINE', measureId });
    } else {
      marks.push({ type: 'DAL_SEGNO', measureId });
    }
  }

  if (sound.getAttribute('segno')) {
    marks.push({ type: 'SEGNO', measureId, label: sound.getAttribute('segno') ?? undefined });
  }

  if (sound.getAttribute('coda')) {
    marks.push({ type: 'CODA', measureId, label: sound.getAttribute('coda') ?? undefined });
  }

  if (sound.getAttribute('tocoda')) {
    marks.push({ type: 'TO_CODA', measureId, label: sound.getAttribute('tocoda') ?? undefined });
  }

  if (sound.getAttribute('fine') === 'yes' && normalizedWords === 'fine') {
    marks.push({ type: 'FINE', measureId });
  }

  return marks;
}

function parseEndingNumbers(value: string | null): number[] | undefined {
  if (!value) {
    return undefined;
  }

  const endingNumbers = value
    .split(/[^0-9]+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((token) => Number.isFinite(token));

  return endingNumbers.length > 0 ? endingNumbers : undefined;
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/d\.\s*c\./g, 'd c')
    .replace(/d\.\s*s\./g, 'd s')
    .replace(/[.,:;!?()[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textContent(parent: Element, localName: string): string | undefined {
  const child = childElement(parent, localName);
  return child?.textContent?.trim() || undefined;
}

function descendantTextContent(parent: Element, localName: string): string | undefined {
  const matches = parent.getElementsByTagNameNS(MUSICXML_NS, localName);
  return matches[0]?.textContent?.trim() || undefined;
}

function childElement(parent: Element, localName: string): Element | undefined {
  return Array.from(parent.children).find((child) => child.localName === localName);
}

function xmlId(element: Element): string | undefined {
  return element.getAttributeNS(XML_NS, 'id') ?? element.getAttribute('xml:id') ?? element.getAttribute('id') ?? undefined;
}

function creatorText(root: Element, type: string): string | undefined {
  const identification = childElement(root, 'identification');
  if (!identification) {
    return undefined;
  }

  for (const creator of Array.from(identification.children).filter((child) => child.localName === 'creator')) {
    if (creator.getAttribute('type') === type) {
      return creator.textContent?.trim() || undefined;
    }
  }

  return undefined;
}

function formatAlter(alter: number): string {
  if (alter > 0) {
    return '#'.repeat(alter);
  }

  if (alter < 0) {
    return 'b'.repeat(Math.abs(alter));
  }

  return '';
}
