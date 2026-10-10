import { describe, expect, it, vi } from 'vitest';
import { chooseSaveFile } from './file-chooser.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('rejects empty or malformed native smoke evidence rather than matching two missing hashes', async () => {
    // This is the exact pure validator loaded by the Node-based simulator driver.
    // @ts-ignore JavaScript .mjs implementation intentionally has no TS declarations.
    const { assertFinalEvidence } = await import('../scripts/ios-smoke-evidence.mjs');
    const sha256 = 'a'.repeat(64);

    expect(assertFinalEvidence('save', { command: 'save', ok: true, sha256, year: 1082 }))
      .toEqual({ command: 'save', ok: true, sha256, year: 1082 });

    for (const bad of [undefined, null, '', 'a'.repeat(63), 'G'.repeat(64), 123]) {
      expect(() => assertFinalEvidence('save', { command: 'save', ok: true, sha256: bad }))
        .toThrow('no valid sha256 digest');
      expect(() => assertFinalEvidence('resume', { command: 'resume', ok: true, sha256: bad }))
        .toThrow('no valid sha256 digest');
      expect(() => assertFinalEvidence('export', { command: 'export', ok: true, sha256: bad, path: 'run.json' }))
        .toThrow('no valid sha256 digest');
      expect(() => assertFinalEvidence('import', { command: 'import', ok: true, sha256: bad }))
        .toThrow('no valid sha256 digest');
    }

    expect(() => assertFinalEvidence('export', { command: 'export', ok: true, sha256, path: {} }))
      .toThrow('no valid interchange path');
    expect(() => assertFinalEvidence('save', { command: 'save', stage: 'received', ok: true, sha256 }))
      .toThrow('not a final result');
    expect(() => assertFinalEvidence('resume', { command: 'resume', ok: false, error: 'read failed', sha256 }))
      .toThrow('read failed');
    expect(() => assertFinalEvidence('resume', { command: 'save', ok: true, sha256 }))
      .toThrow('expected resume evidence');
    expect(() => assertFinalEvidence('resume', null))
      .toThrow('no structured evidence');
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
    expect(runtimeSmoke).toContain('return assertFinalEvidence(kind, evidence);');
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

// Android and iOS native-project checks share this measured mobile test suite.
// Keep rerun-safety assertions here so adding a tiny static check does not
// exhaust the CI budget for as-yet-unmeasured standalone test files.
describe('Android release versionCode', () => {
  const source = text('android/app/build.gradle');

  it('includes the workflow rerun attempt in a bounded run-number stride', () => {
    expect(source).toContain("System.getenv('GITHUB_RUN_NUMBER')");
    expect(source).toContain("System.getenv('GITHUB_RUN_ATTEMPT')");
    expect(source).toContain(
      'def computedVersionCode = runNumber * versionCodeAttemptStride + runAttempt',
    );

    const stride = Number(source.match(/def versionCodeAttemptStride = (\d+)L/)?.[1]);
    expect(stride).toBeGreaterThan(2);

    const code = (run: number, attempt: number) => run * stride + attempt;
    expect(code(42, 1)).not.toBe(code(42, 2));
    expect(code(42, stride - 1)).toBeLessThan(code(43, 1));
  });

  it('keeps local builds on the deterministic fallback code', () => {
    expect(source).toContain('def androidVersionCode = 1');
    expect(source).toContain('versionCode androidVersionCode');
  });

  it('guards the Android/Play versionCode ceiling', () => {
    expect(source).toContain('computedVersionCode > 2100000000L');
  });
});


function fakeNativePicker() {
  const listeners = new Map<string, () => void>();
  const input = {
    type: '',
    accept: '',
    files: null as File[] | null,
    onchange: null as (() => void) | null,
    click: vi.fn(),
    addEventListener(name: string, callback: EventListenerOrEventListenerObject) {
      listeners.set(name, () => {
        const event = { type: name } as Event;
        if (typeof callback === 'function') callback(event);
        else callback.handleEvent(event);
      });
    },
  };
  return { input, listeners };
}

describe('mobile native save import picker', () => {
  it('settles with null when the native picker is cancelled without any change', async () => {
    const { input, listeners } = fakeNativePicker();
    const choice = chooseSaveFile(input as unknown as HTMLInputElement);

    // The bridge configures type/accept (cross-host platform.test.ts
    // protects that contract); the helper must complete on native cancel.
    expect(input.click).toHaveBeenCalledOnce();
    expect(listeners.has('cancel')).toBe(true);
    listeners.get('cancel')!();

    await expect(choice).resolves.toBeNull();
  });

  it('retains the original JSON import behavior for a selected file', async () => {
    const { input } = fakeNativePicker();
    const json = { format: 28, year: 1250 };
    class FakeReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsText() {
        this.result = JSON.stringify(json);
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', FakeReader);
    try {
      const choice = chooseSaveFile(input as unknown as HTMLInputElement);
      input.files = [{} as File];
      input.onchange?.();
      await expect(choice).resolves.toEqual(json);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('settles with null when the selected file cannot be parsed', async () => {
    const { input } = fakeNativePicker();
    class InvalidReader {
      result = '{invalid';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsText() { this.onload?.(); }
    }

    vi.stubGlobal('FileReader', InvalidReader);
    try {
      const choice = chooseSaveFile(input as unknown as HTMLInputElement);
      input.files = [{} as File];
      input.onchange?.();
      await expect(choice).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
