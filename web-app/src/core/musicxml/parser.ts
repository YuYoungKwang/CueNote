import {
  createStableMeasureId,
  type KeySignature,
  type Measure,
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
    throw new MusicXmlParseError('UNSUPPORTED_STRUCTURE', 'Only score-partwise MusicXML is supported in Phase 1.');
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

  for (const [measureIndex, measureElement] of measures.entries()) {
    const numberText = measureElement.getAttribute('number') ?? String(measureIndex + 1);
    const sourceXmlId = xmlId(measureElement) ?? `${partId}-measure-${measureIndex + 1}`;
    const measureId = createStableMeasureId(scoreId, partIndex, measureIndex + 1, sourceXmlId);
    const measureTimeSignature = parseTimeSignature(measureElement) ?? currentTimeSignature;
    const measureKeySignature = parseKeySignature(measureElement) ?? currentKeySignature;

    if (measureTimeSignature) {
      currentTimeSignature = measureTimeSignature;
    }

    if (measureKeySignature) {
      currentKeySignature = measureKeySignature;
    }

    parsedMeasures.push({
      id: measureId,
      number: Number.parseInt(numberText, 10) || measureIndex + 1,
      sourceXmlId,
      partId,
      displayNumber: numberText,
      timeSignature: measureTimeSignature,
      keySignature: measureKeySignature,
      chordSymbols: parseChordSymbols(measureElement),
      lyrics: parseLyrics(measureElement)
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
