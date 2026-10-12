import CoreImage.CIFilterBuiltins
import SwiftUI

/// Broadcast mode: Core has put a hiring event's check-in QR on every door
/// display. Applicants scan it with their phone and check in from their own
/// login, so the iPad shows a code instead of reading passes.
struct ApplicationEventQRView: View {
    let event: ApplicationEventBroadcast
    let now: Date

    var body: some View {
        GeometryReader { proxy in
            let landscape = proxy.size.width > proxy.size.height
            let layout = landscape
                ? AnyLayout(HStackLayout(alignment: .center, spacing: 48))
                : AnyLayout(VStackLayout(alignment: .leading, spacing: 36))
            layout {
                VStack(alignment: .leading, spacing: 12) {
                    OSStatusPill(text: event.kindLabel, dot: OS.violet.ink)
                    Text(event.title)
                        .font(OS.font(48, .medium))
                        .foregroundStyle(OS.fg)
                        .lineLimit(3)
                    Text([event.timeRange, event.location].compactMap { $0 }.joined(separator: " · "))
                        .font(OS.font(20).monospacedDigit())
                        .foregroundStyle(OS.grey)
                    Spacer(minLength: 0)
                    Text("Scan to check in")
                        .font(OS.font(28, .medium))
                        .foregroundStyle(OS.fg)
                    Text("Sign in with your Dartmouth account to mark yourself here.")
                        .font(OS.font(17))
                        .foregroundStyle(OS.grey)
                    Text(now, format: .dateTime.hour().minute())
                        .font(OS.font(36, .medium).monospacedDigit())
                        .foregroundStyle(OS.fg)
                        .padding(.top, 8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

                QRCodeView(text: event.checkInUrl)
                    .frame(
                        width: min(proxy.size.width, proxy.size.height) * (landscape ? 0.72 : 0.8),
                        height: min(proxy.size.width, proxy.size.height) * (landscape ? 0.72 : 0.8)
                    )
                    .padding(24)
                    .background(.white, in: .rect(cornerRadius: OS.cardRadius))
                    .shadow(color: OS.shadow, radius: 20, y: 8)
                    .accessibilityLabel("Check-in QR code")
            }
            .padding(36)
        }
        .background(OS.bg.ignoresSafeArea())
    }
}

/// A QR code rendered on-device with CoreImage, so the display needs no image
/// from the server and keeps working through a brief offline refresh.
struct QRCodeView: View {
    let text: String

    var body: some View {
        if let image = Self.render(text) {
            Image(decorative: image, scale: 1)
                .resizable()
                .interpolation(.none)
                .aspectRatio(1, contentMode: .fit)
        } else {
            Text(text)
                .font(OS.font(15))
                .foregroundStyle(OS.grey)
        }
    }

    static func render(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let context = CIContext()
        return context.createCGImage(output, from: output.extent)
    }
}
