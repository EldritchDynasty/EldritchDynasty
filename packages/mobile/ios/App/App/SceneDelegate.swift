import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

#if DEBUG
    private var smokeLaunchObserver: NSObjectProtocol?
#endif

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

#if DEBUG
        // CoreSimulator does not reliably deliver a custom URL through
        // `simctl openurl` on hosted runners. The smoke driver therefore
        // launches this Debug build with SIMCTL_CHILD_ED_SMOKE_URL. Forward
        // the resulting ED_SMOKE_URL through the same Capacitor notification
        // that a real scene URL uses, but only after the bridge view appears.
        if let raw = ProcessInfo.processInfo.environment["ED_SMOKE_URL"],
           let url = URL(string: raw) {
            smokeLaunchObserver = NotificationCenter.default.addObserver(
                forName: .capacitorViewDidAppear,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                let payload: [String: Any?] = [
                    "url": url as NSURL,
                    "options": [String: Any?]()
                ]
                NotificationCenter.default.post(name: .capacitorOpenURL, object: payload)

                if let observer = self?.smokeLaunchObserver {
                    NotificationCenter.default.removeObserver(observer)
                    self?.smokeLaunchObserver = nil
                }
            }
        }
#endif
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
