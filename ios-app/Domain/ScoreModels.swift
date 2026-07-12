import Foundation

struct ScorePageImage: Identifiable, Equatable, Sendable {
    let id: UUID
    var data: Data
    var contentType: String
}

struct RecognitionResult: Equatable, Sendable {
    var scoreVersion: ScoreVersion
    var warnings: [RecognitionWarning]
}

struct RecognitionWarning: Codable, Hashable, Sendable {
    var code: String
    var message: String
}

struct ScoreDocument: Identifiable, Codable, Hashable, Sendable {
    let id: ScoreID
    var title: String
    var currentVersionID: ScoreVersionID?
}

struct ScoreSummary: Identifiable, Codable, Hashable, Sendable {
    let id: ScoreID
    var title: String
    var updatedAt: Date
}

struct ScoreVersion: Identifiable, Codable, Hashable, Sendable {
    let id: ScoreVersionID
    var scoreID: ScoreID
    var name: String
    var document: ScoreDocumentPayload
}

struct ScoreDocumentPayload: Codable, Hashable, Sendable {
    var schemaVersion: Int
}

enum SessionEventType: String, Codable, Sendable {
    case stateSnapshot
    case error
}

struct SessionEvent: Identifiable, Codable, Hashable, Sendable {
    let id: UUID
    var sessionID: SessionID
    var sequence: Int64
    var type: SessionEventType
}

enum SessionCommandType: String, Codable, Sendable {
    case requestState
}

struct SessionCommand: Codable, Hashable, Sendable {
    var type: SessionCommandType
}
