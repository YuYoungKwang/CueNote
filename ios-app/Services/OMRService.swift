protocol OMRService {
    func recognize(pages: [ScorePageImage]) async throws -> RecognitionResult
}
