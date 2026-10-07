import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSmokeCommand, smokeEvidence } from './smoke.js';

const MOBILE = join(import.meta.dirname, '..');

function text(path: string): string {
  return readFileSync(join(MOBILE, path), 'utf8');
}

describe('Capacitor iOS project', () => {
  it('keeps the checked-in native target aligned with the shipped mobile identity', () => {
    const project = text('ios/App/App.xcodeproj/project.pbxproj');

    const bundleIds = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
      .map((match) => match[1]);
    expect(bundleIds).toEqual([
      'nz.eldritchdynasty.game',
      'nz.eldritchdynasty.game',
    ]);

    const deviceFamilies = [...project.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)]
      .map((match) => match[1]);
    expect(deviceFamilies).toEqual(['"1"', '"1"']);

    const deploymentTargets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)]
      .map((match) => Number(match[1]));
    expect(deploymentTargets.length).toBeGreaterThan(0);
    expect(deploymentTargets.every((target) => target >= 15)).toBe(true);

    expect(project).toContain('PrivacyInfo.xcprivacy in Resources');
    expect(project).not.toContain('com.getcapacitor.App');
  });

  it('keeps Interface Builder metadata while the launch screen stays self-contained', () => {
    for (const storyboard of [
      'ios/App/App/Base.lproj/Main.storyboard',
      'ios/App/App/Base.lproj/LaunchScreen.storyboard',
    ]) {
      const source = text(storyboard);
      expect(source).toContain('toolsVersion=');
      expect(source).toContain('IBCocoaTouchPlugin');
    }

    const launch = text('ios/App/App/Base.lproj/LaunchScreen.storyboard');
    expect(launch).not.toContain('image="Splash"');
    expect(launch).not.toContain('<image name="Splash"');
  });

  it('declares the required-reason APIs used by durable storage and legacy migration', () => {
    const privacy = text('ios/App/App/PrivacyInfo.xcprivacy');

    expect(privacy).toContain('NSPrivacyAccessedAPICategoryFileTimestamp');
    expect(privacy).toContain('<string>C617.1</string>');
    expect(privacy).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    expect(privacy).toContain('<string>CA92.1</string>');
  });

  it('keeps iOS on the same bridge/sync workflow as Android', () => {
    const pkg = JSON.parse(text('package.json')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(pkg.dependencies['@capacitor/ios']).toBe('^8.0.0');
    expect(pkg.scripts['sync:ios']).toBe('npm run prepare-web && cap sync ios');
    expect(pkg.scripts['ios']).toContain('npm run sync:ios');
    expect(pkg.scripts['ios:build']).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(pkg.scripts['ios:build']).toContain('generic/platform=iOS Simulator');

    const swiftPackage = text('ios/App/CapApp-SPM/Package.swift');
    expect(swiftPackage).toContain('platforms: [.iOS(.v15)]');
    expect(swiftPackage).toContain('capacitor-swift-pm.git');
  });
  it('keeps the macOS proof as a real install-and-launch smoke, not compile-only', () => {
    const workflow = readFileSync(join(MOBILE, '../../.github/workflows/check.yml'), 'utf8');

    expect(workflow).toContain('runs-on: macos-26');
    expect(workflow).toContain('-derivedDataPath "$RUNNER_TEMP/ed-ios-derived"');
    expect(workflow).toContain('timeout-minutes: 15');
    expect(workflow).toContain('xcrun simctl bootstatus "$UDID" -b');
    expect(workflow).toContain('xcrun simctl install "$UDID" "$APP"');
    expect(workflow).toContain('xcrun simctl launch "$UDID" nz.eldritchdynasty.game');
    expect(workflow).toContain('node scripts/ios-runtime-smoke.mjs');

    const boot = workflow.indexOf('xcrun simctl boot "$UDID" 2>/dev/null || true');
    const build = workflow.indexOf('xcodebuild -project ios/App/App.xcodeproj -scheme App');
    expect(boot).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(boot);
  });

  it('registers the simulator smoke scheme in Debug and never in Release', () => {
    const project = text('ios/App/App.xcodeproj/project.pbxproj');
    const debugInfo = text('ios/App/App/Info-Debug.plist');
    const releaseInfo = text('ios/App/App/Info.plist');
    const runtimeSmoke = text('scripts/ios-runtime-smoke.mjs');
    const platformBridge = text('src/platform-bridge.ts');
    const sceneDelegate = text('ios/App/App/SceneDelegate.swift');

    expect(project).toContain('INFOPLIST_FILE = "App/Info-Debug.plist";');
    expect(project).toContain('INFOPLIST_FILE = App/Info.plist;');
    expect(debugInfo).toContain('<string>eldritchdynasty-smoke</string>');
    expect(releaseInfo).not.toContain('eldritchdynasty-smoke');
    expect(releaseInfo).not.toContain('CFBundleURLTypes');
    expect(runtimeSmoke).toContain('eldritchdynasty-smoke://save?seed=1042&years=40');
    expect(runtimeSmoke).toContain("simctl(['terminate', udid, APP_ID])");
    expect(runtimeSmoke).toContain('save/resume sha256:');
    expect(runtimeSmoke).toContain('export/import sha256:');
    expect(platformBridge).toContain("const SMOKE_READY = 'smoke-ready.json'");
    expect(platformBridge).toContain("stage: 'received'");
    expect(runtimeSmoke).toContain('iOS smoke listener did not become ready within');
    expect(runtimeSmoke).toContain('await waitForReady();');
    expect(runtimeSmoke).not.toContain('await delay(5_000);');
    expect(runtimeSmoke).toContain('smoke command was not received within');
    expect(runtimeSmoke).toContain('smoke command was received but produced no final evidence');

    const terminate = runtimeSmoke.indexOf("simctl(['terminate', udid, APP_ID])");
    const relaunch = runtimeSmoke.indexOf("simctl(['launch', udid, APP_ID], 120_000");
    const launchUrl = runtimeSmoke.indexOf('SIMCTL_CHILD_ED_SMOKE_URL: url');
    const readyAfterLaunch = runtimeSmoke.indexOf('await waitForReady();', relaunch);
    expect(terminate).toBeGreaterThan(-1);
    expect(relaunch).toBeGreaterThan(terminate);
    expect(launchUrl).toBeGreaterThan(relaunch);
    expect(readyAfterLaunch).toBeGreaterThan(launchUrl);
    expect(runtimeSmoke).not.toContain("simctl(['openurl'");

    expect(sceneDelegate).toContain('#if DEBUG');
    expect(sceneDelegate).toContain('ProcessInfo.processInfo.environment["ED_SMOKE_URL"]');
    expect(sceneDelegate).toContain('forName: .capacitorViewDidAppear');
    expect(sceneDelegate).toContain('NotificationCenter.default.post(name: .capacitorOpenURL');

    const onBack = platformBridge.indexOf('onBack(');
    const onSmokeCommand = platformBridge.indexOf('onSmokeCommand(');
    const appUrlListener = platformBridge.indexOf("App.addListener('appUrlOpen'");
    const readyWrite = platformBridge.indexOf('path: SMOKE_READY');
    expect(onBack).toBeGreaterThan(-1);
    expect(onSmokeCommand).toBeGreaterThan(onBack);
    expect(platformBridge.slice(onBack, onSmokeCommand)).not.toContain('SMOKE_READY');
    expect(appUrlListener).toBeGreaterThan(onSmokeCommand);
    expect(readyWrite).toBeGreaterThan(appUrlListener);
  });

});

describe('iOS runtime smoke protocol', () => {
  it('accepts only the private smoke scheme and well-formed commands', () => {
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?seed=1042&years=40'))
      .toEqual({ kind: 'save', seed: 1042, years: 40 });
    expect(parseSmokeCommand('eldritchdynasty-smoke://resume')).toEqual({ kind: 'resume' });
    expect(parseSmokeCommand('eldritchdynasty-smoke://export')).toEqual({ kind: 'export' });
    expect(parseSmokeCommand('eldritchdynasty-smoke://import?path=smoke.json'))
      .toEqual({ kind: 'import', path: 'smoke.json' });
    expect(parseSmokeCommand('https://save?seed=1042&years=40')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://save?years=-1')).toBeNull();
    expect(parseSmokeCommand('eldritchdynasty-smoke://import')).toBeNull();
  });

  it('hashes canonical snapshot data and carries host evidence', async () => {
    await expect(smokeEvidence(
      { kind: 'export' },
      { snapshot: { format: 28, year: 1082 }, year: 1082, path: 'smoke.json' },
    )).resolves.toEqual({
      command: 'export',
      ok: true,
      sha256: '0efd2b23500ee0241d74680d35ac523cdbdca304aeaabec765bc9102856d5021',
      year: 1082,
      path: 'smoke.json',
    });
  });

  it('ignores JSON representation noise, key order, and the refreshed save timestamp', async () => {
    const first = await smokeEvidence(
      { kind: 'save', seed: 7, years: 1 },
      {
        snapshot: {
          format: 28,
          year: 1043,
          savedAt: 'first',
          absent: undefined,
          world: { people: [{ name: 'Daveed', born: 1042 }], counters: { person: 1, branch: 0 } },
        },
      },
    );
    const second = await smokeEvidence(
      { kind: 'resume' },
      {
        snapshot: {
          world: { counters: { branch: 0, person: 1 }, people: [{ born: 1042, name: 'Daveed' }] },
          savedAt: 'second',
          year: 1043,
          format: 28,
        },
      },
    );

    expect(second.sha256).toBe(first.sha256);
  });
});
