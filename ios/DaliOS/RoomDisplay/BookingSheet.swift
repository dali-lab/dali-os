import SwiftUI

/// Confirms a booking by scanning the booker's DALI pass.
struct BookingSheet: View {
    let request: BookingRequest
    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var title: String {
        switch request {
        case .now(let minutes):
            "Book for \(Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .wide)))"
        case .slot(let interval):
            "Book \(interval.start.formatted(date: .omitted, time: .shortened)) – \(interval.end.formatted(date: .omitted, time: .shortened))"
        }
    }

    var body: some View {
        NavigationStack {
            PassScanPanel(
                prompt: "Scan your DALI pass to book",
                submit: { token in try await store.book(request, memberToken: token).member },
                successTitle: { member in
                    let interval = request.interval
                    let range = "\(interval.start.formatted(date: .omitted, time: .shortened)) – \(interval.end.formatted(date: .omitted, time: .shortened))"
                    return "Booked for \(member.firstName), \(range)"
                },
                onSuccess: { _ in
                    Task {
                        try? await Task.sleep(for: .seconds(2.5))
                        dismiss()
                    }
                }
            )
            .padding(24)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationSizing(.page)
    }
}
