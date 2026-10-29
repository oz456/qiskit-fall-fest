import SwiftUI

/// "Your team" for hackathon participants: the lead on top, then teammates (view only). At the naming time the lead taps "Get my team name".
struct TeamView: View {
    @EnvironmentObject var app: AppState
    @State private var error: String?
    @State private var busy = false
    @State private var renaming = false
    @State private var newName = ""

    private func initials(_ n: String) -> String {
        let s = n.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return s.isEmpty ? "?" : s
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let team = app.team { if renaming { renameForm(team) } else { roster(team) } } else {
                    Text("Your team").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink)
                    Text(app.teamLoaded ? "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." : "We couldn’t load your team right now. Check your connection and try again.")
                        .font(T.body).foregroundStyle(P.muted)
                }
            }
            .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Backdrop())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { // keep the sheet current while the naming time comes and the names go out
            while !Task.isCancelled { await app.loadTeam(); try? await Task.sleep(nanoseconds: 3_000_000_000) }
        }
    }

    @ViewBuilder private func roster(_ team: TeamInfo) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(team.name).font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink).lineLimit(2).blur(radius: team.nameHidden == true ? 9 : 0).animation(.easeOut(duration: 0.6), value: team.nameHidden)
            Spacer(minLength: 0)
            if app.teamNaming?.canEdit == true { Button("Rename") { newName = team.name; error = nil; renaming = true }.font(T.bodyM).foregroundStyle(P.primary) }
        }
        Text(([team.problemStatementId].compactMap { $0 } + ["\(team.members.count) \(team.members.count == 1 ? "member" : "members")"]).joined(separator: " · "))
            .font(T.body).foregroundStyle(P.muted)
        if let note = app.teamNaming?.note { Text(note).font(T.body).foregroundStyle(P.ink) }
        if app.teamNaming?.canAssign == true { PrimaryButton(title: busy ? "GETTING YOUR NAME…" : "GET MY TEAM NAME", loading: busy) { assign() } }
        if app.teamNaming?.canPractice == true { Button("Practice the naming round (test teams only)") { practice() }.font(T.bodyM).foregroundStyle(P.primary).disabled(busy) }
        if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
        if team.founder == nil && app.teamNaming?.note == nil { Text("Team names are inspired by India’s founders.").font(T.small).foregroundStyle(P.muted) }
        ForEach(team.members) { m in
            HStack(spacing: 14) {
                Text(initials(m.name)).font(T.bodyM).foregroundStyle(m.isLeader ? P.onPrimary : P.muted)
                    .frame(width: 44, height: 44).background(m.isLeader ? P.primary : P.surface, in: Circle())
                    .overlay(Circle().stroke(m.isLeader ? P.primary : P.line, lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.name + (m.you ? " (you)" : "")).font(T.title).foregroundStyle(P.ink)
                    Text(m.isLeader ? "Team lead" : "Teammate").font(T.small).foregroundStyle(P.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder private func renameForm(_ team: TeamInfo) -> some View {
        Text("Change your team name").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink)
        Text("Everyone in the team, and the organisers, will see the new name. No other team can have the same name.").font(T.body).foregroundStyle(P.muted)
        TextField("Team name", text: $newName).font(T.body).foregroundStyle(P.ink).padding(.horizontal, 16).frame(height: 52)
            .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
            .onChange(of: newName) { v in error = nil; if v.count > 40 { newName = String(v.prefix(40)) } }
        if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
        PrimaryButton(title: "SAVE NAME", loading: busy) { saveName(team) }
        Button("Cancel") { renaming = false; error = nil }.font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity).disabled(busy)
    }

    private func saveName(_ team: TeamInfo) {
        let n = newName.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if n.count < 3 || n.count > 40 { error = "A team name must be 3 to 40 characters."; return }
        if n == team.name { renaming = false; return }
        busy = true; error = nil
        Task {
            do { try await app.renameTeam(n); renaming = false }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func practice() {
        busy = true; error = nil
        Task {
            do { try await app.practiceTeamNames() }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func assign() {
        busy = true; error = nil
        Task {
            do { try await app.assignTeamName() }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
