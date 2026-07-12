import { describe, expect, it } from 'vitest';
import { findRenderedMeasureElement, setRenderedMeasureHighlight } from './measureDom';

describe('measureDom', () => {
  it('finds and highlights rendered measures by stable id', () => {
    document.body.innerHTML = `
      <div>
        <svg>
          <g data-measure-id="score-a:p1:m1:xml-a"></g>
          <g data-measure-id="score-a:p1:m2:xml-b"></g>
        </svg>
      </div>
    `;

    const container = document.body;
    const first = findRenderedMeasureElement(container, 'score-a:p1:m1:xml-a');
    const second = findRenderedMeasureElement(container, 'score-a:p1:m2:xml-b');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    setRenderedMeasureHighlight(container, 'score-a:p1:m2:xml-b');

    expect(first?.classList.contains('is-selected')).toBe(false);
    expect(second?.classList.contains('is-selected')).toBe(true);
  });
});
