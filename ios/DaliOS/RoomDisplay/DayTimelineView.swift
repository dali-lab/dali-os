import SwiftUI

/// Today's schedule as a vertical calendar day: each booking is a block sized
/// by its duration, with a line at the current time.
struct DayTimelineView: View {
    let items: [ScheduleItem]
    let now: Date

    private let hourHeight: CGFloat = 84
    private let gutter: CGFloat = 64
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

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                ZStack(alignment: .topLeading) {
                    grid
                    ForEach(items, id: \.occurrenceID) { item in
                        block(item)
                    }
                    nowLine
                }
                .frame(height: CGFloat(hours.count - 1) * hourHeight + 24)
                .padding(.vertical, 12)
            }
            .onAppear { proxy.scrollTo(max(hours.lowerBound, calendar.component(.hour, from: now) - 1), anchor: .top) }
        }
    }

    private func y(for date: Date) -> CGFloat {
        let hoursFromTop = date.timeIntervalSince(dayStart) / 3600 - Double(hours.lowerBound)
        return CGFloat(hoursFromTop) * hourHeight
    }

    /// Laid out in a VStack (not offsets) so each hour row has a real scroll
    /// position for ScrollViewReader to jump to.
    private var grid: some View {
        VStack(spacing: 0) {
            ForEach(Array(hours), id: \.self) { hour in
                HStack(alignment: .center, spacing: 8) {
                    Text(calendar.date(bySettingHour: hour % 24, minute: 0, second: 0, of: dayStart)!,
                         format: .dateTime.hour())
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: gutter - 8, alignment: .trailing)
                    Rectangle()
                        .fill(Color(.separator))
                        .frame(height: 1)
                }
                .frame(height: 16)
                .frame(height: hour == hours.upperBound ? 16 : hourHeight, alignment: .top)
                .id(hour)
            }
        }
        .offset(y: -8)
    }

    private func block(_ item: ScheduleItem) -> some View {
        let top = y(for: max(item.start, dayStart))
        let height = max(y(for: item.end) - top, 28)
        let tint = DisplayTheme.tint(for: item)
        let isPast = item.end <= now
        return HStack(spacing: 0) {
            Rectangle().fill(tint).frame(width: 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(height > 60 ? 2 : 1)
                if height > 44 {
                    Text("\(item.timeRange) · \(item.durationText)")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if height > 76 {
                    Text(item.isEvent ? "DALI event · \(item.organizerName)" : item.organizerName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            Spacer(minLength: 0)
        }
        .frame(height: height, alignment: .top)
        .background(tint.opacity(0.16))
        .background(Color(.systemBackground))
        .clipShape(.rect(cornerRadius: 10))
        .opacity(isPast ? 0.45 : 1)
        .padding(.leading, gutter)
        .padding(.trailing, 12)
        .offset(y: top)
    }

    @ViewBuilder
    private var nowLine: some View {
        let top = y(for: now)
        if top >= 0, top <= CGFloat(hours.count - 1) * hourHeight {
            HStack(spacing: 0) {
                Circle().fill(DisplayTheme.busy).frame(width: 12, height: 12)
                Rectangle().fill(DisplayTheme.busy).frame(height: 2)
            }
            .padding(.leading, gutter - 6)
            .offset(y: top - 6)
        }
    }
}
