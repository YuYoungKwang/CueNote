protocol ScoreRepository {
    func save(_ score: ScoreDocument) async throws
    func load(id: ScoreID) async throws -> ScoreDocument?
    func list() async throws -> [ScoreSummary]
}
