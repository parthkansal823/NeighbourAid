package com.neighbouraid.updater;

import java.net.URI;
import java.util.Arrays;
import java.util.TreeSet;

final class UpdatePolicy {
    static final long MAX_BYTES = 100L * 1024 * 1024;

    static boolean trustedDownload(String raw) {
        try {
            URI uri = new URI(raw);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getQuery() == null && uri.getFragment() == null
                && uri.getRawPath().matches("/parthkansal823/NeighbourAid/releases/download/[A-Za-z0-9._-]+/app-release\\.apk");
        } catch (Exception ignored) { return false; }
    }

    static boolean acceptableVersion(long expected, long archived, long installed) {
        return expected > installed && expected <= 2100000000L && archived == expected;
    }

    static boolean sameSigners(byte[][] installed, byte[][] archived) {
        if (installed == null || archived == null || installed.length == 0 || archived.length == 0) return false;
        TreeSet<String> a = new TreeSet<>(), b = new TreeSet<>();
        Arrays.stream(installed).forEach(value -> a.add(hex(value)));
        Arrays.stream(archived).forEach(value -> b.add(hex(value)));
        return a.equals(b);
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder();
        for (byte b : bytes) value.append(String.format("%02x", b & 0xff));
        return value.toString();
    }
}
