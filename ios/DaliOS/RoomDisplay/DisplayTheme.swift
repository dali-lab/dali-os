import SwiftUI

enum DisplayTheme {
    /// Record-type colors from the category palette: bookings slate, meetings
    /// blue, DALI events violet.
    static func category(for item: ScheduleItem) -> OS.Category {
        if item.isEvent { return OS.violet }
        return item.kind == .meeting ? OS.blue : OS.slate
    }
}

extension ScheduleItem {
    var timeRange: String {
        "\(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
    }

    var durationText: String {
        Duration.seconds(duration).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    var organizerName: String { "\(organizer.firstName) \(organizer.lastName)" }
}
