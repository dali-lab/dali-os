import SwiftUI

/// One room on the display: a status band you can read from down the hall,
/// what's on now, and today's list. Book now / Extend / End early sit in the
/// footer and confirm with a pass scan. While a DALI event is checking in, the
/// body is that event's check-in station instead.
struct RoomPanel: View {
    let schedule: RoomSchedule
    let now: Date
    /// Which room's event scanner is open. One at a time: the iPad has one
    /// front camera.
    @Binding var scanningRoomID: String?

    @State private var booking = false
    @State private var change: PendingChange?

    private var state: RoomState { RoomState(items: schedule.items, now: now) }

    var body: some View {
        let state = state
        VStack(spacing: 0) {
            RoomStatusHeader(room: schedule.room, state: state)

            Group {
                if let event = schedule.currentEvent {
                    EventCheckInView(
                        roomID: schedule.room.id,
                        event: event,
                        isScanning: Binding(
                            get: { scanningRoomID == schedule.room.id },
                            set: { scanningRoomID = $0 ? schedule.room.id : nil }
                        )
                    )
                } else {
                    VStack(alignment: .leading, spacing: 20) {
                        if let current = state.current {
                            CurrentBookingCard(item: current, progress: state.progress(now: now))
                        }
                        ScheduleList(items: schedule.items, now: now)
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            if schedule.currentEvent == nil {
                footer(state)
            }
        }
        .background(Brand.surface)
        .clipShape(.rect(cornerRadius: Brand.panelRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.panelRadius).strokeBorder(Brand.borderSubtle))
        .shadow(color: Brand.shadow, radius: 6, y: 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(schedule.room.name) availability")
        .sheet(isPresented: $booking) {
            BookingSheet(room: schedule.room, state: state)
        }
        .sheet(item: $change) { pending in
            BookingChangeSheet(room: schedule.room, booking: pending.booking, change: pending.change)
        }
    }

    /// The sheet's scanner takes the camera, so any open event scanner closes.
    private func openChange(_ kind: BookingChange, _ state: RoomState) {
        scanningRoomID = nil
        change = state.current.map { PendingChange(change: kind, booking: $0) }
    }

    @ViewBuilder
    private func footer(_ state: RoomState) -> some View {
        if state.current == nil || state.canChange {
            VStack(spacing: 8) {
                if state.current != nil {
                    HStack(spacing: 12) {
                        Button { openChange(.extend, state) } label: {
                            Label("Extend \(BookingChange.extendMinutes) min", systemImage: "clock")
                        }
                        .buttonStyle(BrandButtonStyle(variant: .outline, tint: .navy, size: .lg, fullWidth: true))
                        .disabled(!state.canExtend)
                        Button { openChange(.end, state) } label: {
                            Label("End early", systemImage: "stop.fill")
                        }
                        .buttonStyle(BrandButtonStyle(tint: .coral, size: .lg, fullWidth: true))
                    }
                } else {
                    let canBook = !state.bookableDurations.isEmpty
                    Button {
                        scanningRoomID = nil
                        booking = true
                    } label: {
                        Label(canBook ? "Book now" : "Next meeting starting soon", systemImage: "plus")
                    }
                    .buttonStyle(BrandButtonStyle(size: .lg, fullWidth: true))
                    .disabled(!canBook)
                    if canBook {
                        Label("Confirm with your DALI pass", systemImage: "qrcode.viewfinder")
                            .font(Brand.body(14))
                            .foregroundStyle(Brand.textMuted)
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .background(Brand.surfaceMuted)
            .overlay(alignment: .top) { Rectangle().fill(Brand.borderSubtle).frame(height: 1) }
        }
    }
}

/// The booking an End early / Extend tap was for, held so the sheet keeps it
/// after the change lands and the schedule refreshes underneath.
private struct PendingChange: Identifiable {
    let change: BookingChange
    let booking: ScheduleItem
    var id: String { "\(change.rawValue)-\(booking.occurrenceID)" }
}

/// The colored band: room name, where it is, and the status in big type.
struct RoomStatusHeader: View {
    let room: DisplayRoom
    let state: RoomState

    private static let tilePairs = [
        TilePattern.Pair(background: .white.opacity(0.18), foreground: .white),
        TilePattern.Pair(background: Brand.navy, foreground: .white),
        TilePattern.Pair(background: .white, foreground: Brand.navy),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(room.name)
                .font(Brand.heading(30))
                .foregroundStyle(ink)
                .lineLimit(1)
            HStack(spacing: 16) {
                if let description = room.description {
                    Label(description, systemImage: "mappin.and.ellipse")
                }
                if let capacity = room.capacity {
                    Label("\(capacity) seats", systemImage: "person.2")
                }
            }
            .font(Brand.body(15))
            .foregroundStyle(ink.opacity(0.85))
            .labelStyle(TightLabelStyle())
            .padding(.top, 4)

            Text(label)
                .font(Brand.heading(64))
                .foregroundStyle(ink)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .padding(.top, 32)
                .accessibilityAddTraits(.updatesFrequently)
            Text(detail)
                .font(Brand.body(19))
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.top, 10)
        }
        .padding(.horizontal, 28)
        .padding(.top, 20)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .topTrailing) {
            TilePattern(rows: 2, columns: 4, tileSize: 40, seed: Int32(room.id.count * 3), density: 0.7, pairs: Self.tilePairs)
                .opacity(0.9)
        }
        .background(fill)
        .animation(.easeInOut(duration: 0.5), value: state.status)
    }

    private var fill: Color {
        switch state.status {
        case .available: Brand.teal
        case .soon: Brand.yellow
        case .busy: Brand.coral
        }
    }

    private var ink: Color { state.status == .soon ? Brand.darkNavy : .white }

    private var label: String {
        switch state.status {
        case .available: "Available"
        case .soon: "Starting soon"
        case .busy: "In use"
        }
    }

    private var detail: String {
        let left = DisplayFormat.duration(minutes: state.minutesUntilChange)
        if state.status == .busy, let current = state.current {
            return "Until \(DisplayFormat.time(current.end)) · \(left) left"
        }
        if state.status == .soon, let next = state.next {
            return "\(next.title) in \(left)"
        }
        if let next = state.next {
            return "Free until \(DisplayFormat.time(next.start)) · \(left)"
        }
        return "Free for the rest of the day"
    }
}

/// What's on now, who booked it, and how far through it is.
private struct CurrentBookingCard: View {
    let item: ScheduleItem
    let progress: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(item.title)
                    .font(Brand.body(18, .semibold))
                    .foregroundStyle(Brand.textStrong)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(item.timeRange)
                    .font(Brand.mono(13))
                    .foregroundStyle(Brand.textMuted)
            }
            Text(item.organizerName)
                .font(Brand.body(15))
                .foregroundStyle(Brand.textMuted)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Brand.paleBlue)
                    Capsule().fill(Brand.coral).frame(width: proxy.size.width * progress)
                }
            }
            .frame(height: 6)
            .padding(.top, 12)
            .animation(.easeInOut(duration: 0.7), value: progress)
            .accessibilityElement()
            .accessibilityLabel("Meeting progress")
            .accessibilityValue("\(Int(progress * 100)) percent")
        }
        .padding(16)
        .background(Brand.surfaceMuted, in: .rect(cornerRadius: Brand.cardRadius))
    }
}

struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon
            configuration.title
        }
    }
}
