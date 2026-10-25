import SwiftUI

/// Book now, in two steps: how long (lengths that end before the next booking),
/// then scan the booker's DALI pass to confirm.
struct BookingSheet: View {
    let room: DisplayRoom
    let state: RoomState

    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Int?
    @State private var scanning = false

    init(room: DisplayRoom, state: RoomState) {
        self.room = room
        self.state = state
        let options = state.bookableDurations
        _selected = State(initialValue: options.contains(30) ? 30 : options.first)
    }

    var body: some View {
        SheetScaffold(
            eyebrow: scanning ? "Step 2 of 2 · Confirm" : "Step 1 of 2 · Time",
            title: "Book \(room.name)",
            description: description,
            onClose: { dismiss() }
        ) {
            if scanning, let selected {
                PassScanPanel(
                    prompt: "Scan your DALI pass to book",
                    submit: { token in
                        let response = try await store.book(roomID: room.id, minutes: selected, memberToken: token)
                        let member = response.member
                        return ScanResult(
                            member: member,
                            title: "Booked for \(member.firstName), \(DisplayFormat.range(response.booking.start, response.booking.end))",
                            detail: member.fullName
                        )
                    },
                    onSuccessDone: { _ in dismiss() }
                )
                .frame(height: 380)
            } else if state.bookableDurations.isEmpty {
                Text("The next meeting starts too soon to book this room.")
                    .font(Brand.body(15))
                    .foregroundStyle(Brand.darkNavy)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Brand.lightYellow, in: .rect(cornerRadius: Brand.rowRadius))
            } else {
                durationPicker
            }
        } footer: {
            if scanning {
                Button { withAnimation { scanning = false } } label: { Label("Change time", systemImage: "arrow.left") }
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
            } else {
                Button("Cancel") { dismiss() }
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
                Button { withAnimation { scanning = true } } label: {
                    HStack(spacing: 8) {
                        Text("Continue")
                        Image(systemName: "arrow.right")
                    }
                }
                .buttonStyle(BrandButtonStyle(rounded: true))
                .disabled(selected == nil)
            }
        }
    }

    private var description: String {
        if scanning, let selected {
            let now = Date.now
            return "\(DisplayFormat.duration(minutes: selected)) · \(DisplayFormat.range(now, now.addingTimeInterval(TimeInterval(selected * 60))))"
        }
        if let next = state.next {
            return "Starts now. The room is free until \(DisplayFormat.time(next.start))."
        }
        return "Starts now. The room is free for the rest of the day."
    }

    private var durationPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How long?").brandEyebrow()
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(state.bookableDurations, id: \.self) { minutes in
                    let active = selected == minutes
                    Button { selected = minutes } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(DisplayFormat.duration(minutes: minutes))
                                .font(Brand.heading(24))
                                .foregroundStyle(Brand.textHeading)
                            Text("Until \(DisplayFormat.time(Date.now.addingTimeInterval(TimeInterval(minutes * 60))))")
                                .font(Brand.body(15))
                                .foregroundStyle(Brand.textMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(active ? Brand.paleTeal.opacity(0.3) : Brand.surface, in: .rect(cornerRadius: Brand.cardRadius))
                        .overlay(
                            RoundedRectangle(cornerRadius: Brand.cardRadius)
                                .strokeBorder(active ? Brand.teal : Brand.borderSubtle, lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(DisplayFormat.duration(minutes: minutes))
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            Text("Next, you'll scan your DALI pass to confirm.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.textMuted)
                .padding(.top, 4)
        }
    }
}

/// End early, or extend by 15 minutes, confirmed by the booker's pass.
struct BookingChangeSheet: View {
    let room: DisplayRoom
    let booking: ScheduleItem
    let change: BookingChange

    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetScaffold(
            eyebrow: change == .end ? "End early" : "Extend",
            title: change == .end ? "End meeting early?" : "Extend \(booking.title)?",
            description: change == .end
                ? "\(room.name) will be freed up for others right away. Scan the booker's DALI pass to confirm."
                : "Until \(DisplayFormat.time(extendedEnd)). Scan the booker's DALI pass to confirm.",
            onClose: { dismiss() }
        ) {
            PassScanPanel(
                prompt: change == .end ? "Scan your DALI pass to end it" : "Scan your DALI pass to extend",
                submit: { token in
                    let response = try await store.change(change, booking: booking, memberToken: token)
                    let member = response.member
                    return ScanResult(
                        member: member,
                        title: change == .end
                            ? "\(room.name) is free"
                            : "Extended to \(DisplayFormat.time(response.booking.end))",
                        detail: change == .end ? "Thanks, \(member.firstName)" : member.fullName
                    )
                },
                onSuccessDone: { _ in dismiss() }
            )
            .frame(height: 380)
        } footer: {
            Button(change == .end ? "Keep meeting" : "Cancel") { dismiss() }
                .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
        }
    }

    private var extendedEnd: Date {
        booking.end.addingTimeInterval(TimeInterval(BookingChange.extendMinutes * 60))
    }
}

/// The design's modal: eyebrow, title, one line of context, the content, and
/// right-aligned actions.
struct SheetScaffold<Content: View, Footer: View>: View {
    let eyebrow: String
    let title: String
    let description: String
    let onClose: () -> Void
    @ViewBuilder let content: Content
    @ViewBuilder let footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(eyebrow).brandEyebrow(Brand.teal)
                    Text(title)
                        .font(Brand.heading(26))
                        .foregroundStyle(Brand.textHeading)
                        .accessibilityAddTraits(.isHeader)
                    Text(description)
                        .font(Brand.body(16))
                        .foregroundStyle(Brand.textMuted)
                }
                Spacer(minLength: 16)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.textMuted)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Close")
            }
            content
                .padding(.top, 24)
            HStack(spacing: 8) {
                Spacer()
                footer
            }
            .padding(.top, 24)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .presentationBackground(Brand.surface)
        .presentationSizing(.form.fitted(horizontal: false, vertical: true))
        .presentationCornerRadius(Brand.panelRadius)
    }
}
