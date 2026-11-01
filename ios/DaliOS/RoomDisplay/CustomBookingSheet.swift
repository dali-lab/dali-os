import SwiftUI

/// Book any day and time: pick a day, drag a window across what's free, then
/// scan the booker's DALI pass to confirm.
struct CustomBookingSheet: View {
    let room: DisplayRoom
    /// Back to the Book now sheet; nil when the room can't be booked from now.
    var onBack: (() -> Void)?

    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDay = Calendar.current.startOfDay(for: .now)
    @State private var items: [ScheduleItem]?
    @State private var loadFailed = false
    @State private var loadAttempt = 0
    @State private var window: BookingWindow?
    @State private var scanning = false

    private var bookingDay: BookingDay? {
        items.map { BookingDay(day: selectedDay, items: $0, now: .now) }
    }

    var body: some View {
        SheetScaffold(
            eyebrow: scanning ? "Step 2 of 2 · Confirm" : "Step 1 of 2 · Time",
            title: "Book \(room.name)",
            description: description,
            onClose: { dismiss() },
            wide: true
        ) {
            if scanning, let window {
                scanPanel(window)
            } else {
                picker
            }
        } footer: {
            if scanning {
                Button {
                    withAnimation { scanning = false }
                    loadAttempt += 1
                } label: {
                    Label("Change time", systemImage: "arrow.left")
                }
                .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
            } else if let onBack {
                Button(action: onBack) { Label("Back", systemImage: "arrow.left") }
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
            } else {
                Button("Cancel") { dismiss() }
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
            }
        }
        .onChange(of: selectedDay) {
            items = nil
            window = nil
        }
        .task(id: "\(selectedDay.timeIntervalSince1970)-\(loadAttempt)") { await load() }
    }

    private var description: String {
        if scanning, let window {
            return "\(DisplayFormat.day(window.start)) · \(DisplayFormat.range(window.start, window.end))"
        }
        if window != nil { return "Drag the edges to adjust. Tap outside to start over." }
        if bookingDay?.gaps.isEmpty == true { return "No free times left on this day." }
        return "Drag across a free time to book it, or tap for 1 hour."
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 20) {
            DayPicker(selection: $selectedDay)
            if let bookingDay, let items {
                DaySlider(day: bookingDay, items: items, window: $window) {
                    withAnimation { scanning = true }
                }
            } else if loadFailed {
                VStack(spacing: 12) {
                    Text("Couldn't load this day.")
                        .font(Brand.body(16))
                        .foregroundStyle(Brand.textMuted)
                    Button("Try again") { loadAttempt += 1 }
                        .buttonStyle(BrandButtonStyle(variant: .outline, tint: .navy, rounded: true))
                }
                .frame(maxWidth: .infinity, minHeight: DaySlider.height)
            } else {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, minHeight: DaySlider.height)
            }
        }
        .contentShape(.rect)
        .onTapGesture { window = nil }
    }

    private func scanPanel(_ window: BookingWindow) -> some View {
        PassScanPanel(
            prompt: "Scan your DALI pass to book",
            submit: { token in
                let response = try await store.book(roomID: room.id, start: window.start, end: window.end, memberToken: token)
                let member = response.member
                return ScanResult(
                    member: member,
                    title: "Booked for \(member.firstName)",
                    detail: "\(DisplayFormat.day(response.booking.start)) · \(DisplayFormat.range(response.booking.start, response.booking.end))"
                )
            },
            onSuccessDone: { _ in dismiss() }
        )
        .frame(height: 400)
    }

    private func load() async {
        loadFailed = false
        do {
            items = try await store.items(roomID: room.id, on: selectedDay)
        } catch {
            if !Task.isCancelled { loadFailed = items == nil }
        }
    }
}

/// The next five days, then a calendar for the rest of what the server takes.
private struct DayPicker: View {
    @Binding var selection: Date
    @State private var pickingDate = false

    private var today: Date { Calendar.current.startOfDay(for: .now) }

    private func day(_ offset: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: offset, to: today)!
    }

    var body: some View {
        let days = (0..<5).map(day)
        VStack(alignment: .leading, spacing: 10) {
            Text("Which day?").brandEyebrow()
            HStack(spacing: 8) {
                ForEach(Array(days.enumerated()), id: \.element) { offset, date in
                    Button { selection = date } label: {
                        chip(active: selection == date) {
                            Text(date == today ? "Today" : date.formatted(.dateTime.weekday(.abbreviated)))
                                .font(Brand.heading(16))
                                .foregroundStyle(Brand.textHeading)
                            Text(date.formatted(.dateTime.month(.abbreviated).day()))
                                .font(Brand.body(14))
                                .foregroundStyle(Brand.textMuted)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("booking-day-\(offset)")
                    .accessibilityAddTraits(selection == date ? .isSelected : [])
                }
                let isOther = !days.contains(selection)
                Button { pickingDate = true } label: {
                    chip(active: isOther) {
                        if isOther {
                            Text(selection.formatted(.dateTime.weekday(.abbreviated)))
                                .font(Brand.heading(16))
                                .foregroundStyle(Brand.textHeading)
                            Text(selection.formatted(.dateTime.month(.abbreviated).day()))
                                .font(Brand.body(14))
                                .foregroundStyle(Brand.textMuted)
                        } else {
                            Image(systemName: "calendar")
                                .font(.system(size: 18))
                                .foregroundStyle(Brand.textHeading)
                            Text("Other")
                                .font(Brand.body(14, .semibold))
                                .foregroundStyle(Brand.textHeading)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Other date")
                .popover(isPresented: $pickingDate) {
                    DatePicker(
                        "Date",
                        selection: Binding(
                            get: { selection },
                            set: {
                                selection = Calendar.current.startOfDay(for: $0)
                                pickingDate = false
                            }
                        ),
                        in: today...day(BookingDay.leadDays - 1),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .tint(Brand.teal)
                    .frame(width: 340)
                    .padding(16)
                }
            }
        }
    }

    private func chip<Content: View>(active: Bool, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 2, content: content)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(active ? Brand.paleTeal.opacity(0.3) : Brand.surface, in: .rect(cornerRadius: Brand.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.cardRadius)
                    .strokeBorder(active ? Brand.teal : Brand.borderSubtle, lineWidth: 2)
            )
            .contentShape(.rect)
    }
}

/// The day, left to right. It never scrolls, so a plain drag can only mean
/// "pick a time" and needs no press-and-hold first. When a finger lifts, the
/// window's popover opens beside it, like Google Calendar's.
struct DaySlider: View {
    static let height: CGFloat = 340
    private static let laneHeight: CGFloat = 200
    /// Comfortably wider than the handles: a finger is bigger than they are.
    private static let handleReach: CGFloat = 28
    private static let tapSlop: CGFloat = 8
    private static let popoverGap: CGFloat = 16

    let day: BookingDay
    let items: [ScheduleItem]
    @Binding var window: BookingWindow?
    let onBook: () -> Void

    private enum Drag {
        case new(anchor: Date, hadWindow: Bool)
        case start
        case end
        case inside
    }

    @State private var drag: Drag?

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .topLeading) {
                lane(width: width)
                hourLabels(width: width)
                if let window, drag == nil {
                    popover(window, width: width)
                }
            }
        }
        .frame(height: Self.height)
    }

    private func x(_ date: Date, width: CGFloat) -> CGFloat {
        CGFloat(day.fraction(of: date)) * width
    }

    private func lane(width: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            Brand.surfaceMuted
            Rectangle()
                .fill(Brand.borderSubtle.opacity(0.5))
                .frame(width: x(day.earliest, width: width))
            ForEach(hours, id: \.self) { hour in
                Rectangle()
                    .fill(Brand.borderSubtle)
                    .frame(width: 1)
                    .offset(x: x(hour, width: width))
            }
            ForEach(items, id: \.occurrenceID) { item in
                bookedBlock(item, width: width)
            }
            if let window {
                windowBlock(window, width: width)
            }
        }
        .frame(width: width, height: Self.laneHeight)
        .clipShape(.rect(cornerRadius: Brand.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.cardRadius).strokeBorder(Brand.borderSubtle, lineWidth: 2))
        .contentShape(.rect)
        .gesture(dragGesture(width: width))
        .accessibilityElement()
        .accessibilityLabel("Day timeline. Drag across a free time to book it.")
        .accessibilityIdentifier("day-timeline")
    }

    @ViewBuilder
    private func bookedBlock(_ item: ScheduleItem, width: CGFloat) -> some View {
        let start = max(item.start, day.opens), end = min(item.end, day.closes)
        if end > start {
            let blockWidth = x(end, width: width) - x(start, width: width)
            VStack(alignment: .leading, spacing: 2) {
                if blockWidth >= 96 {
                    Text("Booked")
                        .font(Brand.body(15, .bold))
                        .foregroundStyle(Brand.textHeading)
                    Text(DisplayFormat.range(item.start, item.end))
                        .font(Brand.body(13))
                        .foregroundStyle(Brand.textMuted)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 12)
            .frame(width: blockWidth, height: Self.laneHeight, alignment: .leading)
            .background(Brand.paleBlue)
            .offset(x: x(start, width: width))
        }
    }

    private func windowBlock(_ window: BookingWindow, width: CGFloat) -> some View {
        let start = x(window.start, width: width), end = x(window.end, width: width)
        return ZStack {
            VStack(spacing: 2) {
                if end - start >= 92 {
                    Text(DisplayFormat.time(window.start))
                        .font(Brand.body(15, .bold))
                    Text("to \(DisplayFormat.time(window.end))")
                        .font(Brand.body(13, .medium))
                }
            }
            .foregroundStyle(.white)
            .frame(width: end - start, height: Self.laneHeight)
            .background(Brand.teal)

            HStack {
                handle.offset(x: -12)
                Spacer(minLength: 0)
                handle.offset(x: 12)
            }
        }
        .frame(width: end - start, height: Self.laneHeight)
        .offset(x: start)
        .animation(.snappy(duration: 0.12), value: window)
    }

    private var handle: some View {
        Capsule()
            .fill(.white)
            .strokeBorder(Brand.teal, lineWidth: 3)
            .frame(width: 24, height: 36)
    }

    private func hourLabels(width: CGFloat) -> some View {
        ForEach(hours, id: \.self) { hour in
            Text(hour.formatted(.dateTime.hour()))
                .font(Brand.mono(13))
                .foregroundStyle(Brand.textMuted)
                .fixedSize()
                .position(x: min(width - 24, max(20, x(hour, width: width))), y: Self.laneHeight + 16)
        }
    }

    private var hours: [Date] {
        stride(from: 0, through: BookingDay.closingHour - BookingDay.openingHour, by: 2).map {
            day.opens.addingTimeInterval(TimeInterval($0 * 3600))
        }
    }

    private func popover(_ window: BookingWindow, width: CGFloat) -> some View {
        let after = x(window.end, width: width) + Self.popoverGap
        let before = x(window.start, width: width) - Self.popoverGap - WindowPopover.width
        return WindowPopover(
            day: day,
            window: window,
            onChange: { self.window = $0 },
            onClear: { self.window = nil },
            onBook: onBook
        )
        .offset(x: after + WindowPopover.width <= width ? after : max(0, before))
    }

    private func dragGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let mode = drag ?? beginDrag(at: value.startLocation.x, width: width)
                drag = mode
                let at = day.date(atFraction: value.location.x / width)
                switch mode {
                case .new(let anchor, _):
                    if abs(value.translation.width) >= Self.tapSlop {
                        window = day.window(dragFrom: anchor, to: at)
                    }
                case .start:
                    window = window.map { day.movingStart(of: $0, to: at) }
                case .end:
                    window = window.map { day.movingEnd(of: $0, to: at) }
                case .inside:
                    break
                }
            }
            .onEnded { value in
                if case .new(let anchor, let hadWindow) = drag, abs(value.translation.width) < Self.tapSlop {
                    window = hadWindow ? nil : day.window(tappedAt: anchor)
                }
                drag = nil
            }
    }

    private func beginDrag(at location: CGFloat, width: CGFloat) -> Drag {
        let anchor = day.date(atFraction: location / width)
        guard let window else { return .new(anchor: anchor, hadWindow: false) }
        let start = x(window.start, width: width), end = x(window.end, width: width)
        let toStart = abs(location - start), toEnd = abs(location - end)
        if min(toStart, toEnd) <= Self.handleReach { return toStart < toEnd ? .start : .end }
        if location > start, location < end { return .inside }
        return .new(anchor: anchor, hadWindow: true)
    }
}

/// Exact times for the window, and the way on to the pass scan.
private struct WindowPopover: View {
    static let width: CGFloat = 470

    let day: BookingDay
    let window: BookingWindow
    let onChange: (BookingWindow) -> Void
    let onClear: () -> Void
    let onBook: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(DisplayFormat.day(window.start))
                        .font(Brand.heading(20))
                        .foregroundStyle(Brand.textHeading)
                    Text("\(DisplayFormat.range(window.start, window.end)) · \(DisplayFormat.duration(minutes: window.minutes))")
                        .font(Brand.body(16))
                        .foregroundStyle(Brand.textMuted)
                }
                Spacer(minLength: 12)
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Brand.textMuted)
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Close")
            }
            HStack(spacing: 12) {
                wheel("Start", date: window.start, range: day.startRange(for: window)) {
                    onChange(day.settingStart(of: window, to: $0))
                }
                wheel("End", date: window.end, range: day.endRange(for: window)) {
                    onChange(day.settingEnd(of: window, to: $0))
                }
            }
            HStack {
                Button("Clear", action: onClear)
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true))
                Spacer()
                Button("Scan pass to book", action: onBook)
                    .buttonStyle(BrandButtonStyle(rounded: true))
            }
        }
        .padding(20)
        .frame(width: Self.width)
        .background(Brand.surface, in: .rect(cornerRadius: Brand.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.cardRadius).strokeBorder(Brand.borderSubtle))
        .shadow(color: Brand.darkNavy.opacity(0.22), radius: 16, y: 8)
        .contentShape(.rect)
        .onTapGesture {}
    }

    private func wheel(_ label: String, date: Date, range: ClosedRange<Date>, onChange: @escaping (Date) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).brandEyebrow()
            TimeWheel(date: date, range: range, onChange: onChange)
                .frame(height: 120)
                .clipped()
                .accessibilityLabel(label)
        }
    }
}

/// iOS's wheel in `BookingDay.wheelStep` steps. A value outside `range` greys
/// out, and the wheel rolls back from it by itself.
private struct TimeWheel: UIViewRepresentable {
    let date: Date
    let range: ClosedRange<Date>
    let onChange: (Date) -> Void

    @MainActor
    final class Coordinator: NSObject {
        var onChange: (Date) -> Void

        init(onChange: @escaping (Date) -> Void) {
            self.onChange = onChange
        }

        @objc func changed(_ picker: UIDatePicker) {
            onChange(picker.date)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onChange: onChange)
    }

    func makeUIView(context: Context) -> UIDatePicker {
        let picker = UIDatePicker()
        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .wheels
        picker.minuteInterval = BookingDay.wheelStep
        picker.addTarget(context.coordinator, action: #selector(Coordinator.changed), for: .valueChanged)
        return picker
    }

    func updateUIView(_ picker: UIDatePicker, context: Context) {
        context.coordinator.onChange = onChange
        picker.minimumDate = range.lowerBound
        picker.maximumDate = range.upperBound
        if picker.date != date { picker.setDate(date, animated: true) }
    }
}
