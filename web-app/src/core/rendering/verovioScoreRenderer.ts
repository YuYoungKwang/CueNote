import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { ScoreVersion, StableMeasureId } from '@cuenote/score-domain';
import {
  findRenderedMeasureElement,
  setRenderedMeasureHighlight
} from './measureDom';
import type { RenderedMeasureLink, ScoreRenderer } from './scoreRenderer';

type ToolkitOptions = {
  pageHeight: number;
  pageWidth: number;
  scale: number;
  svgHtml5: boolean;
  svgBoundingBoxes: boolean;
  adjustPageHeight: boolean;
};

const DEFAULT_OPTIONS: ToolkitOptions = {
  pageHeight: 1600,
  pageWidth: 1200,
  scale: 90,
  svgHtml5: true,
  svgBoundingBoxes: true,
  adjustPageHeight: true
};

export function createVerovioScoreRenderer(): ScoreRenderer {
  return new VerovioScoreRenderer();
}

class VerovioScoreRenderer implements ScoreRenderer {
  private container: HTMLElement | null = null;
  private toolkitPromise: Promise<VerovioToolkit> | null = null;
  private toolkit: VerovioToolkit | null = null;
  private version: ScoreVersion | null = null;
  private zoom = 1;
  private measureLinks: RenderedMeasureLink[] = [];
  private selectedMeasureId: StableMeasureId | null = null;
  private measureSelectListener: ((measureId: StableMeasureId) => void) | null = null;
  private clickHandlers = new Map<HTMLElement, EventListener>();

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
  }

  async load(version: ScoreVersion, zoom: number): Promise<void> {
    this.version = version;
    this.zoom = zoom;
    const toolkit = await this.ensureToolkit();
    toolkit.resetOptions();
    toolkit.setOptions({ ...DEFAULT_OPTIONS, scale: Math.max(20, Math.round(zoom * 100)) });
    toolkit.loadData(version.sourceXml);
    toolkit.redoLayout({});
    this.renderToolkit(toolkit);
  }

  highlight(measureId: StableMeasureId): void {
    this.selectedMeasureId = measureId;
    this.syncHighlight();
  }

  async scrollTo(measureId: StableMeasureId): Promise<void> {
    const element = this.container ? findRenderedMeasureElement(this.container, measureId) : null;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async setZoom(zoom: number): Promise<void> {
    if (!this.version) {
      this.zoom = zoom;
      return;
    }

    this.zoom = zoom;
    const toolkit = await this.ensureToolkit();
    toolkit.resetOptions();
    toolkit.setOptions({ ...DEFAULT_OPTIONS, scale: Math.max(20, Math.round(zoom * 100)) });
    toolkit.redoLayout({});
    this.renderToolkit(toolkit);
  }

  getMeasureLinks(): RenderedMeasureLink[] {
    return [...this.measureLinks];
  }

  onMeasureSelect(listener: (measureId: StableMeasureId) => void): () => void {
    this.measureSelectListener = listener;
    return () => {
      if (this.measureSelectListener === listener) {
        this.measureSelectListener = null;
      }
    };
  }

  destroy(): void {
    this.clearClickHandlers();
    this.container = null;
    this.toolkit = null;
    this.version = null;
    this.measureLinks = [];
    this.selectedMeasureId = null;
  }

  private async ensureToolkit(): Promise<VerovioToolkit> {
    if (this.toolkit) {
      return this.toolkit;
    }

    if (!this.toolkitPromise) {
      this.toolkitPromise = createVerovioModule().then((module) => {
        this.toolkit = new VerovioToolkit(module);
        return this.toolkit;
      });
    }

    return this.toolkitPromise;
  }

  private renderToolkit(toolkit: VerovioToolkit): void {
    if (!this.container || !this.version) {
      return;
    }

    this.clearClickHandlers();

    const pageCount = Math.max(1, toolkit.getPageCount());
    const pages: string[] = [];
    const measureLinks: RenderedMeasureLink[] = [];

    this.version.parts.forEach((part, partIndex) => {
      part.measures.forEach((measure) => {
        const pageNumber = Math.max(1, toolkit.getPageWithElement(measure.sourceXmlId));
        measureLinks.push({
          measureId: measure.id,
          sourceXmlId: measure.sourceXmlId,
          pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1
        });
      });
    });

    for (let page = 1; page <= pageCount; page += 1) {
      pages.push(`
        <section class="score-page" data-page-number="${page}">
          <div class="score-page__label">Page ${page}</div>
          ${toolkit.renderToSVG(page)}
        </section>
      `);
    }

    this.container.innerHTML = pages.join('');
    this.measureLinks = measureLinks;
    this.decorateRenderedMeasures();
    this.syncHighlight();
  }

  private decorateRenderedMeasures(): void {
    if (!this.container || !this.version) {
      return;
    }

    const measures = this.version.parts.flatMap((part) => part.measures);
    const measureById = new Map(measures.map((measure) => [measure.id, measure]));
    const sourceOrder = new Map(measures.map((measure, index) => [measure.id, index]));
    const linksByPage = new Map<number, typeof measures>();

    this.measureLinks.forEach((link) => {
      const measure = measureById.get(link.measureId);
      if (!measure) {
        return;
      }

      const existing = linksByPage.get(link.pageNumber) ?? [];
      existing.push(measure);
      linksByPage.set(link.pageNumber, existing);
    });

    linksByPage.forEach((pageMeasures) => {
      pageMeasures.sort((left, right) => (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0));
    });

    const pageSections = Array.from(this.container.querySelectorAll<HTMLElement>('.score-page'));
    pageSections.forEach((pageSection) => {
      const pageNumber = Number.parseInt(pageSection.dataset.pageNumber ?? '1', 10) || 1;
      const pageMeasures = linksByPage.get(pageNumber) ?? [];
      const renderedMeasures = Array.from(pageSection.querySelectorAll<SVGGElement>('svg g.measure:not(.bounding-box)'));
      const assignmentCount = Math.min(pageMeasures.length, renderedMeasures.length);

      for (let index = 0; index < assignmentCount; index += 1) {
        this.decorateRenderedMeasureElement(renderedMeasures[index], pageMeasures[index]);
      }
    });
  }

  private decorateRenderedMeasureElement(element: SVGGElement, measure: ScoreVersion['parts'][number]['measures'][number]): void {
    element.dataset.measureId = measure.id;
    element.dataset.measureSourceXmlId = measure.sourceXmlId;
    element.style.cursor = 'pointer';

    const handler = () => this.measureSelectListener?.(measure.id);
    element.addEventListener('click', handler);
    this.clickHandlers.set(element, handler);
  }

  private syncHighlight(): void {
    if (!this.container) {
      return;
    }

    setRenderedMeasureHighlight(this.container, this.selectedMeasureId);
  }

  private clearClickHandlers(): void {
    for (const [element, handler] of this.clickHandlers.entries()) {
      element.removeEventListener('click', handler);
    }
    this.clickHandlers.clear();
  }
}
