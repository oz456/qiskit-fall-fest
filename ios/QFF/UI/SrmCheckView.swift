import SwiftUI

/// Personal-email people whose college says SRM-AP confirm once after the sign-in code: SRM-AP student, or outside student.
/// "Outside" skips every academic and OD question.
struct SrmCheckView: View {
    @EnvironmentObject var app: AppState
    @State private var choice = ""
    @State private var error: String?
    @State private var saving = false

    private func option(_ key: String, _ title: String, _ sub: String) -> some View {
        Button { choice = key; error = nil; Haptics.select() } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(T.title).foregroundStyle(P.ink)
                Text(sub).font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(P.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(choice == key ? P.primary : P.line, lineWidth: choice == key ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SectionLabel(text: "ONE-TIME CHECK")
                Text("Are you an SRM-AP student?").font(T.h1).foregroundStyle(P.ink)
                Text("You signed in with a personal email, so we want to be sure. Choose carefully: this is asked only once.").font(T.body).foregroundStyle(P.muted)
                option("srm", "SRM University-AP student", "You will be asked for your registration number, semester and the other academic details.")
                option("outside", "Outside student", "From another college. No academic details are needed.")
                if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
                PrimaryButton(title: "CONTINUE", loading: saving) { save() }.frame(maxWidth: .infinity)
                Button("Not you? Sign out") { app.signOut() }.font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity).padding(.top, 6)
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Backdrop())
    }

    private func save() {
        if choice.isEmpty { error = "Choose one to continue."; return }
        saving = true; error = nil
        Task {
            do { try await app.saveSrmCheck(choice) }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
