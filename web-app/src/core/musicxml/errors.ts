export type MusicXmlParseErrorCode =
  | 'INVALID_XML'
  | 'UNSUPPORTED_STRUCTURE'
  | 'MISSING_PART'
  | 'MISSING_MEASURE';

export class MusicXmlParseError extends Error {
  readonly code: MusicXmlParseErrorCode;

  constructor(code: MusicXmlParseErrorCode, message: string) {
    super(message);
    this.name = 'MusicXmlParseError';
    this.code = code;
  }
}
