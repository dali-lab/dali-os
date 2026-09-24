import SwiftUI

/// Walk-up booking: the person scans their DALI pass to claim the room.
struct BookNowSheet: View {
    let minutes: Int
    @Environment(DisplayStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PassScanPanel(
                prompt: "Scan your DALI pass to book",
                submit: { token in try await store.book(minutes: minutes, memberToken: token).member },
                successTitle: { member in
                    let end = Date.now.addingTimeInterval(TimeInterval(minutes * 60))
                    return "Booked for \(member.firstName) until \(end.formatted(date: .omitted, time: .shortened))"
                },
                onSuccess: { _ in
                    Task {
                        try? await Task.sleep(for: .seconds(2.5))
                        dismiss()
                    }
                }
            )
            .padding(24)
            .navigationTitle("Book for \(Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .wide)))")
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
