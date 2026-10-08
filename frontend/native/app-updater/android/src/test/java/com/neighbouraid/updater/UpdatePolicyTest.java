package com.neighbouraid.updater;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    private final String url = "https://github.com/parthkansal823/NeighbourAid/releases/download/android-23/app-release.apk";
    @Test public void downloadIsLimitedToThisRepositoryAndAsset() {
        assertTrue(UpdatePolicy.trustedDownload(url));
        for (String bad : new String[] {null, "", url.replace("https:", "http:"), url + "?redirect=x", url + "#x",
                url.replace("github.com", "github.com.evil.test"), url.replace("github.com", "user@github.com"),
                url.replace("NeighbourAid", "OtherRepo"), url.replace("app-release.apk", "app-debug.apk"),
                url.replace("android-23", "../android-23"), url.replace("android-23", "android%2F23"),
                url.replace("android-23", "android..23"), url.replace("android-23", ".hidden"),
                url.replace("android-23", "android-23/extra"), url + "?", url + "#", url.replace("github.com", "github.com:443")}) {
            assertFalse(bad, UpdatePolicy.trustedDownload(bad));
        }
    }
    @Test public void cannotInstallWrongVersionOrDowngrade() {
        assertTrue(UpdatePolicy.acceptableVersion(23, 23, 22));
        assertFalse(UpdatePolicy.acceptableVersion(23, 24, 22));
        assertFalse(UpdatePolicy.acceptableVersion(23, 23, 23));
        assertFalse(UpdatePolicy.acceptableVersion(22, 22, 23));
        assertFalse(UpdatePolicy.acceptableVersion(2100000001L, 2100000001L, 22));
    }
    @Test public void signerSetMustMatchExactlyNotJustOverlap() {
        byte[] a = {1, 2}, b = {3, 4}, c = {5, 6};
        assertTrue(UpdatePolicy.sameSigners(new byte[][] {a, b}, new byte[][] {b, a}));
        assertFalse(UpdatePolicy.sameSigners(new byte[][] {a}, new byte[][] {b}));
        assertFalse(UpdatePolicy.sameSigners(new byte[][] {a, b}, new byte[][] {a, b, c}));
        assertFalse(UpdatePolicy.sameSigners(null, new byte[][] {a}));
        assertFalse(UpdatePolicy.sameSigners(new byte[0][], new byte[0][]));
    }
}
