import SwiftUI

/// A room panel while a DALI event is checking in: who's here so far, and a
/// pass scanner behind "Check in with DALI pass".
struct EventCheckInView: View {
    let roomID: String
    let event: ScheduleItem
    @Binding var isScanning: Bool
    @Environment(DisplayStore.self) private var store

    private var checkIns: CheckIns { event.checkIns ?? CheckIns(count: 0, expected: 0, recent: []) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    BrandBadge(text: "DALI event check-in")
                    Text(event.title)
                        .font(Brand.body(20, .semibold))
                        .foregroundStyle(Brand.textStrong)
                        .lineLimit(1)
                        .padding(.top, 4)
                    Text("\(event.timeRange) · \(event.organizerName)")
                        .font(Brand.body(15))
                        .foregroundStyle(Brand.textMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text("\(checkIns.count) checked in")
                    .font(Brand.mono(14))
                    .foregroundStyle(Brand.textMuted)
            }

            if isScanning {
                PassScanPanel(
                    prompt: "Hold your DALI pass up to the camera",
                    submit: { token in
                        let response = try await store.checkIn(roomID: roomID, memberToken: token)
                        let member = response.member
                        return ScanResult(
                            member: member,
                            title: response.alreadyCheckedIn == true
                                ? "You're already in, \(member.firstName)"
                                : "Welcome, \(member.firstName)!",
                            detail: member.fullName
                        )
                    },
                    onSuccessDone: { _ in isScanning = false }
                )
                .frame(minHeight: 260)
                Button { isScanning = false } label: { Label("Cancel", systemImage: "xmark") }
                    .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, rounded: true, fullWidth: true))
            } else {
                if checkIns.recent.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "person.2")
                            .font(.system(size: 24))
                            .foregroundStyle(Brand.teal)
                        Text("No one checked in yet")
                            .font(Brand.body(17, .semibold))
                            .foregroundStyle(Brand.textStrong)
                        Text("Tap below and hold your DALI pass up to the camera.")
                            .font(Brand.body(15))
                            .foregroundStyle(Brand.textMuted)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                    .overlay(
                        RoundedRectangle(cornerRadius: Brand.cardRadius)
                            .strokeBorder(Brand.borderSubtle, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                    )
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 4) {
                            ForEach(checkIns.recent, id: \.id) { member in
                                HStack(spacing: 12) {
                                    MemberAvatar(firstName: member.firstName, lastName: member.lastName, photoUrl: member.photoUrl, size: 32)
                                    Text("\(member.firstName) \(member.lastName)")
                                        .font(Brand.body(17, .semibold))
                                        .foregroundStyle(Brand.textStrong)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                            }
                        }
                    }
                    .accessibilityLabel("Checked in")
                }
                Button { isScanning = true } label: {
                    Label("Check in with DALI pass", systemImage: "qrcode.viewfinder")
                }
                .buttonStyle(BrandButtonStyle(size: .lg, fullWidth: true))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
