import SwiftUI

struct SignInView: View {
    @EnvironmentObject var app: AppState
    @State private var email = ""
    @State private var code = ""
    @State private var step = 0
    @State private var error: String?
    @State private var info: String?
    @State private var loading = false
    @State private var cooldown = 0
    @State private var shake: CGFloat = 0
    @State private var entered = false
    @FocusState private var focus: Field?
    enum Field { case email, code }
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            P.bg.ignoresSafeArea()
            // decorative only: an overlay on a clear, parent-sized layer so its oversized frames never affect the layout width
            Color.clear.overlay(alignment: .topTrailing) {
                ZStack {
                    Circle().fill(RadialGradient(colors: [P.sun.opacity(0.2), .clear], center: .center, startRadius: 0, endRadius: 210)).frame(width: 420, height: 420).offset(x: 110, y: -40)
                }
            }
            .clipped().allowsHitTesting(false).ignoresSafeArea()
            GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        Logo()
                        Spacer()
                        Text("Learn\nBuild\nBelong").font(Fonts.body(11, 400, style: .caption2)).foregroundStyle(P.muted).multilineTextAlignment(.leading)
                    }
                    .padding(.top, 20)
                    .opacity(entered ? 1 : 0)

                    Spacer(minLength: 64)
                    VStack(alignment: .leading, spacing: 16) {
                        (Text("QISKIT\n").foregroundColor(P.ink) + Text("FALL FEST").foregroundColor(P.primary)).font(T.hero).tracking(0.5).lineSpacing(-28)
                    }
                    .opacity(entered ? 1 : 0).offset(y: entered ? 0 : 30)

                    Color.clear.frame(maxWidth: .infinity, minHeight: 210, maxHeight: .infinity)
                        .overlay(alignment: .trailing) {
                            // runs off the screen edge; ions visibly orbiting
                            AtomOrb(color: P.ink, electron: P.accent, lineWidth: 1.4, period: 8).frame(width: 290, height: 290).offset(x: 112).allowsHitTesting(false)
                        }
                        .overlay(alignment: .topLeading) { Sparkle(size: 22).padding(.top, 14).padding(.leading, 6) }
                    form
                        .offset(x: shake)
                        .opacity(entered ? 1 : 0).offset(y: entered ? 0 : 30)
                    PartnerLine()
                }
                .padding(.horizontal, 28).padding(.bottom, 16)
                .frame(minHeight: geo.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
            }
        }
        .onAppear { withAnimation(.easeOut(duration: 0.8)) { entered = true } }
        .onReceive(tick) { _ in if cooldown > 0 { cooldown -= 1 } }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if step == 0 {
                HStack(spacing: 12) {
                    Image(systemName: "envelope").foregroundStyle(focus == .email ? P.ink : P.muted)
                    ZStack(alignment: .leading) {
                        if email.isEmpty { Text("you@example.com").font(T.body).foregroundStyle(P.muted.opacity(0.8)) }
                        TextField("", text: $email).font(T.body).foregroundStyle(P.ink)
                        .keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .submitLabel(.send).focused($focus, equals: .email).onSubmit(sendCode)
                        .onChange(of: email) { _ in error = nil }
                    }
                }
                .padding(.horizontal, 18).frame(height: 60)
                .background(P.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(focus == .email ? P.primary : P.line, lineWidth: focus == .email ? 1.6 : 1))
                Text("Use the email you registered with. We’ll send a 6-digit code — no password needed.")
                    .font(T.small).foregroundStyle(P.muted).padding(.horizontal, 6)
            } else {
                Text("Enter your code").font(T.h2).foregroundStyle(P.ink)
                Text(info ?? "We sent a code to \(email)").font(T.small).foregroundStyle(P.muted)
                CodeBoxes(code: $code, focus: $focus) { if $0.count == 6 { verify($0) } }
            }
            if let error {
                Label(error, systemImage: "exclamationmark.circle").font(T.small).foregroundStyle(P.danger).padding(.horizontal, 6)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            PrimaryButton(title: step == 0 ? "SEND CODE" : "VERIFY", systemImage: "arrow.right", loading: loading) {
                if step == 0 { sendCode() } else if code.count == 6 { verify(code) } else { fail("Enter the 6-digit code") }
            }
            .padding(.top, 4)
            if step == 1 {
                HStack(spacing: 16) {
                    Button("Change email") { step = 0; error = nil; code = "" }.foregroundStyle(P.muted)
                    Button(cooldown > 0 ? "Resend in \(cooldown)s" : "Resend code") { if cooldown == 0 { sendCode() } }
                        .foregroundStyle(cooldown > 0 ? P.muted.opacity(0.5) : P.ink).disabled(cooldown > 0)
                }
                .font(T.small).frame(maxWidth: .infinity).padding(.top, 4)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: step)
        .animation(.easeInOut(duration: 0.2), value: error)
    }

    private func fail(_ msg: String) {
        error = msg; Haptics.error()
        withAnimation(.default.speed(4).repeatCount(4, autoreverses: true)) { shake = 12 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { withAnimation(.default) { shake = 0 } }
    }

    private func sendCode() {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@"), e.contains("."), e.count >= 5 else { return fail("Enter the email you registered with") }
        focus = nil; loading = true; error = nil
        Task {
            do { info = try await app.requestCode(email: e); step = 1; code = ""; cooldown = 30; focus = .code }
            catch let x as APIError { fail(x.message) }
            catch { fail("Can't reach the server. Check your connection.") }
            loading = false
        }
    }

    private func verify(_ c: String) {
        guard !loading else { return }
        loading = true; error = nil
        Task {
            do { try await app.verify(email: email, code: c) }
            catch let x as APIError { code = ""; fail(x.message) }
            catch { code = ""; fail("Can't reach the server. Check your connection.") }
            loading = false
        }
    }
}

/// Six boxes backed by one hidden text field, so iOS can offer the emailed code above the keyboard (`.oneTimeCode`).
struct CodeBoxes: View {
    @Binding var code: String
    var focus: FocusState<SignInView.Field?>.Binding
    let onChange: (String) -> Void

    var body: some View {
        ZStack {
            TextField("", text: Binding(get: { code }, set: { v in
                let d = String(v.filter(\.isNumber).prefix(6)); code = d; onChange(d)
            }))
            .keyboardType(.numberPad).textContentType(.oneTimeCode).focused(focus, equals: .code)
            .foregroundStyle(.clear).tint(.clear).opacity(0.02).accessibilityLabel("6-digit code")
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { i in
                    let active = i == code.count
                    Text(i < code.count ? String(Array(code)[i]) : "")
                        .font(T.h1).foregroundStyle(P.ink)
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .background(P.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(active ? P.primary : P.line, lineWidth: active ? 1.8 : 1))
                }
            }
            .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .onTapGesture { focus.wrappedValue = .code }
    }
}
