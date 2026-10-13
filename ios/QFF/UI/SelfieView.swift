import AVFoundation
import SwiftUI
import UIKit

/// First sign-in only: one selfie so door staff can match the face to the pass.
struct SelfieView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var camera = CameraModel()
    @State private var photo: UIImage?
    @State private var jpeg: Data?
    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "ONE-TIME SETUP")
                Text("Take a quick selfie").font(Fonts.display(30, 700, style: .title1)).foregroundStyle(P.ink)
                Text("Door volunteers match your face to your pass. It’s saved once and only event staff can see it.")
                    .font(T.body).foregroundStyle(P.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 16)

            frame
            Spacer(minLength: 16)

            if let error { Text(error).font(T.small).foregroundStyle(P.danger).multilineTextAlignment(.center).padding(.bottom, 10) }
            controls
            Button("Not now") { app.skippedSelfie = true }
                .font(T.small).foregroundStyle(P.muted).padding(.top, 14).padding(.bottom, 4)
        }
        .padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Backdrop())
        .task { if !app.isPreview { await camera.start() } }
        .onDisappear { camera.stop() }
        .onAppear {
            camera.onCapture = { img in
                if let out = SelfieView.portrait(img) { photo = out.0; jpeg = out.1; error = nil } else { error = "That didn’t work. Try again." }
            }
        }
    }

    private var frame: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 36, style: .continuous).fill(P.surfaceAlt)
            if let photo {
                Image(uiImage: photo).resizable().scaledToFill()
            } else if app.isPreview {
                LinearGradient(colors: [Color(hex: 0x7B5FE0), P.hero2], startPoint: .top, endPoint: .bottom)
                Image(systemName: "person.fill").font(.system(size: 120)).foregroundStyle(.white.opacity(0.35))
                guide
            } else if camera.status == .authorized && camera.hasCamera {
                CameraPreview(session: camera.session)
                guide
            } else {
                VStack(spacing: 12) {
                    IconBubble(symbol: "camera", size: 56, tint: P.mintInk, bg: P.mint)
                    Text(camera.hasCamera ? "Camera access needed" : "No camera found").font(T.title).foregroundStyle(P.ink)
                    Text(camera.hasCamera ? "Allow the camera to take your selfie." : "This device can’t take a selfie.").font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center)
                }
                .padding(28)
            }
        }
        .aspectRatio(3.0 / 4.0, contentMode: .fit)
        .frame(maxWidth: 330)
        .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).stroke(P.line))
    }

    private var guide: some View {
        Capsule().stroke(.white.opacity(0.7), lineWidth: 2).aspectRatio(0.78, contentMode: .fit).padding(.horizontal, 54)
    }

    @ViewBuilder private var controls: some View {
        if photo != nil {
            HStack(spacing: 12) {
                Button { photo = nil; jpeg = nil; error = nil; Haptics.tap() } label: {
                    Text("RETAKE").font(T.button).tracking(1).foregroundStyle(P.ink)
                        .frame(maxWidth: .infinity, minHeight: 58).background(P.surfaceAlt, in: Capsule())
                }
                .buttonStyle(PressStyle())
                PrimaryButton(title: "USE PHOTO", loading: uploading) { upload() }.frame(maxWidth: .infinity)
            }
        } else if camera.status == .authorized || app.isPreview {
            Button { Haptics.tap(); camera.capture() } label: {
                Circle().fill(P.primary).frame(width: 64, height: 64)
                    .padding(7).overlay(Circle().stroke(P.primary, lineWidth: 4))
            }
            .buttonStyle(PressStyle()).accessibilityLabel("Take selfie")
        } else if camera.status == .notDetermined {
            PrimaryButton(title: "ALLOW CAMERA") { Task { await camera.start() } }
        } else {
            PrimaryButton(title: "OPEN SETTINGS") { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
        }
    }

    private func upload() {
        guard let jpeg, !uploading else { return }
        uploading = true; error = nil
        Task { [self] in
            do { try await app.uploadSelfie(jpeg); Haptics.success() }
            catch let e as APIError { error = e.message; Haptics.error() }
            catch { self.error = "Couldn’t upload. Check your connection and try again."; Haptics.error() }
            uploading = false
        }
    }

    /// Upright, mirrored like the preview the person approved, cropped to 3:4 and shrunk to 720×960 JPEG (well under the 400 KB server limit).
    static func portrait(_ img: UIImage) -> (UIImage, Data)? {
        let w: CGFloat = 720, h: CGFloat = 960
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let out = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: fmt).image { ctx in
            ctx.cgContext.translateBy(x: w, y: 0); ctx.cgContext.scaleBy(x: -1, y: 1)
            let s = max(w / img.size.width, h / img.size.height)
            let dw = img.size.width * s, dh = img.size.height * s
            img.draw(in: CGRect(x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh))
        }
        guard let data = out.jpegData(compressionQuality: 0.85) else { return nil }
        return (out, data)
    }
}

final class CameraModel: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    @Published var status: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @Published var hasCamera = true
    var onCapture: ((UIImage) -> Void)?
    private let output = AVCapturePhotoOutput()
    private let queue = DispatchQueue(label: "qff.camera")
    private var configured = false

    func start() async {
        if status == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
            await MainActor.run { status = AVCaptureDevice.authorizationStatus(for: .video) }
        }
        guard status == .authorized else { return }
        queue.async { [self] in
            if !configured { configure() }
            if configured, !session.isRunning { session.startRunning() }
        }
    }

    private func configure() {
        session.beginConfiguration()
        session.sessionPreset = .photo
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) ?? AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: dev), session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            DispatchQueue.main.async { self.hasCamera = false }
            return
        }
        session.addInput(input); session.addOutput(output)
        session.commitConfiguration()
        configured = true
    }

    func capture() { queue.async { [self] in output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self) } }
    func stop() { queue.async { [self] in if session.isRunning { session.stopRunning() } } }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let d = photo.fileDataRepresentation(), let img = UIImage(data: d) else { return }
        DispatchQueue.main.async { self.onCapture?(img) }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewUIView {
        let v = PreviewUIView(); v.previewLayer.session = session; v.previewLayer.videoGravity = .resizeAspectFill; return v
    }
    func updateUIView(_ uiView: PreviewUIView, context: Context) {}
}

final class PreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
