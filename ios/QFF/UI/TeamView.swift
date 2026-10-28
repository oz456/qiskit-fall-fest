import SwiftUI

/// "Your team" for hackathon participants: the lead on top, then teammates. The lead can rename the team unless organisers have switched that off.
struct TeamView: View {
    var onOpenEvent: (() -> Void)?
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var renaming = false
    @State private var name = ""
    @State private var error: String?
    @State private var saving = false

    private func initials(_ n: String) -> String {
        let s = n.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return s.isEmpty ? "?" : s
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let team = app.team {
                    if renaming { renameForm(team) } else { roster(team) }
                } else {
                    Text("Your team").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink)
                    Text(app.teamLoaded ? "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." : "We couldn’t load your team right now. Check your connection and try again.")
                        .font(T.body).foregroundStyle(P.muted)
                    if let onOpenEvent { PrimaryButton(title: "VIEW THE HACKATHON") { dismiss(); onOpenEvent() } }
                }
            }
            .padding(24).frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Backdrop())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await app.loadTeam() }
    }

    @ViewBuilder private func roster(_ team: TeamInfo) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(team.name).font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink).lineLimit(2)
            Spacer(minLength: 0)
            if app.canRenameTeam { Button("Rename") { name = team.name; error = nil; renaming = true }.font(T.bodyM).foregroundStyle(P.primary) }
        }
        Text(([team.problemStatementId] .compactMap { $0 } + ["\(team.members.count) \(team.members.count == 1 ? "member" : "members")"]).joined(separator: " · "))
            .font(T.body).foregroundStyle(P.muted)
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
        if team.isLeader && !app.canRenameTeam { Text("Team names can’t be changed any more.").font(T.small).foregroundStyle(P.muted) }
        if let onOpenEvent { Button("View the Hackathon") { dismiss(); onOpenEvent() }.font(T.bodyM).foregroundStyle(P.primary).frame(maxWidth: .infinity).padding(.top, 6) }
    }

    @ViewBuilder private func renameForm(_ team: TeamInfo) -> some View {
        Text("Rename your team").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink)
        Text("Everyone in the team, and the organisers, will see the new name.").font(T.body).foregroundStyle(P.muted)
        TextField("Team name", text: $name).font(T.body).foregroundStyle(P.ink).padding(.horizontal, 16).frame(height: 52)
            .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
            .onChange(of: name) { v in error = nil; if v.count > 40 { name = String(v.prefix(40)) } }
            .submitLabel(.done).onSubmit { save(team) }
        if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
        PrimaryButton(title: "SAVE NAME", loading: saving) { save(team) }
        Button("Cancel") { renaming = false; error = nil }.font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity).disabled(saving)
    }

    private func save(_ team: TeamInfo) {
        let n = name.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if n.count < 3 || n.count > 40 { error = "A team name must be 3 to 40 characters."; return }
        if n == team.name { renaming = false; return }
        saving = true; error = nil
        Task {
            do { try await app.renameTeam(n); renaming = false }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
