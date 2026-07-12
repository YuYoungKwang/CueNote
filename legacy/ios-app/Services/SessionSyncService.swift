protocol SessionSyncService {
    var events: AsyncStream<SessionEvent> { get }

    func connect(sessionID: SessionID, token: String) async throws
    func send(_ command: SessionCommand) async throws
    func disconnect() async
}
