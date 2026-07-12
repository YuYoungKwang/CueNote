import XCTest
@testable import CueNote

final class ServiceProtocolCompileTests: XCTestCase {
    func testRationalStoresExactValues() {
        let value = Rational(numerator: 3, denominator: 4)

        XCTAssertEqual(value.numerator, 3)
        XCTAssertEqual(value.denominator, 4)
    }
}
