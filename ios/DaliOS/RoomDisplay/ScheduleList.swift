import SwiftUI

/// The room's day as a list: done items faded and struck through, the one
/// underway marked Now, DALI events tagged. Scrolled so what's left is in view.
struct ScheduleList: View {
    let items: [ScheduleItem]
    let now: Date

    private var sorted: [ScheduleItem] {
        items.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
    }

    var body: some View {
        let sorted = sorted
        VStack(alignment: .leading, spacing: 12) {
            Text("Today").brandEyebrow(Brand.teal)

            if sorted.isEmpty {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 4) {
                            ForEach(sorted, id: \.occurrenceID) { item in
                                row(item).id(item.occurrenceID)
                            }
                            if !sorted.contains(where: { $0.end > now }) {
                                Text("No more meetings today.")
                                    .font(Brand.body(15))
                                    .foregroundStyle(Brand.textMuted)
                                    .padding(12)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .onAppear { scrollToRemaining(sorted, proxy) }
                    .onChange(of: sorted.first { $0.end > now }?.occurrenceID) { scrollToRemaining(sorted, proxy) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func scrollToRemaining(_ sorted: [ScheduleItem], _ proxy: ScrollViewProxy) {
        guard let first = sorted.first(where: { $0.end > now }) else { return }
        proxy.scrollTo(first.occurrenceID, anchor: .top)
    }

    private func row(_ item: ScheduleItem) -> some View {
        let isPast = item.end <= now
        let isCurrent = item.start <= now && item.end > now
        return HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DisplayFormat.time(item.start))
                Text(DisplayFormat.time(item.end))
            }
            .font(Brand.mono(13))
            .foregroundStyle(Brand.textMuted)
            .frame(width: 84, alignment: .leading)

            Capsule()
                .fill(isCurrent ? Brand.coral : Brand.paleBlue)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(Brand.body(17, .semibold))
                    .foregroundStyle(Brand.textStrong)
                    .strikethrough(isPast, color: Brand.mediumGray)
                Text(item.organizerName)
                    .font(Brand.body(15))
                    .foregroundStyle(Brand.textMuted)
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)

            if isCurrent {
                BrandBadge(text: "Now", tone: .danger, pulse: true)
            } else if item.isEvent, !isPast {
                BrandBadge(text: "Event", dot: false)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            if isCurrent {
                RoundedRectangle(cornerRadius: Brand.rowRadius)
                    .fill(Brand.surfaceMuted)
                    .strokeBorder(Brand.borderSubtle)
            }
        }
        .opacity(isPast ? 0.45 : 1)
        .accessibilityElement(children: .combine)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "calendar.badge.checkmark")
                .font(.system(size: 24))
                .foregroundStyle(Brand.teal)
            Text("Nothing booked today")
                .font(Brand.body(17, .semibold))
                .foregroundStyle(Brand.textStrong)
            Text("This room is open all day.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
        .overlay(
            RoundedRectangle(cornerRadius: Brand.cardRadius)
                .strokeBorder(Brand.borderSubtle, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }
}
