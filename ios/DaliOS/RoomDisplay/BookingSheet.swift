import SwiftUI

/// New booking, in two steps: pick the time (a preset length or typed start
/// and end), then confirm by scanning the booker's DALI pass. Opened from the
/// + button or a tap/drag on the timeline, which prefill the time.
struct BookingSheet: View {
    static let presets = [30, 60, 90]

    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var start: Date
    @State private var end: Date
    @State private var confirmed: BookingRequest?

    init(draft: BookingDraft) {
        _start = State(initialValue: draft.interval.start)
        _end = State(initialValue: draft.interval.end)
    }

    var body: some View {
        // No NavigationStack: it has no natural height, and the sheet sizes
        // itself to this content so there's no empty band under Continue.
        VStack(spacing: 20) {
            header
            if let confirmed {
                scan(confirmed)
            } else {
                details
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(OS.bg.ignoresSafeArea())
        .presentationSizing(.form.fitted(horizontal: false, vertical: true))
    }

    private var header: some View {
        ZStack {
            Text(confirmed == nil ? "New booking" : "Scan to book \(rangeText)")
                .font(OS.font(19, .bold))
                .foregroundStyle(OS.fg)
                .accessibilityAddTraits(.isHeader)
            HStack {
                Group {
                    if confirmed != nil {
                        Button("Back") { withAnimation { confirmed = nil } }
                    } else {
                        Button("Cancel") { dismiss() }
                    }
                }
                .font(OS.font(17, .semibold))
                .tint(OS.accent)
                Spacer()
            }
        }
    }

    // MARK: Step 1: time

    private var details: some View {
        VStack(alignment: .leading, spacing: 32) {
            VStack(alignment: .leading, spacing: 12) {
                Text("How long").osEyebrow()
                HStack(spacing: 12) {
                    ForEach(Self.presets, id: \.self) { minutes in
                        presetButton(minutes)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("Or set the time").osEyebrow()
                HStack(alignment: .bottom, spacing: 16) {
                    // Moving the start keeps the length, like a calendar.
                    timeField("Start", selection: Binding(
                        get: { start },
                        set: { new in
                            end = end.addingTimeInterval(new.timeIntervalSince(start))
                            start = new
                        }
                    ))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(OS.muted)
                        .padding(.bottom, 22)
                    timeField("End", selection: $end)
                }
            }

            Group {
                if let problem {
                    Label(problem, systemImage: "exclamationmark.circle.fill")
                        .foregroundStyle(OS.danger)
                } else {
                    Label("\(durationText) · \(rangeText)", systemImage: "clock")
                        .foregroundStyle(OS.grey)
                }
            }
            .font(OS.font(18, .semibold).monospacedDigit())

            Button {
                withAnimation { confirmed = request }
            } label: {
                Text("Continue")
                    .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(OSPillButtonStyle(size: 20))
            .disabled(problem != nil)
            .opacity(problem == nil ? 1 : 0.4)
        }
        .frame(maxWidth: 620)
        .padding(.top, 4)
    }

    private func presetButton(_ minutes: Int) -> some View {
        let selected = Int(end.timeIntervalSince(start)) == minutes * 60
        let fits = rules.problem(start: presetStart, end: presetStart.addingTimeInterval(TimeInterval(minutes * 60))) == nil
        return Button {
            let from = presetStart
            start = from
            end = from.addingTimeInterval(TimeInterval(minutes * 60))
        } label: {
            Text(Self.presetLabel(minutes))
                .font(OS.font(20, .semibold))
                .frame(maxWidth: .infinity, minHeight: 64)
                .foregroundStyle(selected ? OS.card : OS.fg)
                .background(selected ? OS.accent : OS.card, in: .rect(cornerRadius: OS.itemRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: OS.itemRadius)
                        .strokeBorder(selected ? .clear : OS.container, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(!fits)
        .opacity(fits ? 1 : 0.4)
    }

    private func timeField(_ label: String, selection: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(OS.font(15, .semibold))
                .foregroundStyle(OS.grey)
            // Compact pickers take typed times as well as the wheel.
            DatePicker(label, selection: selection, displayedComponents: .hourAndMinute)
                .labelsHidden()
                .datePickerStyle(.compact)
                .tint(OS.accent)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(OS.card, in: .rect(cornerRadius: OS.itemRadius))
        }
    }

    // MARK: Step 2: scan

    private func scan(_ request: BookingRequest) -> some View {
        PassScanPanel(
            prompt: "Scan your DALI pass to book",
            submit: { token in try await store.book(request, memberToken: token).member },
            successTitle: { member in "Booked for \(member.firstName), \(rangeText)" },
            onSuccess: { _ in
                Task {
                    try? await Task.sleep(for: .seconds(2.5))
                    dismiss()
                }
            }
        )
        // The camera has no natural height; give it room in the fitted sheet.
        .frame(height: 620)
    }

    // MARK: Rules

    /// Presets run from the chosen start, or from now if that has passed.
    private var presetStart: Date { max(start, Self.floorToMinute(.now)) }

    private var rules: BookingRules { BookingRules(items: store.items, now: .now) }
    private var problem: String? { rules.problem(start: start, end: end) }
    private var request: BookingRequest { rules.request(start: start, end: end) }

    private var rangeText: String {
        "\(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
    }

    private var durationText: String {
        Duration.seconds(max(0, end.timeIntervalSince(start)))
            .formatted(.units(allowed: [.hours, .minutes], width: .wide))
    }

    /// "30 min", "1 hr", "1 hr 30 min" (the system format adds a comma).
    static func presetLabel(_ minutes: Int) -> String {
        let hours = minutes / 60, rest = minutes % 60
        if hours == 0 { return "\(rest) min" }
        return rest == 0 ? "\(hours) hr" : "\(hours) hr \(rest) min"
    }

    static func floorToMinute(_ date: Date) -> Date {
        Date(timeIntervalSinceReferenceDate: (date.timeIntervalSinceReferenceDate / 60).rounded(.down) * 60)
    }
}
