import SwiftUI

/// The paired door display: the two rooms it hangs between, side by side.
/// While a hiring event is broadcast it shows that event's check-in QR, and
/// while iPad scanning is on from a meeting's page the whole screen is the
/// scanner.
struct RoomDisplayView: View {
    @Environment(DisplayStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var scanningRoomID: String?
    @State private var showingAdmin = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { context in
            let now = context.date
            Group {
                if let scan = store.visibleAttendanceScan {
                    AttendanceScanView(scan: scan, now: now)
                } else if let broadcast = store.applicationEvent {
                    ApplicationEventQRView(event: broadcast, now: now)
                } else {
                    rooms(now: now)
                }
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: DisplayStore.refreshInterval)
            }
        }
        .confirmationDialog("Room display", isPresented: $showingAdmin) {
            Button("Unpair this display", role: .destructive) { store.unpair() }
        } message: {
            Text("Unpairing removes this iPad from \(store.rooms.map(\.room.name).joined(separator: " and ")). Pair it again from Core ▸ Rooms.")
        }
    }

    private func rooms(now: Date) -> some View {
        VStack(spacing: 0) {
            topBar(now: now)
            GeometryReader { proxy in
                let layout = proxy.size.width >= 700
                    ? AnyLayout(HStackLayout(spacing: 20))
                    : AnyLayout(VStackLayout(spacing: 20))
                layout {
                    ForEach(store.rooms) { schedule in
                        RoomPanel(schedule: schedule, now: now, scanningRoomID: $scanningRoomID)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(Brand.surfaceMuted.ignoresSafeArea())
    }

    private func topBar(now: Date) -> some View {
        HStack(spacing: 16) {
            DaliLogo()
            Rectangle().fill(Brand.borderSubtle).frame(width: 1, height: 24)
            Text(store.rooms.count == 1 ? "Room availability" : "Room availability · \(store.rooms.count) rooms")
                .brandEyebrow()
            if store.isOffline {
                OSStatusPill(text: "Offline", dot: OS.amber, size: 13)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(DisplayFormat.time(now))
                    .font(Brand.heading(32).monospacedDigit())
                    .foregroundStyle(Brand.textHeading)
                Text(now, format: .dateTime.weekday(.wide).month(.wide).day())
                    .brandEyebrow(size: 12, tracking: 1.7)
                    // Hidden admin entry for whoever mounts the iPad.
                    .onLongPressGesture(minimumDuration: 3) { showingAdmin = true }
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
    }
}
