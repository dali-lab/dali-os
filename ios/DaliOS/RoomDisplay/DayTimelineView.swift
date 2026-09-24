import SwiftUI

/// Today's schedule as a vertical calendar day: each booking is a block sized
/// by its duration, with a line at the current time. The whole day fits on
/// screen (no scrolling — it's read from down the hall), which also leaves a
/// plain drag free for picking a slot: tap an open time for 30 minutes, or
/// drag across open time to choose the range.
struct DayTimelineView: View {
    let items: [ScheduleItem]
    let now: Date
    let onSelect: (DateInterval) -> Void

    @State private var draft: SlotPicker.Slot?

    private let gutter: CGFloat = 72
    private let labelHeight: CGFloat = 16
    /// Movement below this is a tap, not a drag.
    private let dragThreshold: CGFloat = 10
    private let calendar = Calendar.current

    private var dayStart: Date { calendar.startOfDay(for: now) }

    /// 7am–10pm, widened to fit anything booked outside it.
    private var hours: ClosedRange<Int> {
        let startHours = items.map { calendar.component(.hour, from: max($0.start, dayStart)) }
        let endHours = items.map { item -> Int in
            let end = min(item.end, calendar.date(byAdding: .day, value: 1, to: dayStart)!)
            let hour = calendar.component(.hour, from: end)
            return calendar.isDate(end, inSameDayAs: dayStart) ? hour : 24
        }
        let first = min(7, startHours.min() ?? 7)
        let last = max(22, endHours.max() ?? 22)
        return first...last
    }

    private var picker: SlotPicker { SlotPicker(items: items, now: now) }

    var body: some View {
        GeometryReader { proxy in
            let scale = Scale(
                dayStart: dayStart,
                firstHour: hours.lowerBound,
                hourHeight: (proxy.size.height - labelHeight) / CGFloat(hours.count - 1)
            )
            ZStack(alignment: .topLeading) {
                grid(scale)
                ForEach(items, id: \.occurrenceID) { item in
                    block(item, scale)
                }
                if let draft { draftBlock(draft, scale) }
                nowLine(scale)
            }
            .padding(.top, labelHeight / 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(selection(scale))
        }
        .padding(.bottom, 12)
    }

    private func selection(_ scale: Scale) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard abs(value.translation.height) >= dragThreshold else { return }
                draft = picker.drag(
                    from: scale.date(atY: value.startLocation.y - labelHeight / 2),
                    to: scale.date(atY: value.location.y - labelHeight / 2)
                )
            }
            .onEnded { value in
                defer { draft = nil }
                if abs(value.translation.height) < dragThreshold {
                    if let slot = picker.tap(at: scale.date(atY: value.location.y - labelHeight / 2)), slot.isValid {
                        onSelect(slot.interval)
                    }
                } else if let draft, draft.isValid {
                    onSelect(draft.interval)
                }
            }
    }

    private func grid(_ scale: Scale) -> some View {
        ForEach(Array(hours), id: \.self) { hour in
            HStack(alignment: .center, spacing: 8) {
                Text(calendar.date(bySettingHour: hour % 24, minute: 0, second: 0, of: dayStart)!,
                     format: .dateTime.hour())
                    .font(OS.font(12, .semibold).monospacedDigit())
                    .foregroundStyle(OS.muted)
                    .frame(width: gutter - 8, alignment: .trailing)
                Rectangle()
                    .fill(OS.container)
                    .frame(height: 1)
            }
            .frame(height: labelHeight)
            .offset(y: CGFloat(hour - hours.lowerBound) * scale.hourHeight - labelHeight / 2)
        }
    }

    private func block(_ item: ScheduleItem, _ scale: Scale) -> some View {
        let top = scale.y(for: max(item.start, dayStart))
        let height = max(scale.y(for: item.end) - top, 22)
        let category = DisplayTheme.category(for: item)
        return VStack(alignment: .leading, spacing: 2) {
            if height > 54 {
                Text(item.title)
                    .font(OS.font(16, .semibold))
                    .lineLimit(height > 60 ? 2 : 1)
            } else {
                // One line: title and time side by side.
                (Text(item.title).font(OS.font(16, .semibold))
                    + Text("  \(item.timeRange)").font(OS.font(14).monospacedDigit()))
                    .lineLimit(1)
            }
            if height > 54 {
                Text("\(item.timeRange) · \(item.durationText)")
                    .font(OS.font(14).monospacedDigit())
            }
            if height > 76 {
                Text(item.isEvent ? "DALI event · \(item.organizerName)" : item.organizerName)
                    .font(OS.font(14))
            }
        }
        .foregroundStyle(category.ink)
        .padding(.horizontal, 12)
        .padding(.vertical, height > 30 ? 6 : 1)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(category.fill, in: .rect(cornerRadius: OS.itemRadius))
        // Fade past blocks toward the card without going see-through, so the
        // hour lines don't show through them.
        .overlay(OS.card.opacity(item.end <= now ? 0.5 : 0), in: .rect(cornerRadius: OS.itemRadius))
        .padding(.leading, gutter)
        .padding(.trailing, 16)
        .offset(y: top)
    }

    private func draftBlock(_ slot: SlotPicker.Slot, _ scale: Scale) -> some View {
        let top = scale.y(for: slot.interval.start)
        let height = max(scale.y(for: slot.interval.end) - top, 22)
        let tint = slot.isValid ? OS.accent : OS.danger
        return HStack(spacing: 8) {
            Text(slot.isValid ? "New booking" : "Not available")
                .font(OS.font(16, .semibold))
            Text("\(slot.interval.start.formatted(date: .omitted, time: .shortened)) – \(slot.interval.end.formatted(date: .omitted, time: .shortened))")
                .font(OS.font(14).monospacedDigit())
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .leading)
        .background(tint.opacity(0.12), in: .rect(cornerRadius: OS.itemRadius))
        .overlay(RoundedRectangle(cornerRadius: OS.itemRadius).strokeBorder(tint, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
        .padding(.leading, gutter)
        .padding(.trailing, 16)
        .offset(y: top)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func nowLine(_ scale: Scale) -> some View {
        let top = scale.y(for: now)
        if top >= 0, top <= CGFloat(hours.count - 1) * scale.hourHeight {
            HStack(spacing: 0) {
                Circle().fill(OS.danger).frame(width: 12, height: 12)
                Rectangle().fill(OS.danger).frame(height: 2)
            }
            .padding(.leading, gutter - 6)
            .offset(y: top - 6)
            .allowsHitTesting(false)
        }
    }
}

/// Time ↔ vertical position for one layout pass.
private struct Scale {
    let dayStart: Date
    let firstHour: Int
    let hourHeight: CGFloat

    func y(for date: Date) -> CGFloat {
        CGFloat(date.timeIntervalSince(dayStart) / 3600 - Double(firstHour)) * hourHeight
    }

    func date(atY y: CGFloat) -> Date {
        dayStart.addingTimeInterval((Double(y / hourHeight) + Double(firstHour)) * 3600)
    }
}
