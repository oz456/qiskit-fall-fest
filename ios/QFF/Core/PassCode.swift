import CryptoKit
import Foundation

enum PassCode {
    static let stepSeconds: TimeInterval = 30

    /// QFF1.<passCode>.<30s-window>.<12 chars of base64url(HMAC-SHA256(secret, "passCode|window"))> — identical to the server and the Android app.
    static func payload(passCode: String, secret: Data, serverNow: TimeInterval) -> String {
        let step = UInt64(serverNow / stepSeconds)
        let mac = HMAC<SHA256>.authenticationCode(for: Data("\(passCode)|\(step)".utf8), using: SymmetricKey(data: secret))
        let b64 = Data(mac).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return "QFF1.\(passCode).\(step).\(b64.prefix(12))"
    }

    /// 1 → 0 over the current window.
    static func progress(serverNow: TimeInterval) -> Double {
        1 - (serverNow.truncatingRemainder(dividingBy: stepSeconds)) / stepSeconds
    }
}
