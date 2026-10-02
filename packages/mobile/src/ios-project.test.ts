import { describe, expect, it } from 'vitest';
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
});
