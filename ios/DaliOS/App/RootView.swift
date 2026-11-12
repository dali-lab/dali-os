import SwiftUI

struct RootView: View {
    var body: some View {
        RoomDisplayRoot()
    }
}

#Preview {
    RootView()
        .environment(AppSettings())
}
