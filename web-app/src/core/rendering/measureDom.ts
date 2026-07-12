import type { StableMeasureId } from '@cuenote/score-domain';

export function findRenderedMeasureElement(container: ParentNode, measureId: StableMeasureId): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-measure-id="${cssEscape(measureId)}"]`);
}

export function findRenderedMeasureCandidates(container: ParentNode, sourceXmlId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-id="${cssEscape(sourceXmlId)}"], [id="${cssEscape(sourceXmlId)}"]`));
}

export function setRenderedMeasureHighlight(container: ParentNode, selectedMeasureId: StableMeasureId | null): void {
  container.querySelectorAll<HTMLElement>('[data-measure-id]').forEach((element) => {
    element.classList.toggle('is-selected', selectedMeasureId !== null && element.dataset.measureId === selectedMeasureId);
  });
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
