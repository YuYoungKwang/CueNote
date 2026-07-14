export type OmrSampleCaptureType = 'synthetic' | 'scan' | 'photo';

export interface OmrSampleFixture {
  id: string;
  title: string;
  source: string;
  licenseUsageNote: string;
  expectedNotationType: string;
  hasLyrics: boolean;
  hasChordSymbols: boolean;
  captureType: OmrSampleCaptureType;
  imageDataUrl?: string;
  localFileProcedure?: string;
}

export const OMR_SAMPLE_FIXTURES: OmrSampleFixture[] = [
  {
    id: 'synthetic-basic-staff',
    title: 'Synthetic staff and symbols',
    source: 'CueNote generated fixture',
    licenseUsageNote: 'Code-generated CC0-style test fixture for local evaluation only.',
    expectedNotationType: 'single-staff melody symbols',
    hasLyrics: false,
    hasChordSymbols: false,
    captureType: 'synthetic',
    imageDataUrl: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420">
        <rect width="960" height="420" fill="white"/>
        <g stroke="#111827" stroke-width="4">
          <line x1="80" y1="130" x2="880" y2="130"/>
          <line x1="80" y1="154" x2="880" y2="154"/>
          <line x1="80" y1="178" x2="880" y2="178"/>
          <line x1="80" y1="202" x2="880" y2="202"/>
          <line x1="80" y1="226" x2="880" y2="226"/>
          <line x1="80" y1="130" x2="80" y2="226"/>
          <line x1="310" y1="130" x2="310" y2="226"/>
          <line x1="560" y1="130" x2="560" y2="226"/>
          <line x1="880" y1="130" x2="880" y2="226"/>
        </g>
        <g fill="#111827" stroke="#111827" stroke-width="4">
          <ellipse cx="210" cy="190" rx="18" ry="12" transform="rotate(-18 210 190)"/>
          <line x1="226" y1="188" x2="226" y2="98"/>
          <ellipse cx="405" cy="166" rx="18" ry="12" transform="rotate(-18 405 166)"/>
          <line x1="421" y1="164" x2="421" y2="82"/>
          <ellipse cx="650" cy="202" rx="18" ry="12" transform="rotate(-18 650 202)"/>
          <line x1="666" y1="200" x2="666" y2="110"/>
          <path d="M226 98 C285 80 360 78 421 82" fill="none"/>
        </g>
        <text x="100" y="294" font-family="Arial, sans-serif" font-size="28" fill="#111827">Synthetic OMR evaluation fixture</text>
      </svg>
    `)
  },
  {
    id: 'korean-lyrics-chords-local',
    title: 'Korean lyrics and chord chart slot',
    source: 'User-provided local file',
    licenseUsageNote: 'No image is committed. Use only a file you own, created yourself, or are licensed to evaluate locally.',
    expectedNotationType: 'melody with Korean lyrics and chord symbols',
    hasLyrics: true,
    hasChordSymbols: true,
    captureType: 'scan',
    localFileProcedure: 'Select this slot, then choose a local PNG/JPEG/BMP made from your own or licensed score. The file stays in browser memory/IndexedDB for local evaluation.'
  }
];

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}
