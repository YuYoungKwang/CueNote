declare module 'verovio/wasm' {
  export default function createVerovioModule(): Promise<unknown>;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    loadData(data: string): boolean;
    getPageCount(): number;
    getPageWithElement(xmlId: string): number;
    redoLayout(options?: Record<string, unknown>): void;
    renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
    resetOptions(): void;
    setOptions(options: Record<string, unknown>): void;
  }
}
