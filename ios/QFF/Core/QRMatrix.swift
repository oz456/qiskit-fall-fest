import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// Module matrix of a QR code (true = dark), so the UI can draw rounded modules in the brand style.
enum QRMatrix {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])
    private static var cached: (text: String, matrix: [[Bool]])?

    static func make(_ text: String) -> [[Bool]]? {
        if let c = cached, c.text == text { return c.matrix }   // the pass redraws often; only re-encode when the payload changes
        guard let m = build(text) else { return nil }
        cached = (text, m)
        return m
    }

    private static func build(_ text: String) -> [[Bool]]? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let img = f.outputImage else { return nil }
        let w = Int(img.extent.width), h = Int(img.extent.height)
        guard w > 0, w == h else { return nil }
        guard let cg = context.createCGImage(img, from: img.extent) else { return nil }
        var px = [UInt8](repeating: 0, count: w * h)
        let space = CGColorSpaceCreateDeviceGray()
        guard let bm = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: space, bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        bm.interpolationQuality = .none
        bm.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return (0..<h).map { y in (0..<w).map { x in px[y * w + x] < 128 } }
    }
}
