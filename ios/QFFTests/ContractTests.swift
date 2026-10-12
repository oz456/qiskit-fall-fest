import XCTest
@testable import QFF

/// Decodes REAL payloads captured from the backend (Fixtures/) and checks the pass QR against the server's own output,
/// so an API/crypto mismatch fails CI instead of failing at the gate.
final class ContractTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), "missing fixture \(name)")
        return try Data(contentsOf: url)
    }
    private func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder.api.decode(T.self, from: fixture(name))
    }

    func testEventsDecode() throws {
        let r = try decode(EventsResponse.self, "events")
        XCTAssertGreaterThanOrEqual(r.events.count, 2)
        let e = try XCTUnwrap(r.events.first { $0.track == .Hackathon })
        XCTAssertTrue(e.registered)
        XCTAssertTrue(e.saved)
        XCTAssertEqual(e.capacity, 50)
        XCTAssertEqual(e.spotsLeft, 49)
        XCTAssertTrue(e.registrationRequired)
        // 28 Oct 18:00 IST → 29 Oct 18:00 IST is a two-day event
        XCTAssertTrue(e.isMultiDay)
        XCTAssertEqual(e.durationDays, 2)
        XCTAssertEqual(Fmt.time.string(from: e.startsAt), "6:00 PM")
        XCTAssertEqual(istCalendar.component(.day, from: e.startsAt), 28)
        XCTAssertEqual(r.settings["venue"], "SRM University AP, Amaravati")
        XCTAssertEqual(r.settings["fest_start"], "2026-10-26")
        XCTAssertFalse(r.faqs.isEmpty)
    }

    func testSingleDayEventIsNotMultiDay() throws {
        let r = try decode(EventsResponse.self, "events")
        let e = try XCTUnwrap(r.events.first { $0.title.contains("Winner") })
        XCTAssertFalse(e.isMultiDay)
        XCTAssertEqual(e.durationDays, 1)
        XCTAssertEqual(e.timeLabel(on: e.startsAt), "11:00 AM")
    }

    func testAnnouncementsDecode() throws {
        let a = try decode([Announcement].self, "announcements")
        XCTAssertEqual(a.first?.title, "Doors open at 9:00 AM")
    }

    func testTicketsDecode() throws {
        let t = try decode([Ticket].self, "tickets")
        XCTAssertEqual(t.first?.messages.count, 2)
        XCTAssertEqual(t.first?.messages.last?.fromAdmin, true)
        XCTAssertEqual(t.first?.status, "in_progress")
    }

    func testAuthPayloadsDecode() throws {
        let v = try decode(VerifyResponse.self, "verify")
        XCTAssertTrue(v.profile.passCode.hasPrefix("QFF-"))
        XCTAssertEqual(Data(base64Encoded: v.passSecret)?.count, 32)
        XCTAssertEqual(v.profile.initials, "AM")
        _ = try decode(RefreshResponse.self, "refresh")
        _ = try decode(TicketCreated.self, "ticket-created")
        XCTAssertNotNil(try decode(MessageResponse.self, "request-code").message)
        let me = try decode(MeResponse.self, "me")
        XCTAssertEqual(me.profile.email, "alex.morgan@srmap.edu.in")
    }

    /// The iPhone must produce byte-identical QR payloads to the server's verifier (and the Android app).
    func testPassPayloadMatchesServer() throws {
        struct Vector: Decodable { let passCode: String; let secretHex: String; let serverNow: Double; let payload: String }
        let v = try JSONDecoder().decode(Vector.self, from: fixture("pass-vector"))
        var secret = Data()
        var i = v.secretHex.startIndex
        while i < v.secretHex.endIndex { let j = v.secretHex.index(i, offsetBy: 2); secret.append(UInt8(v.secretHex[i..<j], radix: 16)!); i = j }
        XCTAssertEqual(PassCode.payload(passCode: v.passCode, secret: secret, serverNow: v.serverNow), v.payload)
    }

    func testQRMatrixIsSquareAndNonTrivial() throws {
        let m = try XCTUnwrap(QRMatrix.make("QFF1.QFF-4092.59727880.Bn5iaEXc9uiU"))
        XCTAssertGreaterThanOrEqual(m.count, 21)
        XCTAssertTrue(m.allSatisfy { $0.count == m.count })
        XCTAssertTrue(m[0][0] && m[0][6] && m[6][0], "finder pattern corner modules should be dark")
    }

    func testProgressStaysInRange() {
        for t in stride(from: 0.0, to: 120.0, by: 7.3) {
            let p = PassCode.progress(serverNow: t)
            XCTAssertTrue(p > 0 && p <= 1)
        }
    }
}
