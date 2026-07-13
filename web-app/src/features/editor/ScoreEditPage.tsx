import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createEditHistory,
  dispatchEditCommand,
  editableScoreFromMusicXml,
  formatPitch,
  hasBlockingIssues,
  redoEdit,
  refreshValidation,
  serializeEditableScoreToMusicXml,
  transposePitch,
  undoEdit,
  type DurationType,
  type DurationValue,
  type EditableChordSymbol,
  type EditableEvent,
  type EditableMeasure,
  type EditableScoreDocument,
  type EditCommand,
  type EditHistoryState,
  type Pitch,
  type PitchStep,
  type ScoreVersion,
  type StableMeasureId
} from '@cuenote/score-domain';
import { createApiClient, type ServerScoreDetail } from '../../core/api/client';
import { createServerSessionStore } from '../../core/api/sessionStore';
import { createMusicXMLService } from '../../core/musicxml/parser';
import { createVerovioScoreRenderer } from '../../core/rendering/verovioScoreRenderer';
import { createScoreEditDraftStore, draftKey } from '../../core/storage/scoreEditDraftStore';

type EditStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; score: ServerScoreDetail; history: EditHistoryState; commandHistory: EditCommand[]; baseVersionId: string }
  | { kind: 'error'; message: string };

type RendererState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DURATIONS: Array<{ label: string; type: DurationType; beats: number; dotted?: boolean }> = [
  { label: 'Whole', type: 'whole', beats: 4 },
  { label: 'Dotted half', type: 'half', beats: 3, dotted: true },
  { label: 'Half', type: 'half', beats: 2 },
  { label: 'Dotted quarter', type: 'quarter', beats: 1.5, dotted: true },
  { label: 'Quarter', type: 'quarter', beats: 1 },
  { label: 'Eighth', type: 'eighth', beats: 0.5 },
  { label: 'Sixteenth', type: '16th', beats: 0.25 }
];

export function ScoreEditPage() {
  const { scoreId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const apiClient = useMemo(() => createApiClient(), []);
  const sessionStore = useMemo(() => createServerSessionStore(), []);
  const draftStore = useMemo(() => createScoreEditDraftStore(), []);
  const musicXmlService = useMemo(() => createMusicXMLService(), []);
  const rendererRef = useRef<ReturnType<typeof createVerovioScoreRenderer> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const idCounter = useRef(1);
  const [status, setStatus] = useState<EditStatus>({ kind: 'loading' });
  const [rendererState, setRendererState] = useState<RendererState>({ kind: 'idle' });
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedMeasureId, setSelectedMeasureId] = useState<StableMeasureId | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [storageMessage, setStorageMessage] = useState('Draft autosave idle.');
  const [publishMessage, setPublishMessage] = useState('No publish attempted.');
  const requestedVersionId = searchParams.get('versionId');

  const nextId = (prefix: string) => `${prefix}_${idCounter.current++}`;
  const ready = status.kind === 'ready' ? status : null;
  const document = ready?.history.present ?? null;
  const selectedPart = document?.parts.find((part) => part.id === selectedPartId) ?? document?.parts[0] ?? null;
  const selectedMeasure = selectedPart?.measures.find((measure) => measure.id === selectedMeasureId) ?? selectedPart?.measures[0] ?? null;
  const selectedEvent = selectedMeasure?.events.find((event) => event.id === selectedEventId) ?? selectedMeasure?.events[0] ?? null;
  const selectedChord = selectedMeasure?.chordSymbols[0] ?? null;
  const selectedLyric =
    selectedEvent?.kind === 'NOTE' ? selectedMeasure?.lyrics.find((lyric) => selectedEvent.lyricIds.includes(lyric.id)) ?? null : null;

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });

    const load = async () => {
      const session = sessionStore.load();
      if (!session) {
        throw new Error('Sign in from the library before editing a server score.');
      }
      const score = await apiClient.getScore(session.accessToken, scoreId);
      const baseVersionId = requestedVersionId ?? score.current_version_id;
      if (!baseVersionId) {
        throw new Error('Score has no editable current version.');
      }
      const sourceXml = await apiClient.getScoreVersionSource(session.accessToken, score.id, baseVersionId);
      const parsed = musicXmlService.parse(sourceXml, { scoreId: score.id, sample: false });
      const version: ScoreVersion = { ...parsed.version, id: baseVersionId };
      const restoredDraft = await draftStore.load(score.id, baseVersionId).catch(() => undefined);
      const editable = restoredDraft?.editableDocument ?? editableScoreFromMusicXml(version, nextId);
      return { score, baseVersionId, editable, commandHistory: restoredDraft?.commandHistory ?? [] };
    };

    void load()
      .then(({ score, baseVersionId, editable, commandHistory }) => {
        if (cancelled) {
          return;
        }
        const history = createEditHistory(editable);
        setStatus({ kind: 'ready', score, baseVersionId, history, commandHistory });
        setSelectedPartId(editable.parts[0]?.id ?? null);
        setSelectedMeasureId(editable.parts[0]?.measures[0]?.id ?? null);
        setSelectedEventId(editable.parts[0]?.measures[0]?.events[0]?.id ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to load edit draft.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, draftStore, musicXmlService, requestedVersionId, scoreId, sessionStore]);

  useEffect(() => {
    if (!document?.dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [document?.dirty]);

  useEffect(() => {
    if (!ready || !document) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const now = Date.now();
      void draftStore
        .save({
          id: draftKey(document.scoreId, ready.baseVersionId),
          scoreId: document.scoreId,
          baseScoreVersionId: ready.baseVersionId,
          editableDocument: document,
          commandHistory: ready.commandHistory,
          historyCursor: ready.commandHistory.length,
          validationIssues: document.validationIssues,
          createdAt: now,
          updatedAt: now,
          lastAutosavedAt: now
        })
        .then(() => setStorageMessage('Draft autosaved.'))
        .catch((error) => setStorageMessage(error instanceof Error ? error.message : 'Draft autosave failed.'));
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [document, draftStore, ready]);

  useEffect(() => {
    if (!ready || !document) {
      return;
    }
    void draftStore
      .savePreferences({
        id: draftKey(document.scoreId, ready.baseVersionId),
        scoreId: document.scoreId,
        baseScoreVersionId: ready.baseVersionId,
        selectedPartId: selectedPartId ?? undefined,
        selectedMeasureId: selectedMeasureId ?? undefined,
        selectedEventId: selectedEventId ?? undefined,
        zoom
      })
      .catch(() => {
        setStorageMessage('Edit preferences could not be saved.');
      });
  }, [document, draftStore, ready, selectedEventId, selectedMeasureId, selectedPartId, zoom]);

  useEffect(() => {
    if (!document || !containerRef.current) {
      return;
    }

    let cancelled = false;
    const renderer = createVerovioScoreRenderer();
    rendererRef.current = renderer;
    setRendererState({ kind: 'loading' });
    containerRef.current.innerHTML = '';

    const render = async () => {
      const xml = serializeEditableScoreToMusicXml(document);
      const parsed = musicXmlService.parse(xml, { scoreId: document.scoreId, sample: false });
      const previewVersion: ScoreVersion = {
        ...parsed.version,
        id: `${document.baseScoreVersionId}:draft-preview`,
        title: document.title,
        sourceXml: xml
      };
      await renderer.mount(containerRef.current!);
      await renderer.load(previewVersion, zoom);
      renderer.onMeasureSelect((measureId) => setSelectedMeasureId(measureId));
      if (selectedMeasureId) {
        renderer.highlight(selectedMeasureId);
        await renderer.scrollTo(selectedMeasureId);
      }
    };

    void render()
      .then(() => {
        if (!cancelled) {
          setRendererState({ kind: 'ready' });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRendererState({ kind: 'error', message: error instanceof Error ? error.message : 'Draft preview render failed.' });
        }
      });

    return () => {
      cancelled = true;
      renderer.destroy();
      rendererRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [document, musicXmlService, selectedMeasureId, zoom]);

  const dispatch = (command: EditCommand) => {
    setStatus((current) => {
      if (current.kind !== 'ready') {
        return current;
      }
      const history = dispatchEditCommand(current.history, command, nextId);
      return { ...current, history, commandHistory: [...current.commandHistory, command] };
    });
  };

  const onUndo = () => {
    setStatus((current) => (current.kind === 'ready' ? { ...current, history: undoEdit(current.history) } : current));
  };

  const onRedo = () => {
    setStatus((current) => (current.kind === 'ready' ? { ...current, history: redoEdit(current.history) } : current));
  };

  const onValidate = () => {
    setStatus((current) =>
      current.kind === 'ready'
        ? { ...current, history: { ...current.history, present: refreshValidation(current.history.present) } }
        : current
    );
  };

  const onPublish = async () => {
    if (!ready || !document) {
      return;
    }
    const session = sessionStore.load();
    if (!session) {
      setPublishMessage('Sign in before publishing.');
      return;
    }
    const validated = refreshValidation(document);
    if (hasBlockingIssues(validated.validationIssues)) {
      setStatus({ ...ready, history: { ...ready.history, present: validated } });
      setPublishMessage('Fix blocking validation issues before publishing.');
      return;
    }
    try {
      setPublishMessage('Publishing new score version...');
      const xml = serializeEditableScoreToMusicXml(validated);
      const version = await apiClient.createScoreVersion(session.accessToken, ready.score.id, `${validated.title} edited`, xml, {
        baseScoreVersionId: ready.baseVersionId,
        editSummary: `Phase 6 edit commands: ${ready.commandHistory.length}`,
        annotationMigrationPolicy: 'NONE',
        expectedScoreRevision: ready.score.revision
      });
      await draftStore.delete(validated.scoreId, ready.baseVersionId).catch(() => undefined);
      setPublishMessage(`Published version ${version.version_number}.`);
      navigate(`/scores/${ready.score.id}?source=server&versionId=${version.id}`);
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : 'Publish failed.');
    }
  };

  const onExport = () => {
    if (!document) {
      return;
    }
    const blob = new Blob([serializeEditableScoreToMusicXml(document)], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'score'}-edited.musicxml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (status.kind === 'loading') {
    return <StatePanel title="Loading editor" message="Creating an editable draft from the selected MusicXML score version." />;
  }

  if (status.kind === 'error') {
    return <StatePanel title="Editor error" message={status.message} />;
  }

  const validationErrors = document.validationIssues.filter((issue) => issue.blocking);

  return (
    <main className="editor-layout" data-testid="score-edit-ready">
      <section className="editor-main panel">
        <div className="panel-heading viewer-heading">
          <div>
            <p className="eyebrow">Score edit</p>
            <h2>{document.title}</h2>
            <p className="muted">
              Base version {ready.baseVersionId}. Existing score versions are immutable; publishing creates a new version.
            </p>
          </div>
          <div className="viewer-actions">
            <button type="button" className="control-button" onClick={onUndo} disabled={ready.history.past.length === 0}>
              Undo
            </button>
            <button type="button" className="control-button" onClick={onRedo} disabled={ready.history.future.length === 0}>
              Redo
            </button>
            <button type="button" className="control-button" onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.1).toFixed(1))))}>
              -
            </button>
            <button type="button" className="control-button" onClick={() => setZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(1))))}>
              +
            </button>
            <button type="button" className="control-button" data-testid="score-edit-validate" onClick={onValidate}>
              Validate
            </button>
            <button type="button" className="control-button" data-testid="score-edit-export" onClick={onExport}>
              Export MusicXML
            </button>
            <button type="button" className="primary-link" data-testid="score-edit-publish" onClick={onPublish}>
              Publish new version
            </button>
          </div>
        </div>

        <div className="viewer-summary">
          <div>
            <span className="summary-label">Mode</span>
            <strong>SCORE_EDIT</strong>
          </div>
          <div>
            <span className="summary-label">Dirty</span>
            <strong data-testid="score-edit-dirty">{document.dirty ? 'yes' : 'no'}</strong>
          </div>
          <div>
            <span className="summary-label">Validation</span>
            <strong data-testid="score-edit-validation-count">{validationErrors.length}</strong>
          </div>
          <div>
            <span className="summary-label">Autosave</span>
            <strong data-testid="score-edit-storage-status">{storageMessage}</strong>
          </div>
          <div>
            <span className="summary-label">Publish</span>
            <strong data-testid="score-edit-publish-status">{publishMessage}</strong>
          </div>
        </div>

        {rendererState.kind === 'loading' ? (
          <div className="panel state-panel stage-state" data-testid="score-renderer-loading">
            <h3>Loading renderer</h3>
            <p>Verovio is loading for score edit preview.</p>
          </div>
        ) : null}
        {rendererState.kind === 'error' ? (
          <div className="panel state-panel stage-state" data-testid="score-viewer-error">
            <h3>Renderer error</h3>
            <p>{rendererState.message}</p>
          </div>
        ) : null}
        <div className="score-stage">
          <div className="score-stage__renderer" ref={containerRef} data-testid="score-renderer" />
        </div>
      </section>

      <aside className="editor-sidebar panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inspector</p>
            <h2>Structured edit</h2>
          </div>
        </div>

        <label className="field">
          <span>Part</span>
          <select value={selectedPart?.id ?? ''} onChange={(event) => setSelectedPartId(event.target.value)}>
            {document.parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.name}
              </option>
            ))}
          </select>
        </label>

        <MeasureTools
          measure={selectedMeasure}
          onInsert={() => dispatch({ type: 'INSERT_MEASURE', afterMeasureId: selectedMeasure?.id })}
          onDuplicate={() => selectedMeasure && dispatch({ type: 'DUPLICATE_MEASURE', measureId: selectedMeasure.id })}
          onDelete={() => selectedMeasure && dispatch({ type: 'DELETE_MEASURE', measureId: selectedMeasure.id })}
          onTranspose={(semitones) => dispatch({ type: 'TRANSPOSE_RANGE', semitones, partId: selectedPart?.id, startMeasureId: selectedMeasure?.id, endMeasureId: selectedMeasure?.id })}
        />

        <div className="editor-list">
          <span className="summary-label">Measures</span>
          {selectedPart?.measures.map((measure) => (
            <button
              key={measure.id}
              type="button"
              className={`measure-item${selectedMeasure?.id === measure.id ? ' is-active' : ''}`}
              data-testid={`score-edit-measure-${measure.number}`}
              onClick={() => {
                setSelectedMeasureId(measure.id);
                setSelectedEventId(measure.events[0]?.id ?? null);
              }}
            >
              <span className="measure-item__number">M{measure.number}</span>
              <span className="measure-item__meta">{measure.events.length} events</span>
            </button>
          ))}
        </div>

        <div className="editor-list">
          <span className="summary-label">Events</span>
          {selectedMeasure?.events.map((event) => (
            <button
              key={event.id}
              type="button"
              className={`measure-item${selectedEvent?.id === event.id ? ' is-active' : ''}`}
              data-testid={`score-edit-event-${event.id}`}
              onClick={() => setSelectedEventId(event.id)}
            >
              <span className="measure-item__number">{event.kind}</span>
              <span className="measure-item__meta">
                {event.kind === 'NOTE' ? formatPitch(event.pitch) : 'Rest'} / {event.duration.type}
              </span>
            </button>
          ))}
        </div>

        {selectedPart && selectedMeasure && selectedEvent ? (
          <EventInspector
            partId={selectedPart.id}
            measure={selectedMeasure}
            event={selectedEvent}
            lyric={selectedLyric}
            chord={selectedChord}
            onCommand={dispatch}
            nextId={nextId}
          />
        ) : null}

        <div className="editor-list">
          <span className="summary-label">Validation issues</span>
          {document.validationIssues.length === 0 ? <p className="muted">No validation issues.</p> : null}
          {document.validationIssues.map((issue, index) => (
            <div key={`${issue.code}:${index}`} className={`warning-item warning-item--${issue.severity.toLowerCase()}`}>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>

        <div className="viewer-footer">
          <Link className="secondary-link" to={`/scores/${ready.score.id}?source=server&versionId=${ready.baseVersionId}`}>
            Cancel edit
          </Link>
        </div>
      </aside>
    </main>
  );
}

function EventInspector({
  partId,
  measure,
  event,
  lyric,
  chord,
  onCommand,
  nextId
}: {
  partId: string;
  measure: EditableMeasure;
  event: EditableEvent;
  lyric: { id: string; text: string; syllabic: 'single' | 'begin' | 'middle' | 'end' } | null;
  chord: EditableChordSymbol | null;
  onCommand: (command: EditCommand) => void;
  nextId: (prefix: string) => string;
}) {
  const durationValue = durationOptionValue(event.duration);

  const changeDuration = (value: string) => {
    const selected = DURATIONS.find((duration) => duration.label === value);
    if (!selected) {
      return;
    }
    onCommand({
      type: 'CHANGE_DURATION',
      partId,
      measureId: measure.id,
      eventId: event.id,
      duration: durationFromOption(selected, measure.attributes.divisions)
    });
  };

  const changePitch = (patch: Partial<Pitch>) => {
    if (event.kind !== 'NOTE') {
      return;
    }
    onCommand({ type: 'CHANGE_PITCH', partId, measureId: measure.id, eventId: event.id, pitch: { ...event.pitch, ...patch } });
  };

  const chordText = chord?.displayText ?? 'C';

  return (
    <div className="editor-inspector" data-testid="score-edit-inspector">
      <span className="summary-label">Selected event</span>
      <strong data-testid="score-edit-selected-event">{event.kind === 'NOTE' ? formatPitch(event.pitch) : 'REST'}</strong>

      {event.kind === 'NOTE' ? (
        <div className="editor-control-grid">
          <label className="field">
            <span>Step</span>
            <select value={event.pitch.step} onChange={(changeEvent) => changePitch({ step: changeEvent.target.value as PitchStep })}>
              {STEPS.map((step) => (
                <option key={step} value={step}>
                  {step}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Alter</span>
            <select value={event.pitch.alter} onChange={(changeEvent) => changePitch({ alter: Number(changeEvent.target.value) as -1 | 0 | 1 })}>
              <option value={-1}>flat</option>
              <option value={0}>natural</option>
              <option value={1}>sharp</option>
            </select>
          </label>
          <label className="field">
            <span>Octave</span>
            <input type="number" min={0} max={9} value={event.pitch.octave} onChange={(changeEvent) => changePitch({ octave: Number(changeEvent.target.value) })} />
          </label>
          <button type="button" className="control-button" data-testid="score-edit-pitch-up" onClick={() => onCommand({ type: 'CHANGE_PITCH', partId, measureId: measure.id, eventId: event.id, pitch: transposePitch(event.pitch, 1) })}>
            Semitone up
          </button>
          <button type="button" className="control-button" onClick={() => onCommand({ type: 'CHANGE_PITCH', partId, measureId: measure.id, eventId: event.id, pitch: transposePitch(event.pitch, -1) })}>
            Semitone down
          </button>
          <button type="button" className="control-button" onClick={() => onCommand({ type: 'CHANGE_PITCH', partId, measureId: measure.id, eventId: event.id, pitch: transposePitch(event.pitch, 12) })}>
            Octave up
          </button>
        </div>
      ) : null}

      <label className="field">
        <span>Duration</span>
        <select data-testid="score-edit-duration" value={durationValue} onChange={(changeEvent) => changeDuration(changeEvent.target.value)}>
          {DURATIONS.map((duration) => (
            <option key={duration.label} value={duration.label}>
              {duration.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Chord symbol</span>
        <input
          data-testid="score-edit-chord"
          value={chordText}
          onChange={(changeEvent) => {
            const parsed = parseChordInput(changeEvent.target.value, measure.id, chord?.id ?? `${measure.id}:chord:${nextId('chord')}`);
            onCommand({ type: 'CHANGE_CHORD', partId, measureId: measure.id, chordId: parsed.id, chord: parsed });
          }}
        />
      </label>

      {event.kind === 'NOTE' ? (
        <label className="field">
          <span>Lyric</span>
          <input
            data-testid="score-edit-lyric"
            value={lyric?.text ?? ''}
            onChange={(changeEvent) => {
              const lyricId = lyric?.id ?? `${measure.id}:lyric:${nextId('lyric')}`;
              onCommand({ type: 'CHANGE_LYRIC', partId, measureId: measure.id, lyricId, eventId: event.id, text: changeEvent.target.value });
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function MeasureTools({
  measure,
  onInsert,
  onDuplicate,
  onDelete,
  onTranspose
}: {
  measure: EditableMeasure | null;
  onInsert: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTranspose: (semitones: number) => void;
}) {
  return (
    <div className="editor-inspector">
      <span className="summary-label">Measure actions</span>
      <strong>{measure ? `M${measure.number}` : 'No measure'}</strong>
      <div className="playback-button-row">
        <button type="button" className="control-button" data-testid="score-edit-insert-measure" onClick={onInsert}>
          Insert
        </button>
        <button type="button" className="control-button" data-testid="score-edit-duplicate-measure" onClick={onDuplicate} disabled={!measure}>
          Duplicate
        </button>
        <button type="button" className="control-button" data-testid="score-edit-delete-measure" onClick={onDelete} disabled={!measure}>
          Delete
        </button>
      </div>
      <div className="playback-button-row">
        <button type="button" className="control-button" data-testid="score-edit-transpose-up" onClick={() => onTranspose(1)} disabled={!measure}>
          Transpose +1
        </button>
        <button type="button" className="control-button" onClick={() => onTranspose(-1)} disabled={!measure}>
          Transpose -1
        </button>
      </div>
    </div>
  );
}

function StatePanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="panel state-panel">
      <h2>{title}</h2>
      <p>{message}</p>
      <Link className="secondary-link" to="/">
        Library
      </Link>
    </main>
  );
}

function durationFromOption(option: (typeof DURATIONS)[number], divisions: number): DurationValue {
  return {
    type: option.type,
    dotted: Boolean(option.dotted),
    divisions: Math.max(1, Math.round(option.beats * divisions))
  };
}

function durationOptionValue(duration: DurationValue): string {
  return DURATIONS.find((option) => option.type === duration.type && Boolean(option.dotted) === duration.dotted)?.label ?? 'Quarter';
}

function parseChordInput(value: string, measureId: string, id: string): Omit<EditableChordSymbol, 'measureId'> {
  const trimmed = value.trim() || 'C';
  const match = trimmed.match(/^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/);
  const root = (match?.[1] as PitchStep | undefined) ?? 'C';
  const alter = match?.[2] === '#' ? 1 : match?.[2] === 'b' ? -1 : 0;
  const qualityText = (match?.[3] ?? '').toLowerCase();
  const quality: EditableChordSymbol['quality'] = qualityText.includes('m7b5')
    ? 'half-diminished'
    : qualityText.includes('maj7')
      ? 'major-seventh'
      : qualityText.includes('m7')
        ? 'minor-seventh'
        : qualityText.includes('m')
          ? 'minor'
          : qualityText.includes('7')
            ? 'dominant'
            : 'major';
  const bassStep = match?.[4] as PitchStep | undefined;
  const bassAlter = match?.[5] === '#' ? 1 : match?.[5] === 'b' ? -1 : 0;
  return {
    id,
    root,
    alter,
    quality,
    bass: bassStep ? { step: bassStep, alter: bassAlter } : undefined,
    displayText: trimmed
  };
}
