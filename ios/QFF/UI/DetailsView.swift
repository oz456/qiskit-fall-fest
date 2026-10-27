import SwiftUI

/// First sign-in of an SRM-AP person: academic details, asked once.
struct DetailsView: View {
    var extra = false   // saved earlier: only section and gender are missing
    @EnvironmentObject var app: AppState
    @State private var regNo = ""
    @State private var school = ""
    @State private var semester = ""
    @State private var program = ""
    @State private var course = ""
    @State private var section = ""
    @State private var gender = ""
    @State private var cgpa = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(text: "ONE-TIME SETUP")
                Text(extra ? "Two more details" : "Tell us about yourself").font(Fonts.display(30, 700, style: .title1)).foregroundStyle(P.ink)
                Text(extra ? "We forgot to ask for these. Your other details are already saved." : "We only ask this once. It helps the organisers with attendance and certificates.").font(T.body).foregroundStyle(P.muted)
                Spacer().frame(height: 4)
                if !extra {
                    field("Registration number") {
                        TextField("AP25110010123", text: $regNo).textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .onChange(of: regNo) { v in regNo = String(v.uppercased().prefix(15)); error = nil }
                    }
                    picker("School", $school, app.detailsOptions.schools, "Choose your school")
                    HStack(spacing: 12) {
                        picker("Semester", $semester, (1...8).map(String.init), "Semester")
                        picker("Program", $program, app.detailsOptions.programs, "Program")
                    }
                    field("Course") { TextField("e.g. CSE, ECE, Data Science", text: $course).onChange(of: course) { v in course = String(v.prefix(60)); error = nil } }
                }
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Section").font(T.small).foregroundStyle(P.muted)
                        TextField("e.g. A or S12", text: $section).textInputAutocapitalization(.characters).autocorrectionDisabled().font(T.body).foregroundStyle(P.ink)
                            .onChange(of: section) { v in section = String(v.uppercased().prefix(12)); error = nil }
                            .padding(.horizontal, 16).frame(height: 52)
                            .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
                    }
                    picker("Gender", $gender, app.detailsOptions.genders ?? ["Male", "Female"], "Gender")
                }
                if !extra {
                    field("CGPA") { TextField("e.g. 8.45, or NA", text: $cgpa).textInputAutocapitalization(.characters).autocorrectionDisabled().onChange(of: cgpa) { v in cgpa = String(v.prefix(5)); error = nil } }
                    Text("First semester? You don’t have a CGPA yet. Enter NA (or 0).").font(T.small).foregroundStyle(P.muted)
                }
                if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
                PrimaryButton(title: "CONTINUE", loading: saving) { save() }.frame(maxWidth: .infinity)
                Button("Not you? Sign out") { app.signOut() }.font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity).padding(.top, 6)
            }
            .padding(.horizontal, 28).padding(.vertical, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Backdrop())
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(T.small).foregroundStyle(P.muted)
            content().font(T.body).foregroundStyle(P.ink).padding(.horizontal, 16).frame(height: 52)
                .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
        }
    }

    private func picker(_ label: String, _ value: Binding<String>, _ options: [String], _ placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(T.small).foregroundStyle(P.muted)
            Menu {
                ForEach(options, id: \.self) { o in Button(o) { value.wrappedValue = o; error = nil } }
            } label: {
                HStack {
                    Text(value.wrappedValue.isEmpty ? placeholder : value.wrappedValue).font(T.body).foregroundStyle(value.wrappedValue.isEmpty ? P.muted.opacity(0.8) : P.ink)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(P.muted)
                }
                .padding(.horizontal, 16).frame(height: 52)
                .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
            }
        }
    }

    private func save() {
        let raw = cgpa.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let na = raw.uppercased() == "NA" || raw.uppercased() == "N/A"
        let g = na ? nil : Double(raw)
        let sec = section.trimmingCharacters(in: .whitespaces)
        if !extra {
            if regNo.trimmingCharacters(in: .whitespaces).isEmpty { error = "Enter your registration number, like AP25110010123."; return }
            if school.isEmpty { error = "Choose your school."; return }
            if semester.isEmpty { error = "Choose your semester."; return }
            if program.isEmpty { error = "Choose your program."; return }
            if course.trimmingCharacters(in: .whitespaces).count < 2 { error = "Enter your course, like CSE."; return }
        }
        if sec.isEmpty || sec.range(of: "^[A-Za-z0-9][A-Za-z0-9 \\-]{0,11}$", options: .regularExpression) == nil { error = "Enter your section, like A or S12."; return }
        if gender.isEmpty { error = "Choose Male or Female."; return }
        if !extra && !na { guard let g, g >= 0, g <= 10 else { error = "Enter your CGPA as a number from 0 to 10, or NA if you are in the first semester."; return } }
        saving = true; error = nil
        Task {
            do {
                if extra { try await app.saveExtra(section: sec.uppercased(), gender: gender) }
                else { try await app.saveDetails(regNo: regNo.trimmingCharacters(in: .whitespaces), school: school, semester: Int(semester) ?? 1, course: course.trimmingCharacters(in: .whitespaces), program: program, section: sec.uppercased(), gender: gender, cgpa: g) }
            } catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
