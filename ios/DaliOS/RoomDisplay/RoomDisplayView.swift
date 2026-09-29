import SwiftUI

/// The paired door display. Normally status + today's timeline; while a DALI
/// event is in its check-in window it becomes a wallet-pass scanner.
struct RoomDisplayView: View {
    @Environment(DisplayStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft: BookingDraft?
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
                            ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                            : AnyLayout(VStackLayout(spacing: 24))
                        layout {
                            StatusPanel(
                                room: store.room,
                                items: store.items,
                                now: now,
                                isOffline: store.isOffline
                            )
                            // Portrait: only as tall as its content, so the
                            // timeline below gets the rest of the screen.
                            .frame(width: landscape ? (proxy.size.width - 72) * 0.46 : nil)
                            .fixedSize(horizontal: false, vertical: !landscape)
                            schedule(now: now)
                        }
                        .padding(24)
                        .padding(.top, 12)
                        .overlay(alignment: .bottomTrailing) { newBookingButton }
                    }
                }
            }
        }
        .background(OS.bg.ignoresSafeArea())
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: DisplayStore.refreshInterval)
            }
        }
        .sheet(item: $draft) { draft in
            BookingSheet(draft: draft)
        }
        .confirmationDialog("Room display", isPresented: $showingAdmin) {
            Button("Unpair this display", role: .destructive) { store.unpair() }
        } message: {
            Text("Unpairing removes this iPad from \(store.room?.name ?? "the room"). Pair it again from Core ▸ Rooms.")
        }
    }

    private var newBookingButton: some View {
        Button {
            draft = BookingDraft(interval: suggestedSlot(now: .now))
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(OS.card)
                .frame(width: 76, height: 76)
                .background(OS.accent, in: .circle)
                .shadow(color: OS.shadow, radius: 16, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("New booking")
        .padding(44)
    }

    /// Where the + button's booking starts: now if the room is free, else
    /// right after the current booking. 30 minutes, cut short by the next one.
    private func suggestedSlot(now: Date) -> DateInterval {
        let picker = SlotPicker(items: store.items, now: now)
        if let slot = picker.tap(at: now) { return slot.interval }
        let after = store.items.first { $0.start <= now && $0.end > now }?.end ?? now
        return picker.tap(at: after)?.interval ?? DateInterval(start: after, duration: SlotPicker.tapLength)
    }

    private func schedule(now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Today")
                    .font(OS.font(24, .bold))
                    .foregroundStyle(OS.fg)
                Text(now, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(OS.font(18))
                    .foregroundStyle(OS.grey)
                    // Hidden admin entry for whoever mounts the iPad.
                    .onLongPressGesture(minimumDuration: 3) { showingAdmin = true }
                Spacer()
                Text("Tap or drag open time to book")
                    .font(OS.font(15))
                    .foregroundStyle(OS.muted)
            }
            .padding(.horizontal, 28)
            .padding(.top, 28)
            .padding(.bottom, 16)
            DayTimelineView(items: store.items, now: now) { draft = BookingDraft(interval: $0) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS.card, in: .rect(cornerRadius: OS.cardRadius))
    }
}
