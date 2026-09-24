import SwiftUI

/// The paired door display. Normally status + today's timeline; while a DALI
/// event is in its check-in window it becomes a wallet-pass scanner.
struct RoomDisplayView: View {
    @Environment(DisplayStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var bookingMinutes: Int?
    @State private var showingAdmin = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            let now = context.date
            GeometryReader { proxy in
                let landscape = proxy.size.width > proxy.size.height
                Group {
                    if let event = store.currentEvent {
                        EventCheckInView(event: event, room: store.room, now: now)
                    } else {
                        let layout = landscape
                            ? AnyLayout(HStackLayout(spacing: 0))
                            : AnyLayout(VStackLayout(spacing: 0))
                        layout {
                            StatusPanel(
                                room: store.room,
                                items: store.items,
                                now: now,
                                isOffline: store.isOffline,
                                onBook: { bookingMinutes = $0 }
                            )
                            .frame(width: landscape ? proxy.size.width * 0.46 : nil,
                                   height: landscape ? nil : proxy.size.height * 0.55)
                            schedule(now: now)
                        }
                    }
                }
            }
        }
        .ignoresSafeArea()
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: DisplayStore.refreshInterval)
            }
        }
        .sheet(item: $bookingMinutes) { minutes in
            BookNowSheet(minutes: minutes)
        }
        .confirmationDialog("Room display", isPresented: $showingAdmin) {
            Button("Unpair this display", role: .destructive) { store.unpair() }
        } message: {
            Text("Unpairing removes this iPad from \(store.room?.name ?? "the room"). Pair it again from Core ▸ Rooms.")
        }
    }

    private func schedule(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(now, format: .dateTime.weekday(.wide).month(.wide).day())
                .font(.title2.weight(.semibold))
                .padding(.horizontal, 28)
                .padding(.top, 36)
                .padding(.bottom, 8)
                // Hidden admin entry for whoever mounts the iPad.
                .onLongPressGesture(minimumDuration: 3) { showingAdmin = true }
            DayTimelineView(items: store.items, now: now)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

extension Int: @retroactive Identifiable {
    public var id: Int { self }
}
