import Foundation

protocol MusicXMLService {
    func parse(data: Data) throws -> ScoreVersion
    func export(version: ScoreVersion) throws -> Data
}
