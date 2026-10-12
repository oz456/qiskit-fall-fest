import Foundation
import Security

/// Minimal Keychain wrapper for the refresh token and the pass secret (never UserDefaults).
final class Keychain {
    static let shared = Keychain()
    private let service = "org.qiskit.fallfest.amaravati"

    func set(_ value: String?, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly // never synced or backed up to another device
        SecItemAdd(add as CFDictionary, nil)
    }

    func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    func wipe() { for k in ["refresh", "pass_secret"] { set(nil, for: k) } }
}
