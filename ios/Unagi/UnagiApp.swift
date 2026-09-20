import SwiftUI

@main struct UnagiApp: App {
    @StateObject private var store = Store()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
                .tint(Color(red: 0.16, green: 0.34, blue: 0.27))
                .task { await store.load() }
        }
    }
}
