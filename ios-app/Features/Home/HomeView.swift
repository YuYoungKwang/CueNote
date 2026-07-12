import SwiftUI

struct HomeView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("CueNote")
                    .font(.largeTitle.bold())

                Text("Phase 0")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .navigationTitle("CueNote")
        }
    }
}

#Preview {
    HomeView()
}
