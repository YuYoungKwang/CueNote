import { createStableMeasureId, type NavigationMark, type ScoreVersion } from '../model';
import type {
  ChordQuality,
  DurationType,
  DurationValue,
  EditableChordSymbol,
  EditableClef,
  EditableEvent,
  EditableLyric,
  EditableMeasure,
  OpaqueMusicXmlFragment,
  OpaqueMusicXmlParentType,
  EditablePart,
  EditableScoreDocument,
  IdGenerator,
  PitchStep
} from './model';
import { formatChordDisplay } from './transpose';
import { refreshValidation } from './reducer';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export function editableScoreFromMusicXml(version: ScoreVersion, idGenerator: IdGenerator = sequentialIdGenerator()): EditableScoreDocument {
  rejectUnsafeXml(version.sourceXml);
  const xmlDocument = new DOMParser().parseFromString(version.sourceXml, 'application/xml');
  if (xmlDocument.getElementsByTagName('parsererror')[0]) {
    throw new Error('Invalid MusicXML cannot be edited.');
  }
  if (xmlDocument.documentElement.localName !== 'score-partwise') {
    throw new Error('Only score-partwise MusicXML can be edited in Phase 6.');
  }

  const partInfo = parsePartList(xmlDocument.documentElement);
  const title = descendantText(xmlDocument.documentElement, 'work-title') ?? version.title;
  const opaqueFragments: OpaqueMusicXmlFragment[] = [];
  collectOpaqueChildren(
    xmlDocument.documentElement,
    'SCORE_PARTWISE',
    version.scoreId,
    new Set(['work', 'part-list', 'part']),
    opaqueFragments
  );
  const partListElement = child(xmlDocument.documentElement, 'part-list');
  if (partListElement) {
    collectOpaqueChildren(partListElement, 'PART_LIST', `${version.scoreId}:part-list`, new Set(['score-part']), opaqueFragments);
  }
  const parts = Array.from(xmlDocument.documentElement.children)
    .filter((child) => child.localName === 'part')
    .map((partElement, partIndex) => parsePart(partElement, partInfo, version.scoreId, partIndex, idGenerator, opaqueFragments));

  if (parts.length === 0) {
    throw new Error('MusicXML does not contain editable parts.');
  }

  return refreshValidation({
    scoreId: version.scoreId,
    baseScoreVersionId: version.id,
    title,
    parts,
    revision: 0,
    dirty: false,
    opaqueFragments,
    validationIssues: []
  });
}

export function serializeEditableScoreToMusicXml(document: EditableScoreDocument): string {
  const rootEntries = [
    orderedXml(0, `<work><work-title>${escapeXml(document.title)}</work-title></work>`),
    orderedXml(1, serializePartList(document.parts, document.opaqueFragments, `${document.scoreId}:part-list`)),
    ...opaqueFor(document.opaqueFragments, 'SCORE_PARTWISE', document.scoreId).map(fragment => orderedXml(fragment.originalOrder, fragment.xml)),
    ...document.parts.map((part, index) => orderedXml(100 + index, serializePart(part, document.opaqueFragments)))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n${indent(
    rootEntries.sort(byOrder).map(entry => entry.xml).join('\n'),
    2
  )}\n</score-partwise>\n`;
  assertWellFormedSerializedXml(xml);
  return xml;
}

export function sequentialIdGenerator(): IdGenerator {
  let next = 1;
  return (prefix) => `${prefix}_${next++}`;
}

function parsePartList(root: Element): Array<{ id: string; name: string; abbreviation?: string }> {
  const partList = child(root, 'part-list');
  if (!partList) {
    throw new Error('MusicXML part-list is required for editing.');
  }
  return Array.from(partList.children)
    .filter((element) => element.localName === 'score-part')
    .map((element) => ({
      id: element.getAttribute('id') ?? '',
      name: text(element, 'part-name') ?? 'Unnamed part',
      abbreviation: text(element, 'part-abbreviation')
    }))
    .filter((part) => part.id.length > 0);
}

function parsePart(
  partElement: Element,
  partInfo: Array<{ id: string; name: string; abbreviation?: string }>,
  scoreId: string,
  partIndex: number,
  idGenerator: IdGenerator,
  opaqueFragments: OpaqueMusicXmlFragment[]
): EditablePart {
  const partId = partElement.getAttribute('id') || `P${partIndex + 1}`;
  const descriptor = partInfo.find((part) => part.id === partId);
  let currentDivisions = 1;
  let currentTimeSignature = { beats: 4, beatType: 4 };
  let currentKeySignature = { fifths: 0, mode: 'major' as const };
  let currentClef: EditableClef | undefined = { sign: 'G', line: 2 };

  const measures = Array.from(partElement.children)
    .filter((childElement) => childElement.localName === 'measure')
    .map((measureElement, measureIndex) => {
      const attributes = child(measureElement, 'attributes');
      const divisions = parsePositiveInt(text(attributes ?? measureElement, 'divisions')) ?? currentDivisions;
      const timeSignature = parseTime(attributes) ?? currentTimeSignature;
      const keySignature = parseKey(attributes) ?? currentKeySignature;
      const clef = parseClef(attributes) ?? currentClef;
      currentDivisions = divisions;
      currentTimeSignature = timeSignature;
      currentKeySignature = keySignature;
      currentClef = clef;
      return parseMeasure(measureElement, scoreId, partId, partIndex, measureIndex, { divisions, timeSignature, keySignature, clef }, idGenerator, opaqueFragments);
    });
  collectOpaqueChildren(partElement, 'PART', partId, new Set(['measure']), opaqueFragments);

  return {
    id: partId,
    name: descriptor?.name ?? `Part ${partIndex + 1}`,
    abbreviation: descriptor?.abbreviation,
    measures
  };
}

function parseMeasure(
  measureElement: Element,
  scoreId: string,
  partId: string,
  partIndex: number,
  measureIndex: number,
  attributes: EditableMeasure['attributes'],
  idGenerator: IdGenerator,
  opaqueFragments: OpaqueMusicXmlFragment[]
): EditableMeasure {
  const sourceXmlId = xmlId(measureElement) ?? `${partId}-measure-${measureIndex + 1}`;
  const measureId = createStableMeasureId(scoreId, partIndex, measureIndex + 1, sourceXmlId);
  const lyrics: EditableLyric[] = [];
  const events: EditableEvent[] = [];

  const measureChildren = Array.from(measureElement.children);
  measureChildren
    .filter((element) => element.localName === 'note')
    .forEach((noteElement, noteIndex) => {
      const duration = parseDuration(noteElement, attributes.divisions);
      const eventId = `${measureId}:event:${noteIndex + 1}`;
      collectOpaqueChildren(noteElement, 'NOTE', eventId, supportedNoteChildren(), opaqueFragments);
      if (child(noteElement, 'rest')) {
        events.push({
          kind: 'REST',
          id: eventId,
          duration,
          voice: text(noteElement, 'voice'),
          staff: text(noteElement, 'staff'),
          originalOrder: childOrder(noteElement),
          unsupported: unsupportedNoteChildren(noteElement)
        });
        return;
      }
      const pitchElement = child(noteElement, 'pitch');
      if (!pitchElement) {
        return;
      }
      const noteLyrics = parseLyrics(noteElement, eventId, measureId, idGenerator);
      lyrics.push(...noteLyrics);
      events.push({
        kind: 'NOTE',
        id: eventId,
        pitch: {
          step: parsePitchStep(text(pitchElement, 'step')) ?? 'C',
          alter: parseAlter(text(pitchElement, 'alter')),
          octave: parsePositiveInt(text(pitchElement, 'octave')) ?? 4
        },
        duration,
        voice: text(noteElement, 'voice'),
        staff: text(noteElement, 'staff'),
        tie: parseTie(noteElement),
        originalOrder: childOrder(noteElement),
        lyricIds: noteLyrics.map((lyric) => lyric.id),
        unsupported: unsupportedNoteChildren(noteElement)
      });
    });
  collectOpaqueChildren(measureElement, 'MEASURE', measureId, supportedMeasureChildren(), opaqueFragments);

  return {
    id: measureId,
    sourceMeasureId: measureId,
    number: parsePositiveInt(measureElement.getAttribute('number')) ?? measureIndex + 1,
    attributes,
    events,
    chordSymbols: parseChordSymbols(measureElement, measureId, idGenerator, opaqueFragments),
    lyrics,
    navigationMarks: parseNavigationMarks(measureElement, measureId)
  };
}

function parseDuration(noteElement: Element, divisions: number): DurationValue {
  const duration = parsePositiveInt(text(noteElement, 'duration')) ?? divisions;
  const type = parseDurationType(text(noteElement, 'type'), duration, divisions);
  return {
    divisions: duration,
    type,
    dotted: Boolean(child(noteElement, 'dot')),
    unsupportedTuplet: Boolean(child(noteElement, 'time-modification'))
  };
}

function parseDurationType(raw: string | undefined, duration: number, divisions: number): DurationType {
  if (raw === 'whole' || raw === 'half' || raw === 'quarter' || raw === 'eighth' || raw === '16th') {
    return raw;
  }
  if (duration >= divisions * 4) {
    return 'whole';
  }
  if (duration >= divisions * 2) {
    return 'half';
  }
  if (duration <= Math.max(1, Math.round(divisions / 4))) {
    return '16th';
  }
  if (duration <= Math.max(1, Math.round(divisions / 2))) {
    return 'eighth';
  }
  return 'quarter';
}

function parseLyrics(noteElement: Element, eventId: string, measureId: string, idGenerator: IdGenerator): EditableLyric[] {
  return Array.from(noteElement.children)
    .filter((element) => element.localName === 'lyric')
    .map((lyricElement) => ({
      id: `${measureId}:lyric:${idGenerator('lyric')}`,
      eventId,
      verse: lyricElement.getAttribute('number') ?? '1',
      syllabic: parseSyllabic(text(lyricElement, 'syllabic')),
      text: text(lyricElement, 'text') ?? ''
    }));
}

function parseChordSymbols(measureElement: Element, measureId: string, idGenerator: IdGenerator, opaqueFragments: OpaqueMusicXmlFragment[]): EditableChordSymbol[] {
  return Array.from(measureElement.children)
    .filter((element) => element.localName === 'harmony')
    .map((harmony) => {
      const chordId = `${measureId}:chord:${idGenerator('chord')}`;
      collectOpaqueChildren(harmony, 'HARMONY', chordId, new Set(['root', 'kind', 'bass']), opaqueFragments);
      const root = child(harmony, 'root');
      const bass = child(harmony, 'bass');
      const quality = parseChordQuality(child(harmony, 'kind')?.getAttribute('text') ?? text(harmony, 'kind'));
      const chord: EditableChordSymbol = {
        id: chordId,
        measureId,
        root: parsePitchStep(text(root ?? harmony, 'root-step')) ?? 'C',
        alter: parseAlter(text(root ?? harmony, 'root-alter')),
        quality,
        bass: bass
          ? {
              step: parsePitchStep(text(bass, 'bass-step')) ?? 'C',
              alter: parseAlter(text(bass, 'bass-alter'))
            }
          : undefined,
        displayText: ''
      };
      return { ...chord, displayText: harmony.getAttribute('text') ?? formatChordDisplay(chord), originalOrder: childOrder(harmony) };
    });
}

function parseNavigationMarks(measureElement: Element, measureId: string): NavigationMark[] {
  const marks: NavigationMark[] = [];
  Array.from(measureElement.children)
    .filter((element) => element.localName === 'barline')
    .forEach((barline, index) => {
      const repeat = child(barline, 'repeat');
      if (repeat?.getAttribute('direction') === 'forward') {
        marks.push({ id: `${measureId}:nav:repeat-start:${index}`, type: 'REPEAT_START', measureId });
      }
      if (repeat?.getAttribute('direction') === 'backward') {
        marks.push({ id: `${measureId}:nav:repeat-end:${index}`, type: 'REPEAT_END', measureId });
      }
    });
  return marks;
}

function serializePartList(parts: EditablePart[], fragments: OpaqueMusicXmlFragment[], parentId: string): string {
  const body = [
    ...parts.map((part, index) => orderedXml(index, `<score-part id="${escapeXml(part.id)}"><part-name>${escapeXml(part.name)}</part-name></score-part>`)),
    ...opaqueFor(fragments, 'PART_LIST', parentId).map(fragment => orderedXml(fragment.originalOrder, fragment.xml))
  ];
  return `<part-list>\n${indent(body.sort(byOrder).map(entry => entry.xml).join('\n'), 2)}\n</part-list>`;
}

function serializePart(part: EditablePart, fragments: OpaqueMusicXmlFragment[]): string {
  const body = [
    ...part.measures.map((measure, index) => orderedXml(index, serializeMeasure(measure, index, fragments))),
    ...opaqueFor(fragments, 'PART', part.id).map(fragment => orderedXml(fragment.originalOrder, fragment.xml))
  ];
  return `<part id="${escapeXml(part.id)}">\n${indent(body.sort(byOrder).map(entry => entry.xml).join('\n'), 2)}\n</part>`;
}

function serializeMeasure(measure: EditableMeasure, index: number, fragments: OpaqueMusicXmlFragment[]): string {
  const body = [orderedXml(0, serializeAttributes(measure.attributes, index === 0))];
  measure.chordSymbols.forEach((chord, chordIndex) => body.push(orderedXml(chord.originalOrder ?? 10 + chordIndex, serializeChord(chord, fragments))));
  measure.events.forEach((event, eventIndex) => body.push(orderedXml(event.originalOrder ?? 20 + eventIndex, serializeEvent(event, measure.lyrics.filter((lyric) => lyric.eventId === event.id), fragments))));
  measure.navigationMarks.forEach((mark) => {
    if (mark.type === 'REPEAT_START') {
      body.push(orderedXml(100, '<barline location="left"><repeat direction="forward"/></barline>'));
    }
    if (mark.type === 'REPEAT_END') {
      body.push(orderedXml(101, '<barline location="right"><repeat direction="backward"/></barline>'));
    }
  });
  opaqueFor(fragments, 'MEASURE', measure.id).forEach(fragment => body.push(orderedXml(fragment.originalOrder, fragment.xml)));
  return `<measure number="${measure.number}" xml:id="${escapeXml(measure.sourceMeasureId.split(':').at(-1) ?? `m${measure.number}`)}">\n${indent(
    body.sort(byOrder).map(entry => entry.xml).join('\n'),
    2
  )}\n</measure>`;
}

function serializeAttributes(attributes: EditableMeasure['attributes'], includeClef: boolean): string {
  const chunks = [
    `<divisions>${attributes.divisions}</divisions>`,
    attributes.keySignature ? `<key><fifths>${attributes.keySignature.fifths}</fifths><mode>${attributes.keySignature.mode}</mode></key>` : '',
    attributes.timeSignature
      ? `<time><beats>${attributes.timeSignature.beats}</beats><beat-type>${attributes.timeSignature.beatType}</beat-type></time>`
      : '',
    includeClef && attributes.clef ? `<clef><sign>${escapeXml(attributes.clef.sign)}</sign><line>${attributes.clef.line}</line></clef>` : ''
  ].filter(Boolean);
  return `<attributes>\n${indent(chunks.join('\n'), 2)}\n</attributes>`;
}

function serializeEvent(event: EditableEvent, lyrics: EditableLyric[], fragments: OpaqueMusicXmlFragment[]): string {
  const body = [];
  if (event.kind === 'REST') {
    body.push(orderedXml(0, '<rest/>'));
  } else {
    body.push(orderedXml(
      0,
      `<pitch><step>${event.pitch.step}</step>${event.pitch.alter === 0 ? '' : `<alter>${event.pitch.alter}</alter>`}<octave>${event.pitch.octave}</octave></pitch>`
    )
    );
  }
  body.push(orderedXml(1, `<duration>${event.duration.divisions}</duration>`));
  if (event.voice) {
    body.push(orderedXml(2, `<voice>${escapeXml(event.voice)}</voice>`));
  }
  body.push(orderedXml(3, `<type>${event.duration.type}</type>`));
  if (event.duration.dotted) {
    body.push(orderedXml(4, '<dot/>'));
  }
  if (event.staff) {
    body.push(orderedXml(5, `<staff>${escapeXml(event.staff)}</staff>`));
  }
  lyrics.filter((lyric) => lyric.text.trim().length > 0).forEach((lyric, lyricIndex) => {
    body.push(orderedXml(
      20 + lyricIndex,
      `<lyric number="${escapeXml(lyric.verse)}"><syllabic>${lyric.syllabic}</syllabic><text>${escapeXml(lyric.text)}</text></lyric>`
    ));
  });
  opaqueFor(fragments, 'NOTE', event.id).forEach(fragment => body.push(orderedXml(fragment.originalOrder, fragment.xml)));
  return `<note>\n${indent(body.sort(byOrder).map(entry => entry.xml).join('\n'), 2)}\n</note>`;
}

function serializeChord(chord: EditableChordSymbol, fragments: OpaqueMusicXmlFragment[]): string {
  const bass = chord.bass
    ? `<bass><bass-step>${chord.bass.step}</bass-step>${chord.bass.alter === 0 ? '' : `<bass-alter>${chord.bass.alter}</bass-alter>`}</bass>`
    : '';
  const opaque = opaqueFor(fragments, 'HARMONY', chord.id).map(fragment => fragment.xml).join('');
  return `<harmony><root><root-step>${chord.root}</root-step>${chord.alter === 0 ? '' : `<root-alter>${chord.alter}</root-alter>`}</root><kind text="${escapeXml(
    chord.displayText
  )}">${chord.quality}</kind>${bass}${opaque}</harmony>`;
}

function parseTime(attributes: Element | undefined): { beats: number; beatType: number } | undefined {
  const time = attributes ? child(attributes, 'time') : undefined;
  if (!time) {
    return undefined;
  }
  const beats = parsePositiveInt(text(time, 'beats'));
  const beatType = parsePositiveInt(text(time, 'beat-type'));
  return beats && beatType ? { beats, beatType } : undefined;
}

function parseKey(attributes: Element | undefined): { fifths: number; mode: 'major' | 'minor' } | undefined {
  const key = attributes ? child(attributes, 'key') : undefined;
  if (!key) {
    return undefined;
  }
  const fifths = Number.parseInt(text(key, 'fifths') ?? '0', 10);
  return { fifths: Number.isFinite(fifths) ? fifths : 0, mode: text(key, 'mode') === 'minor' ? 'minor' : 'major' };
}

function parseClef(attributes: Element | undefined): EditableClef | undefined {
  const clef = attributes ? child(attributes, 'clef') : undefined;
  if (!clef) {
    return undefined;
  }
  return { sign: text(clef, 'sign') ?? 'G', line: parsePositiveInt(text(clef, 'line')) ?? 2 };
}

function parsePitchStep(value: string | undefined): PitchStep | undefined {
  return value === 'C' || value === 'D' || value === 'E' || value === 'F' || value === 'G' || value === 'A' || value === 'B' ? value : undefined;
}

function parseAlter(value: string | undefined): -1 | 0 | 1 {
  const parsed = Number.parseInt(value ?? '0', 10);
  return parsed < 0 ? -1 : parsed > 0 ? 1 : 0;
}

function parseSyllabic(value: string | undefined): EditableLyric['syllabic'] {
  return value === 'begin' || value === 'middle' || value === 'end' ? value : 'single';
}

function parseChordQuality(value: string | undefined): ChordQuality {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('minor') || normalized === 'm') {
    return normalized.includes('seventh') || normalized.includes('7') ? 'minor-seventh' : 'minor';
  }
  if (normalized.includes('major-seventh') || normalized.includes('maj7')) {
    return 'major-seventh';
  }
  if (normalized.includes('dominant') || normalized === '7') {
    return 'dominant';
  }
  if (normalized.includes('half')) {
    return 'half-diminished';
  }
  return normalized ? 'other' : 'major';
}

function parseTie(noteElement: Element): 'start' | 'stop' | 'continue' | undefined {
  const ties = Array.from(noteElement.children).filter((element) => element.localName === 'tie');
  const hasStart = ties.some((tie) => tie.getAttribute('type') === 'start');
  const hasStop = ties.some((tie) => tie.getAttribute('type') === 'stop');
  if (hasStart && hasStop) {
    return 'continue';
  }
  if (hasStart) {
    return 'start';
  }
  if (hasStop) {
    return 'stop';
  }
  return undefined;
}

function unsupportedNoteChildren(noteElement: Element): string[] {
  const supported = supportedNoteChildren();
  return Array.from(noteElement.children)
    .map((element) => element.localName)
    .filter((name) => !supported.has(name));
}

function supportedNoteChildren(): Set<string> {
  return new Set(['pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'staff', 'lyric', 'tie']);
}

function supportedMeasureChildren(): Set<string> {
  return new Set(['attributes', 'note', 'harmony', 'barline']);
}

function collectOpaqueChildren(
  parent: Element,
  parentType: OpaqueMusicXmlParentType,
  parentId: string,
  supportedChildren: Set<string>,
  fragments: OpaqueMusicXmlFragment[]
) {
  Array.from(parent.children).forEach((element) => {
    if (supportedChildren.has(element.localName)) {
      return;
    }
    const xml = serializeElement(element);
    if (isUnsafeXml(xml)) {
      fragments.push({
        id: opaqueFragmentId(parentType, parentId, childOrder(element), element.localName),
        parentType,
        parentId,
        originalOrder: childOrder(element),
        elementName: element.localName,
        xml: '',
        namespaceUri: element.namespaceURI ?? undefined,
        status: 'DROPPED_FOR_SECURITY'
      });
      return;
    }
    fragments.push({
      id: opaqueFragmentId(parentType, parentId, childOrder(element), element.localName),
      parentType,
      parentId,
      originalOrder: childOrder(element),
      elementName: element.localName,
      xml,
      namespaceUri: element.namespaceURI ?? undefined,
      status: 'OPAQUE_PRESERVED'
    });
  });
}

function opaqueFragmentId(parentType: OpaqueMusicXmlParentType, parentId: string, originalOrder: number, elementName: string): string {
  return `${parentType}:${parentId}:opaque:${originalOrder}:${elementName}`.replace(/\s+/g, '_');
}

function opaqueFor(fragments: OpaqueMusicXmlFragment[], parentType: OpaqueMusicXmlParentType, parentId: string): OpaqueMusicXmlFragment[] {
  return fragments
    .filter((fragment) => fragment.status === 'OPAQUE_PRESERVED' && fragment.parentType === parentType && fragment.parentId === parentId)
    .sort((left, right) => left.originalOrder - right.originalOrder || left.id.localeCompare(right.id));
}

function orderedXml(order: number, xml: string): { order: number; xml: string } {
  return { order, xml };
}

function byOrder(left: { order: number; xml: string }, right: { order: number; xml: string }): number {
  return left.order - right.order || left.xml.localeCompare(right.xml);
}

function childOrder(element: Element): number {
  return Array.from(element.parentElement?.children ?? []).indexOf(element);
}

function serializeElement(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

function rejectUnsafeXml(xml: string) {
  if (isUnsafeXml(xml)) {
    throw new Error('Unsafe MusicXML cannot be edited.');
  }
}

function isUnsafeXml(xml: string): boolean {
  const normalized = xml.toLowerCase();
  return normalized.includes('<!doctype') || normalized.includes('<!entity') || normalized.includes('<xi:include') || normalized.includes('xinclude');
}

function assertWellFormedSerializedXml(xml: string) {
  rejectUnsafeXml(xml);
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.getElementsByTagName('parsererror')[0]) {
    throw new Error('Serialized MusicXML is not well-formed.');
  }
}

function child(parent: Element | undefined, localName: string): Element | undefined {
  return parent ? Array.from(parent.children).find((element) => element.localName === localName) : undefined;
}

function text(parent: Element | undefined, localName: string): string | undefined {
  return child(parent, localName)?.textContent?.trim() || undefined;
}

function descendantText(parent: Element, localName: string): string | undefined {
  return Array.from(parent.getElementsByTagName(localName))[0]?.textContent?.trim() || undefined;
}

function xmlId(element: Element): string | undefined {
  return element.getAttributeNS(XML_NS, 'id') ?? element.getAttribute('xml:id') ?? element.getAttribute('id') ?? undefined;
}

function parsePositiveInt(value: string | null | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function indent(value: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line.length > 0 ? `${padding}${line}` : line))
    .join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
