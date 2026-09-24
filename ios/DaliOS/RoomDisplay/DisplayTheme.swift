import SwiftUI

enum DisplayTheme {
    static let available = Color(red: 0.13, green: 0.60, blue: 0.36)
    static let busy = Color(red: 0.80, green: 0.20, blue: 0.22)
    static let event = Color(red: 0.36, green: 0.29, blue: 0.82)

    static func tint(for item: ScheduleItem) -> Color {
        if item.isEvent { return event }
        return item.kind == .meeting ? .blue : .teal
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
