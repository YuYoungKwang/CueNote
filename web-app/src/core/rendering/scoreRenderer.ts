import type { ScoreVersion, StableMeasureId } from '@cuenote/score-domain';

export interface RenderedMeasureLink {
  measureId: StableMeasureId;
  sourceXmlId: string;
  pageNumber: number;
}

export interface ScoreRenderer {
  mount(container: HTMLElement): Promise<void>;
  load(version: ScoreVersion, zoom: number): Promise<void>;
  highlight(measureId: StableMeasureId): void;
  scrollTo(measureId: StableMeasureId): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  getMeasureLinks(): RenderedMeasureLink[];
  onMeasureSelect(listener: (measureId: StableMeasureId) => void): () => void;
  destroy(): void;
}
